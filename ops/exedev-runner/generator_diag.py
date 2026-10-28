"""Bounded, content-free diagnostics for the isolated content generator.

Only root may create/read these files. Generator stdout is consumed in memory, but
candidate text, tool output, environment values and raw errors are never persisted.

The helper emits one fixed-vocabulary stdout line. For blogs, relay() derives it from exactly
one EOF-finalized [outcome] that directly follows the single Success: line. Anything
doubtful (duplicate, early/late, malformed, unknown enum, contradiction) is 'absent'.
For refreshes, refresh_relay() reports when every Edit/Write failed, with the first error code.
"""
import json
import hashlib
import os
import re
import selectors
import subprocess
import stat
import time

MAX_BYTES = 64 * 1024
MAX_LINE_BYTES = 4096
MODEL = re.compile(r'^\[init\] Model: claude-(opus|sonnet|haiku)-\d+(?:-\d+)?-\d{8}, Tools: (\d{1,4})$')
TOOL = re.compile(r'^\[tool_use\] ([A-Za-z][A-Za-z0-9_-]{0,79})$')
MCP = re.compile(r'(gsc|ga4|playwright|dataforseo|serper)\((connected|failed|disconnected|unknown)\)')
BUILTIN_TOOLS = frozenset(('Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                           'Task', 'ToolSearch', 'WebSearch', 'WebFetch', 'NotebookEdit'))
MCP_SERVERS = frozenset(('gsc', 'ga4', 'playwright', 'dataforseo', 'serper'))
SUMMARY = re.compile(r'^(Success: (?:true|false)|Turns: \d{1,4}|Duration: \d{1,4}(?:\.\d)?s)$')
STOP_REASONS = frozenset(('post-written', 'unsupported-grounding', 'duplicate',
                          'insufficient-sources', 'no-post-unspecified',
                          'sdk-error', 'generator-error'))


DETAIL_REASONS = frozenset({
    'unsupported-operational-premise', 'pre-submit-refused', 'duplicate-topic',
    'insufficient-directory-evidence', 'source-pack-size-limit', 'missing-topic-or-businesses',
})
# Fixed vocabulary: even a code-looking article fragment cannot enter diagnostics.
VALIDATION_CODES = frozenset({
    'invalid-pack-header', 'invalid-fingerprint', 'invalid-check-time', 'future-generated-at',
    'invalid-max-age', 'stale-generated-at', 'missing-businesses', 'invalid-source-count',
    'invalid-source-inventory', 'invalid-source', 'invalid-claims', 'invalid-premise-claims',
    'stale-internal-inventory', 'invalid-image-inventory', 'unsupported-premise',
    'reserve-fact-floor', 'source-pack-size-limit', 'source-pack-sidecar-changed', 'missing-draft', 'storage',
    'draft-must-use-real-publish-date', 'no-attributed-business', 'business-outside-pack',
    'draft-changed-topic', 'draft-dropped-premise', 'invalid-relatedPosts',
    'invalid-relatedServices', 'invalid-relatedTopics', 'invalid-relatedBusinesses',
    'invalid-internal-link', 'missing-or-invalid-hero-image',
    'blog-lint:unrecorded-business', 'blog-lint:unsupported-address', 'blog-lint:unsupported-operational-premise',
    'blog-lint:unsupported-date', 'blog-lint:unsupported-hours', 'blog-lint:unsupported-price',
})


REFRESH_CHECK_CODES = frozenset(['unrecorded-business', 'unsupported-address', 'unsupported-price', 'unsupported-hours', 'unsupported-date', 'unsupported-operational-premise', 'missing-draft', 'no-attributed-business', 'business-outside-pack', 'draft-changed-topic', 'draft-dropped-premise', 'invalid-relatedPosts', 'invalid-relatedServices', 'invalid-relatedTopics', 'invalid-relatedBusinesses', 'invalid-internal-link', 'storage', 'missing-snapshot-binding', 'roundup-coverage', 'refresh-off-target', 'refresh-slug-changed', 'refresh-date-changed', 'refresh-no-change', 'refresh-snippet-overreach', 'image-invalid', 'image-missing', 'image-outside-root', 'image-size', 'image-type'])
REFRESH_CHECK_CODES = REFRESH_CHECK_CODES | frozenset(['refresh-candidate-format', 'refresh-candidate-fields', 'refresh-precheck', 'refresh-title-length', 'refresh-description-length', 'refresh-query-late', 'refresh-title-duplicate', 'refresh-plain-text-markdown'])

class GeneratorDiagnostic:
    def __init__(self, path, refresh=False):
        if os.geteuid() != 0:
            raise PermissionError('generator diagnostic must be created by root')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.file = os.fdopen(fd, 'wb', buffering=0)
        self.bytes = 0
        self.truncated = False
        self.failed = False
        self.seen_agent = False
        self.seen_init = False
        self.seen_mcp = False
        self.seen_summary = False
        self.summary_fields = set()
        self.seen_outcome = False
        self.seen_detail = False
        self.pending = b''
        self.dropping_line = False
        self.tool_counts = {}
        self.reason = None
        self.finalized = False
        self.relay_invalid = False
        self.relay_outcome = None
        self.relay_outcomes = 0
        self.relay_successes = 0
        self.relay_after_success = False
        self.refresh = refresh
        self.refresh_writes = {}
        self.refresh_results = {}
        self.refresh_output_error = False

    def refresh_file(self, path, phase):
        """Host view, before handoff and after systemd-run --wait returns."""
        if not self.refresh:
            return
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 20 * 1024 * 1024:
                    raise ValueError('invalid refresh file')
                data = source.read(info.st_size + 1)
                if len(data) != info.st_size:
                    raise ValueError('refresh file changed while reading')
            self.event('refresh-file', phase=phase, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        except (OSError, ValueError):
            self.event('refresh-file', phase=phase, status='unreadable')

    def refresh_line(self, text):
        for marker in ('refresh-write', 'refresh-write-result', 'refresh-file', 'refresh-output', 'refresh-self-check'):
            prefix = '[' + marker + '] '
            if not text.startswith(prefix):
                continue
            try:
                value = json.loads(text[len(prefix):], object_pairs_hook=_reject_duplicate_keys)
                if type(value) is not dict:
                    return
                if marker == 'refresh-self-check':
                    codes = value.get('ruleCodes')
                    if (type(value.get('attempt')) is int and value['attempt'] in (1, 2)
                            and type(value.get('ok')) is bool and type(codes) is list
                            and all(type(code) is str and code in REFRESH_CHECK_CODES for code in codes)):
                        self.event(marker, attempt=value['attempt'], ok=value['ok'], ruleCodes=list(dict.fromkeys(codes))[:30])
                    return
                if marker == 'refresh-output':
                    if type(value.get('attempt')) is int and value['attempt'] in (1, 2) and value.get('status') in ('valid', 'invalid-json'):
                        self.refresh_output_error = value['status'] == 'invalid-json'
                        self.event(marker, attempt=value['attempt'], status=value['status'])
                    return
                sequence = value.get('sequence')
                if marker != 'refresh-file' or value.get('phase') == 'tool-result':
                    if type(sequence) is not int or not 1 <= sequence <= 1000:
                        return
                if marker == 'refresh-write':
                    tool, file_path = value.get('tool'), value.get('file_path')
                    if tool not in ('Edit', 'Write') or (file_path is not None and
                            (not isinstance(file_path, str) or len(file_path) > 512 or file_path.startswith('/') or
                             any(ord(c) < 32 or ord(c) == 127 for c in file_path))):
                        return
                    self.event(marker, sequence=sequence, tool=tool, file_path=file_path)
                    self.refresh_writes[sequence] = True
                elif marker == 'refresh-write-result':
                    if type(value.get('isError')) is not bool or value.get('errorCode') not in (None, 'unknown', 'EROFS', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC'):
                        return
                    self.event(marker, sequence=sequence, isError=value['isError'], errorCode=value.get('errorCode'))
                    self.refresh_results[sequence] = (value['isError'], value.get('errorCode') or 'unknown')
                else:
                    phase = value.get('phase')
                    if phase not in ('writer-handoff', 'writer-read-back', 'tool-result'):
                        return
                    fields = {'phase': phase, **({'sequence': sequence} if phase == 'tool-result' else {})}
                    if value.get('status') == 'unreadable':
                        self.event(marker, **fields, status='unreadable')
                    elif (type(value.get('bytes')) is int and 0 <= value['bytes'] <= 20 * 1024 * 1024 and
                          isinstance(value.get('sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', value['sha256'])):
                        self.event(marker, **fields, bytes=value['bytes'], sha256=value['sha256'])
            except (ValueError, TypeError, RecursionError):
                pass
            return

    def refresh_relay(self):
        """Content-free failure summary; an incomplete/successful write is not all-failed."""
        failure = {}
        if self.finalized and self.refresh_output_error:
            failure = {'reasonCode': 'refresh-generator-failed', 'failureDetail': {'stage': 'output-validate', 'code': 'invalid-json'}}
        elif self.finalized and self.refresh_writes and all(
                self.refresh_results.get(seq, (False,))[0] for seq in self.refresh_writes):
            first = next(iter(self.refresh_writes))
            failure = {'reasonCode': 'refresh-write-failed', 'errorCode': self.refresh_results[first][1]}
        return (json.dumps(failure, separators=(',', ':')) + '\n').encode()

    def event(self, event, **fields):
        if self.truncated or self.failed:
            return
        row = (json.dumps({'event': event, **fields}, separators=(',', ':')) + '\n').encode()
        try:
            # Reserve room for a terminal truncation marker rather than silently ending.
            if self.bytes + len(row) > MAX_BYTES - 64:
                marker = b'{"event":"truncated"}\n'
                self.file.write(marker)
                self.bytes += len(marker)
                self.truncated = True
                return
            self.file.write(row)
            self.bytes += len(row)
        except OSError:
            # Logging is best-effort: it must never bypass transient-unit cleanup.
            self.failed = True

    def _relay_track(self, text):
        after_success = self.relay_after_success
        self.relay_after_success = False
        if text.startswith('Fatal error:'):
            self.relay_invalid = True
        elif text.startswith('Success:'):
            self.relay_successes += 1
            self.relay_invalid |= self.relay_successes > 1
            self.relay_after_success = text in ('Success: true', 'Success: false')
        elif text.startswith('Pipeline error:') and self.relay_outcome is not None:
            self.relay_invalid = True
        elif text.startswith('[outcome]'):
            self.relay_outcomes += 1
            parsed = _strict_outcome(text)
            if self.relay_outcomes > 1 or not after_success or parsed is None:
                self.relay_invalid = True
            else:
                self.relay_outcome = parsed

    def _relay_skip(self, data, continuation):
        # Once an outcome was claimed, ANY dropped line could hide a fatal error
        # or repeated summary. Before that, an oversized outcome is also invalid.
        self.relay_after_success = False
        if self.relay_outcome is not None or (not continuation and data.lstrip().startswith(b'[outcome]')):
            self.relay_invalid = True

    def relay(self, exit_code):
        """Single bounded stdout line; the unit's exit code must agree with the outcome."""
        outcome = self.relay_outcome
        if not self.finalized or self.relay_invalid or self.relay_outcomes != 1 or outcome is None:
            outcome = None
        elif outcome[0] != (exit_code == 0):
            outcome = None
        posted, reason = outcome or (False, 'absent')
        return (json.dumps({'postWritten': posted, 'stopReason': reason}, separators=(',', ':')) + '\n').encode()

    def line(self, raw):
        text = raw.decode('utf-8', 'replace').strip()
        self._relay_track(text)
        if self.refresh and text.startswith('[refresh-'):
            self.refresh_line(text)
            return
        if text.startswith('[agent]'):
            self.seen_agent = True
            return  # Neither candidate text nor assistant reasoning is persisted.
        if not self.seen_agent and not self.seen_init:
            match = MODEL.fullmatch(text)
            if match:
                self.seen_init = True
                self.event('init', model='claude-' + match[1], tools=int(match[2]))
                return
        if not self.seen_agent and not self.seen_mcp and text.startswith('[init] MCP:'):
            self.seen_mcp = True
            self.event('mcp', statuses=dict(MCP.findall(text)))
            return
        match = TOOL.fullmatch(text)
        if match:
            name = match[1]
            if name in BUILTIN_TOOLS:
                label = name
            elif name.startswith('mcp__') and name.split('__', 2)[1] in MCP_SERVERS:
                label = 'mcp:' + name.split('__', 2)[1]
            else:
                return
            self.tool_counts[label] = self.tool_counts.get(label, 0) + 1
            return
        if text.startswith('Pipeline error:'):
            # Never log the error message: it may contain a URL, candidate or key.
            self.reason = 'generator-error'
            self.event('generator-error', reason=self.reason)
            return
        if SUMMARY.fullmatch(text):
            name, value = text.split(': ', 1)
            field = name.lower()
            if field in self.summary_fields or (field != 'success' and not self.seen_summary):
                return
            if field == 'turns' and int(value) > 999:
                return
            if field == 'duration' and float(value[:-1]) > 2700:
                return
            self.summary_fields.add(field)
            if field == 'success':
                self.seen_summary = True
            self.event('summary', field=field, value=value)
            return
        if self.seen_summary and not self.seen_outcome and text.startswith('[outcome] '):
            try:
                value = json.loads(text[len('[outcome] '):])
                if type(value.get('postWritten')) is bool and value.get('stopReason') in STOP_REASONS:
                    self.seen_outcome = True
                    self.reason = value['stopReason']
                    self.event('outcome', postWritten=value['postWritten'], stopReason=self.reason)
            except (ValueError, AttributeError, TypeError, RecursionError):
                pass
        if self.seen_outcome and not self.seen_detail and text.startswith('[outcome-detail] '):
            try:
                value = json.loads(text[len('[outcome-detail] '):], object_pairs_hook=_reject_duplicate_keys)
                if type(value) is dict:
                    self.seen_detail = True
                    detail = {}
                    if isinstance(value.get('detailReason'), str) and value['detailReason'] in DETAIL_REASONS:
                        detail['detailReason'] = value['detailReason']
                    if isinstance(value.get('validationCodes'), list):
                        detail['validationCodes'] = list(dict.fromkeys(
                            code for code in value['validationCodes']
                            if isinstance(code, str) and len(code) <= 64 and code in VALIDATION_CODES
                        ))[:10]
                    self.event('outcome-detail', **detail)
            except (ValueError, AttributeError, TypeError, RecursionError):
                pass

    def feed_lines(self, chunk):
        if self.finalized:
            self.relay_invalid = True  # output after EOF finalization is never trusted
            return
        parts = (self.pending + chunk).split(b'\n')
        self.pending = parts.pop()
        for part in parts:
            if not self.dropping_line and len(part) <= MAX_LINE_BYTES:
                self.line(part)
            else:
                self._relay_skip(part, self.dropping_line)
            self.dropping_line = False
        if len(self.pending) > MAX_LINE_BYTES:
            self._relay_skip(self.pending, self.dropping_line)
            self.pending = b''
            self.dropping_line = True

    def close(self):
        if self.pending and not self.dropping_line:
            self.line(self.pending)
        self.pending = b''
        self.finalized = True
        self.event('tools', counts=self.tool_counts)
        if self.reason:
            self.event('stop-reason', reason=self.reason)
        try:
            self.file.close()
        except OSError:
            self.failed = True


def _reject_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError('duplicate key')
    return dict(pairs)


def _strict_outcome(text):
    """Two-key authority only; optional diagnostics never change the relay."""
    if not text.startswith('[outcome] '):
        return None
    try:
        value = json.loads(text[len('[outcome] '):], object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, RecursionError):
        return None
    if type(value) is not dict or not {'postWritten', 'stopReason'} <= set(value):
        return None
    if set(value) - {'postWritten', 'stopReason', 'detailReason', 'validationCodes'}:
        return None
    posted, reason = value['postWritten'], value['stopReason']
    if type(posted) is not bool or type(reason) is not str or reason not in STOP_REASONS:
        return None
    if posted != (reason == 'post-written'):
        return None
    return posted, reason


def capture_generator(cmd, diagnostic, timeout):
    """Drain all output, persist only allowlisted events, and honor helper timeout."""
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + timeout
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(cmd, timeout)
            for key, _ in selector.select(min(remaining, 1)):
                chunk = os.read(key.fd, 4096)
                if chunk:
                    diagnostic.feed_lines(chunk)
                else:
                    selector.unregister(key.fileobj)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise subprocess.TimeoutExpired(cmd, timeout)
        return process.wait(timeout=remaining)
    finally:
        selector.close()
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        # The caller stops the transient systemd unit on timeout/failure.
