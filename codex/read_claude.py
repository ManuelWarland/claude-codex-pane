#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""read_claude.py: print Claude Code's latest answer, for Codex.

The other half of codex-pane: the pane shows the Codex session to Claude; this
script lets Codex read the most recent Claude Code session, with no copy-paste
(pasting damages the formatting).

Usage (from Codex, or any terminal):
    python read_claude.py                    # Claude's latest answer
    python read_claude.py --project myapp    # only sessions whose project folder matches
    python read_claude.py --n 2              # the 2 latest answers
    python read_claude.py --json             # JSON output

Source: the most recently modified transcript in
~/.claude/projects/<project>/<session>.jsonl (read only, nothing is changed).
An "answer" is all the text Claude wrote after a real user message (tool calls
and their results are left out). While Claude is still writing, the answer is
marked "in progress".
"""

import argparse
import json
import os
import sys
from datetime import datetime

ROOT = os.path.join(os.path.expanduser("~"), ".claude", "projects")
MAX_BYTES = 6_000_000


def latest_transcript(project_filter):
    best, best_mtime = None, -1.0
    if not os.path.isdir(ROOT):
        return None
    for project in os.listdir(ROOT):
        if project_filter and project_filter.lower() not in project.lower():
            continue
        pdir = os.path.join(ROOT, project)
        if not os.path.isdir(pdir):
            continue
        for name in os.listdir(pdir):
            if name.endswith(".jsonl"):
                path = os.path.join(pdir, name)
                mtime = os.path.getmtime(path)
                if mtime > best_mtime:
                    best, best_mtime = path, mtime
    return best


def read_tail(path):
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size > MAX_BYTES:
            fh.seek(size - MAX_BYTES)
            fh.readline()
        return fh.read().decode("utf-8", errors="replace").splitlines()


def is_real_user_message(entry):
    """A real user message: not a tool result, not a system reminder, not a command."""
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain"):
        return False
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return False
        text = " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    else:
        return False
    text = text.strip()
    return bool(text) and not text.startswith("<local-command") and not text.startswith("<command-name>")


def answers(lines):
    """List of answers: {question, text, ts, finished}."""
    result = []
    current = None
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if is_real_user_message(entry):
            content = entry["message"]["content"]
            question = content if isinstance(content, str) else " ".join(
                b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
            current = {"question": question.strip(), "text": [], "ts": entry.get("timestamp", ""), "finished": False}
            result.append(current)
            continue
        if current is None or entry.get("type") != "assistant" or entry.get("isSidechain"):
            continue
        message = entry.get("message") or {}
        for block in message.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text", "").strip():
                current["text"].append(block["text"].strip())
                current["ts"] = entry.get("timestamp", current["ts"])
        current["finished"] = message.get("stop_reason") == "end_turn"
    return [a for a in result if a["text"]]


def local_time(iso):
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", default="", help="only sessions whose project folder name contains this text")
    ap.add_argument("--n", type=int, default=1, help="number of answers to print")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    path = latest_transcript(args.project)
    if not path:
        print("No Claude Code session found in " + ROOT + ".")
        return 1
    found = answers(read_tail(path))[-max(1, args.n):]
    project = os.path.basename(os.path.dirname(path))
    if args.json:
        print(json.dumps({"project": project, "file": path, "answers": found}, ensure_ascii=False, indent=2))
        return 0
    if not found:
        print("No answer from Claude in session " + project + ".")
        return 0
    for a in found:
        status = "finished" if a["finished"] else "IN PROGRESS (Claude is still writing)"
        print("=== Claude's answer · " + project + " · " + local_time(a["ts"]) + " · " + status + " ===")
        print("User message: " + " ".join(a["question"].split())[:300])
        print()
        print("\n\n".join(a["text"]))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
