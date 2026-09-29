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


if __name__ == '__main__':
    unittest.main()
