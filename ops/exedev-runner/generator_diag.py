"""Bounded, content-free diagnostics for the isolated content generator.

Only root may create/read these files. Generator stdout is consumed in memory, but
candidate text, tool output, environment values and raw errors are never persisted.

relay() is the helper's only stdout: one fixed-vocabulary line derived from exactly
one EOF-finalized [outcome] that directly follows the single Success: line. Anything
doubtful (duplicate, early/late, malformed, unknown enum, contradiction) is 'absent'.
"""
import json
import os
import re
import selectors
import subprocess
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


class GeneratorDiagnostic:
    def __init__(self, path):
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
    """(postWritten, stopReason) for the agent's exact two-key outcome, else None."""
    if not text.startswith('[outcome] '):
        return None
    try:
        value = json.loads(text[len('[outcome] '):], object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, RecursionError):
        return None
    if type(value) is not dict or set(value) != {'postWritten', 'stopReason'}:
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
