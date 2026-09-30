import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'ops/exedev-runner/generator_diag.py'
spec = importlib.util.spec_from_file_location('generator_diag', MODULE)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


class GeneratorDiagnosticTest(unittest.TestCase):
    def test_keeps_only_structured_outcome_and_never_persists_content(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            path = pathlib.Path(directory) / 'slot.jsonl'
            log = diag.GeneratorDiagnostic(str(path))
            content = ('[init] Model: claude-sonnet-4-5-20250929, Tools: 69\n'
                       '[init] MCP: gsc(connected), ga4(connected), playwright(connected)\n'
                       '[agent] I need to halt the pipeline. This claim violates the grounding rules. pet-friendly Candidate Name sk-PRIVATE\n'
                       '[tool_use] Bash\n'
                       'Pipeline error: secret=sk-PRIVATE candidate=Candidate Name\n'
                       'Success: true\n'
                       '[outcome] {"postWritten":false,"stopReason":"unsupported-grounding","extra":"Candidate Name"}\n'
                       'Turns: 7\n')
            for character in content.encode():
                log.feed_lines(bytes([character]))
            log.close()
            rows = [json.loads(row) for row in path.read_text().splitlines()]
            text = path.read_text()
            self.assertNotIn('Candidate Name', text)
            self.assertNotIn('sk-PRIVATE', text)
            self.assertNotIn('pet-friendly', text)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertIn({'event': 'outcome', 'postWritten': False, 'stopReason': 'unsupported-grounding'}, rows)
            self.assertIn({'event': 'tools', 'counts': {'Bash': 1}}, rows)

    def test_multiline_preview_and_tool_names_cannot_spoof_diagnostic_fields(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            path = pathlib.Path(directory) / 'slot.jsonl'
            log = diag.GeneratorDiagnostic(str(path))
            log.feed_lines(b'[init] Model: claude-sonnet-4-5-20250929, Tools: 69\n')
            log.feed_lines(b'[init] MCP: gsc(connected), ga4(connected), playwright(connected)\n')
            log.feed_lines(b'[agent] Candidate article starts here\n')
            log.feed_lines(b'[init] Model: claude-sonnet-3-5-20250929, Tools: 1\n')
            log.feed_lines(b'[init] MCP: JaneDoeHomeAddr(connected)\n')
            log.feed_lines(b'[tool_use] Candidate_Business_Name\n')
            log.feed_lines(b'[tool_use] mcp__gsc__Candidate_Business_Name\n')
            log.feed_lines(b'[outcome] {"postWritten":true,"stopReason":"post-written"}\n')
            log.feed_lines(b'Success: true\n')
            log.feed_lines(b'[outcome] {"postWritten":false,"stopReason":"unsupported-grounding"}\n')
            log.close()
            text = path.read_text()
            rows = [json.loads(row) for row in text.splitlines()]
            self.assertNotIn('Candidate', text)
            self.assertNotIn('JaneDoe', text)
            self.assertEqual(len([row for row in rows if row['event'] == 'init']), 1)
            self.assertEqual(len([row for row in rows if row['event'] == 'mcp']), 1)
            self.assertIn({'event': 'outcome', 'postWritten': False, 'stopReason': 'unsupported-grounding'}, rows)
            self.assertIn({'event': 'tools', 'counts': {'mcp:gsc': 1}}, rows)

    def test_recursive_outcome_and_repeated_numeric_summary_are_not_persisted(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            path = pathlib.Path(directory) / 'slot.jsonl'
            log = diag.GeneratorDiagnostic(str(path))
            log.feed_lines(b'[agent] starting\nSuccess: true\n')
            log.feed_lines(b'[outcome] ' + b'[' * 4000 + b'\n')
            log.feed_lines(b'Turns: 13\nTurns: 847\nDuration: 5550100s\nDuration: 42.3s\nDuration: 43s\n')
            log.close()
            text = path.read_text()
            rows = [json.loads(row) for row in text.splitlines()]
            self.assertNotIn('5550100', text)
            self.assertEqual([row for row in rows if row.get('field') == 'turns'],
                             [{'event': 'summary', 'field': 'turns', 'value': '13'}])
            self.assertEqual([row for row in rows if row.get('field') == 'duration'],
                             [{'event': 'summary', 'field': 'duration', 'value': '42.3s'}])

    def test_diagnostic_write_failure_never_interrupts_generator_cleanup(self):
        class BrokenFile:
            def write(self, _data):
                raise OSError('disk full')
            def close(self):
                raise OSError('disk full')
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            log = diag.GeneratorDiagnostic(str(pathlib.Path(directory) / 'slot.jsonl'))
            original = log.file
            log.file = BrokenFile()
            log.event('unit-timeout')
            self.assertTrue(log.failed)
            log.close()  # best-effort logging must not skip _stop_unit or ownership handling
            original.close()

    def test_bounded_with_truncation_marker_and_rejects_nonroot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'slot.jsonl'
            with mock.patch.object(diag.os, 'geteuid', return_value=501):
                with self.assertRaises(PermissionError):
                    diag.GeneratorDiagnostic(str(path))
            with mock.patch.object(diag.os, 'geteuid', return_value=0):
                log = diag.GeneratorDiagnostic(str(path))
            for _ in range(5000):
                log.event('summary', field='duration', value='123.4s')
            log.close()
            self.assertLessEqual(path.stat().st_size, 64 * 1024)
            self.assertIn('"event":"truncated"', path.read_text())

    def test_capture_process_and_discard_raw_stderr(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            path = pathlib.Path(directory) / 'slot.jsonl'
            log = diag.GeneratorDiagnostic(str(path))
            cmd = [sys.executable, '-c', "import sys;print('[tool_use] Bash');print('Success: true');print('[outcome] {\\\"postWritten\\\":true,\\\"stopReason\\\":\\\"post-written\\\"}');print('secret=sk-PRIVATE',file=sys.stderr)"]
            result = diag.capture_generator(cmd, log, timeout=10)
            log.close()
            self.assertEqual(result, 0)
            self.assertNotIn('sk-PRIVATE', path.read_text())
            self.assertIn('post-written', path.read_text())



TRAILER = ('\n=== Pipeline Complete ===\n'
           'Success: true\n'
           '[outcome] {"postWritten":false,"stopReason":"unsupported-grounding"}\n'
           'Cost: $0.4100\nTurns: 7\nDuration: 42.3s\nLog saved: /x/2026-09-30.json\n')
ABSENT = b'{"postWritten":false,"stopReason":"absent"}\n'


class RelayTest(unittest.TestCase):
    """The helper's single stdout line: exactly one EOF-finalized allowlisted outcome."""

    def relay(self, content, exit_code=1, close=True, bytewise=False):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            log = diag.GeneratorDiagnostic(str(pathlib.Path(directory) / 'slot.jsonl'))
            data = content.encode() if isinstance(content, str) else content
            if bytewise:
                for character in data:
                    log.feed_lines(bytes([character]))
            else:
                log.feed_lines(data)
            if close:
                log.close()
            line = log.relay(exit_code)
            if not close:
                log.close()
            return line

    def test_valid_refusal_and_post_are_relayed_once_after_eof(self):
        prose = '[agent] Candidate Name at 1 Private Rd is pet-friendly sk-PRIVATE\n[tool_use] Bash\n'
        self.assertEqual(self.relay(prose + TRAILER, 1, bytewise=True),
                         b'{"postWritten":false,"stopReason":"unsupported-grounding"}\n')
        self.assertEqual(self.relay(prose + TRAILER.replace('unsupported-grounding', 'insufficient-sources'), 1),
                         b'{"postWritten":false,"stopReason":"insufficient-sources"}\n')
        posted = TRAILER.replace('{"postWritten":false,"stopReason":"unsupported-grounding"}',
                                 '{"postWritten":true,"stopReason":"post-written"}')
        self.assertEqual(self.relay(prose + posted, 0), b'{"postWritten":true,"stopReason":"post-written"}\n')
        final = TRAILER.replace('\nCost: $0.4100\nTurns: 7\nDuration: 42.3s\nLog saved: /x/2026-09-30.json\n', '')
        self.assertEqual(self.relay(final, 1), b'{"postWritten":false,"stopReason":"unsupported-grounding"}\n',
                         'an unterminated final outcome is finalized at EOF')

    def test_unfinalized_or_late_after_eof_is_absent(self):
        self.assertEqual(self.relay(TRAILER, 1, close=False), ABSENT)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            log = diag.GeneratorDiagnostic(str(pathlib.Path(directory) / 'slot.jsonl'))
            log.feed_lines(TRAILER.encode())
            log.close()
            log.feed_lines(b'[outcome] {"postWritten":false,"stopReason":"insufficient-sources"}\n')
            self.assertEqual(log.relay(1), ABSENT)

    def test_duplicate_early_late_or_repeated_summary_invalidates(self):
        dup = TRAILER + '[outcome] {"postWritten":false,"stopReason":"unsupported-grounding"}\n'
        early = '[outcome] {"postWritten":false,"stopReason":"insufficient-sources"}\n' + TRAILER
        late = TRAILER.replace('Success: true\n[outcome]', 'Success: true\nCost: $0\n[outcome]')
        gap = TRAILER.replace('Success: true\n[outcome]', 'Success: true\n\n[outcome]')
        repeat = 'Success: true\n' + TRAILER
        spoof_first = ('Success: true\n[outcome] {"postWritten":false,"stopReason":"unsupported-grounding"}\n'
                       + TRAILER.replace('unsupported-grounding', 'no-post-unspecified'))
        for content in (dup, early, late, gap, repeat, spoof_first):
            self.assertEqual(self.relay(content, 1), ABSENT, content)

    def test_malformed_out_of_vocabulary_and_contradictory_outcomes_are_absent(self):
        for payload in ('{"postWritten":false,"stopReason":"unsupported-grounding","extra":"Candidate"}',
                        '{"postWritten":false,"postWritten":false,"stopReason":"unsupported-grounding"}',
                        '{"postWritten":"false","stopReason":"unsupported-grounding"}',
                        '{"postWritten":0,"stopReason":"unsupported-grounding"}',
                        '{"postWritten":false,"stopReason":"pet-friendly"}',
                        '{"postWritten":false,"stopReason":"absent"}',
                        '{"postWritten":false}', '[false,"unsupported-grounding"]', '{"postWritten":false,',
                        '{"postWritten":true,"stopReason":"unsupported-grounding"}',
                        '{"postWritten":false,"stopReason":"post-written"}',
                        '{"postWritten":false,"stopReason":"unsupported-grounding"} trailing'):
            content = TRAILER.replace('{"postWritten":false,"stopReason":"unsupported-grounding"}', payload)
            self.assertEqual(self.relay(content, 1), ABSENT, payload)
        posted = TRAILER.replace('{"postWritten":false,"stopReason":"unsupported-grounding"}',
                                 '{"postWritten":true,"stopReason":"post-written"}')
        self.assertEqual(self.relay(posted, 1), ABSENT, 'post outcome contradicts a nonzero unit exit')
        self.assertEqual(self.relay(TRAILER, 0), ABSENT, 'refusal contradicts a zero unit exit')
        self.assertEqual(self.relay('[outcome] ' + '[' * 3000 + '\n' + TRAILER, 1), ABSENT)

    def test_fatal_error_or_oversized_outcome_line_invalidates(self):
        self.assertEqual(self.relay(TRAILER + 'Fatal error: Error: EACCES Candidate Name\n', 1), ABSENT)
        oversized = '[outcome] {"postWritten":false,"stopReason":"unsupported-grounding","x":"' + 'A' * 5000 + '"}\n'
        self.assertEqual(self.relay(TRAILER.replace('Cost:', oversized + 'Cost:'), 1), ABSENT)
        self.assertEqual(self.relay('[agent] ' + 'B' * 9000 + '\n' + TRAILER, 1),
                         b'{"postWritten":false,"stopReason":"unsupported-grounding"}\n',
                         'an oversized non-outcome line does not poison a valid relay')
        self.assertEqual(self.relay('[agent] no outcome at all\n', 1), ABSENT)

    def test_oversized_error_or_duplicate_summary_after_refusal_invalidates_relay(self):
        for trailing in ('Fatal error: ' + 'X' * 5000,
                         'Pipeline error: ' + 'X' * 5000,
                         'Success: ' + 'X' * 5000):
            payload = '[agent] example\n' + TRAILER + trailing + '\n'
            self.assertEqual(self.relay(payload, 1, bytewise=True), ABSENT, trailing[:30])
        self.assertEqual(self.relay(TRAILER + 'Pipeline error: late failure\n', 1), ABSENT)

    def test_relay_line_is_fixed_vocabulary_and_never_carries_prose(self):
        prose = ('[agent] Candidate Name sk-PRIVATE pet-friendly\n'
                 'Pipeline error: https://serpapi.com/?api_key=sk-PRIVATE Candidate Name\n')
        allowed = {(json.dumps({'postWritten': reason == 'post-written', 'stopReason': reason},
                               separators=(',', ':')) + '\n').encode()
                   for reason in diag.STOP_REASONS | {'absent'}}
        for content, code in ((prose + TRAILER, 1), (prose, 1), (prose + TRAILER, 0), (b'\xff\xfe' + prose.encode(), 1)):
            line = self.relay(content, code)
            self.assertIn(line, allowed)
            self.assertLessEqual(len(line), 80)
            for secret in (b'Candidate', b'sk-PRIVATE', b'pet-friendly', b'serpapi'):
                self.assertNotIn(secret, line)


if __name__ == '__main__':
    unittest.main()
