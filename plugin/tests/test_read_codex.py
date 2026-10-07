"""Which Codex sessions the pane follows (run: python -m unittest discover -s plugin/tests)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
import read_codex  # noqa: E402


class TerminalSessionTest(unittest.TestCase):
    def check(self, source, originator, expected):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "rollout-test.jsonl")
            with open(path, "w", encoding="utf-8") as fh:
                meta = {"type": "session_meta", "payload": {"source": source, "originator": originator}}
                fh.write(json.dumps(meta) + "\n")
            self.assertEqual(read_codex.is_terminal_session(path), expected, (source, originator))

    def test_terminal_without_daemon(self):
        self.check("cli", "codex-tui", True)

    def test_terminal_through_the_daemon(self):
        self.check("vscode", "codex-tui", True)

    def test_other_app_server_clients_are_left_out(self):
        self.check("vscode", "agentroom", False)
        self.check("vscode", "Codex Desktop", False)
        self.check("vscode", "Claude Code", False)

    def test_exec_and_subagents_are_left_out(self):
        self.check("exec", "codex_exec", False)
        self.check({"subagent": {}}, "codex-tui", False)

    def test_unreadable_file(self):
        self.assertFalse(read_codex.is_terminal_session(os.path.join(tempfile.gettempdir(), "missing-rollout.jsonl")))


if __name__ == "__main__":
    unittest.main()
