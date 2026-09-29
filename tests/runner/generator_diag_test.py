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
                       '[outcome] {"postWritten":false,"stopReason":"unsupported-grounding","extra":"Candidate Name"}\n'
                       'Turns: 7\nSuccess: true\n')
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

    def test_bounded_with_truncation_marker_and_rejects_nonroot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'slot.jsonl'
            with mock.patch.object(diag.os, 'geteuid', return_value=501):
                with self.assertRaises(PermissionError):
                    diag.GeneratorDiagnostic(str(path))
            with mock.patch.object(diag.os, 'geteuid', return_value=0):
                log = diag.GeneratorDiagnostic(str(path))
            for _ in range(5000):
                log.feed_lines(b'[init] Model: claude-sonnet-4-5-20250929, Tools: 69\n')
            log.close()
            self.assertLessEqual(path.stat().st_size, 64 * 1024)
            self.assertIn('"event":"truncated"', path.read_text())

    def test_capture_process_and_discard_raw_stderr(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(diag.os, 'geteuid', return_value=0):
            path = pathlib.Path(directory) / 'slot.jsonl'
            log = diag.GeneratorDiagnostic(str(path))
            cmd = [sys.executable, '-c', "import sys;print('[tool_use] Bash');print('[outcome] {\\\"postWritten\\\":true,\\\"stopReason\\\":\\\"post-written\\\"}');print('secret=sk-PRIVATE',file=sys.stderr)"]
            result = diag.capture_generator(cmd, log, timeout=10)
            log.close()
            self.assertEqual(result, 0)
            self.assertNotIn('sk-PRIVATE', path.read_text())
            self.assertIn('post-written', path.read_text())


if __name__ == '__main__':
    unittest.main()
