"""Bounded, content-free diagnostics for the isolated content generator.

Only root may create/read these files. Generator stdout is consumed in memory, but
candidate text, tool output, environment values and raw errors are never persisted.
"""
import json
import os
import re
import selectors
import subprocess
import time

MAX_BYTES = 64 * 1024
MAX_LINE_BYTES = 4096
SAFE_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_.-]{0,63}$')
MODEL = re.compile(r'^\[init\] Model: ([A-Za-z0-9_.-]+), Tools: (\d{1,4})$')
TOOL = re.compile(r'^\[tool_use\] ([A-Za-z][A-Za-z0-9_-]{0,63})$')
MCP = re.compile(r'([A-Za-z][A-Za-z0-9_-]{0,63})\((connected|failed|disconnected|unknown)\)')
SUMMARY = re.compile(r'^(Success: (?:true|false)|Turns: \d{1,4}|Duration: \d+(?:\.\d+)?s)$')
STOP_REASONS = frozenset(('post-written', 'unsupported-grounding', 'duplicate',
                          'insufficient-sources', 'no-post-unspecified',
                          'sdk-error', 'generator-error'))


def stop_reason(text):
    """Classify an assistant stop without retaining its untrusted prose."""
    text = str(text).lower()
    if ('halt' in text or 'stop' in text or 'cannot' in text) and ('grounding' in text or 'unsupported' in text):
        return 'unsupported-grounding'
    if ('halt' in text or 'stop' in text) and ('duplicate' in text or 'overlap' in text):
        return 'duplicate'
    if ('halt' in text or 'stop' in text) and ('sources' in text or 'evidence' in text):
        return 'insufficient-sources'
    return None


class GeneratorDiagnostic:
    def __init__(self, path):
        if os.geteuid() != 0:
            raise PermissionError('generator diagnostic must be created by root')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.file = os.fdopen(fd, 'wb', buffering=0)
        self.bytes = 0
        self.truncated = False
        self.pending = b''
        self.dropping_line = False
        self.tool_counts = {}
        self.reason = None

    def event(self, event, **fields):
        if self.truncated:
            return
        row = (json.dumps({'event': event, **fields}, separators=(',', ':')) + '\n').encode()
        # Reserve room for a terminal truncation marker rather than silently ending.
        if self.bytes + len(row) > MAX_BYTES - 64:
            marker = b'{"event":"truncated"}\n'
            self.file.write(marker)
            self.bytes += len(marker)
            self.truncated = True
            return
        self.file.write(row)
        self.bytes += len(row)

    def line(self, raw):
        text = raw.decode('utf-8', 'replace').strip()
        match = MODEL.fullmatch(text)
        if match:
            self.event('init', model=match[1], tools=int(match[2]))
            return
        if text.startswith('[init] MCP:'):
            statuses = {name: status for name, status in MCP.findall(text) if SAFE_NAME.fullmatch(name)}
            self.event('mcp', statuses=statuses)
            return
        match = TOOL.fullmatch(text)
        if match:
            name = match[1]
            self.tool_counts[name] = self.tool_counts.get(name, 0) + 1
            return
        if text.startswith('[agent]'):
            reason = stop_reason(text[7:])
            if reason:
                self.reason = reason
                self.event('assistant-stop', reason=reason)
            return
        if text.startswith('Pipeline error:'):
            # Never log the error message: it may contain a URL, candidate or key.
            self.reason = 'generator-error'
            self.event('generator-error', reason=self.reason)
            return
        if text.startswith('[outcome] '):
            try:
                value = json.loads(text[len('[outcome] '):])
                if type(value.get('postWritten')) is bool and value.get('stopReason') in STOP_REASONS:
                    self.reason = value['stopReason']
                    self.event('outcome', postWritten=value['postWritten'], stopReason=self.reason)
            except (ValueError, AttributeError, TypeError):
                pass
            return
        if SUMMARY.fullmatch(text):
            name, value = text.split(': ', 1)
            self.event('summary', field=name.lower(), value=value)

    def feed_lines(self, chunk):
        parts = (self.pending + chunk).split(b'\n')
        self.pending = parts.pop()
        for part in parts:
            if not self.dropping_line and len(part) <= MAX_LINE_BYTES:
                self.line(part)
            self.dropping_line = False
        if len(self.pending) > MAX_LINE_BYTES:
            self.pending = b''
            self.dropping_line = True

    def close(self):
        if self.pending and not self.dropping_line:
            self.line(self.pending)
        self.event('tools', counts=self.tool_counts)
        if self.reason:
            self.event('stop-reason', reason=self.reason)
        self.file.close()


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
