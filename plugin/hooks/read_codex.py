#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read the most recent Codex CLI session and print its conversation as JSON.

Usage:
    python read_codex.py [--root $CODEX_HOME/sessions] [--max-bytes 3000000] [--limit 8]
    python read_codex.py --file <rollout-*.jsonl>     # one given session
    python read_codex.py --list 3                    # up to 3 open terminal sessions

Codex writes each session live to <root>/YYYY/MM/DD/rollout-*.jsonl, the root
being $CODEX_HOME/sessions (~/.codex/sessions by default). We read
the end of the file (long sessions exceed 30 MB) and keep:
- the user's messages (UserMessage) and Codex's (AgentMessage);
- the latest activity (a command run or a file changed);
- the state: busy when a task started after the last one completed;
- the final answer of the last completed task (task_complete);
- the current exchange: the user's last message and every Codex reply since,
  finished or not (this is what the pane relays to Claude).
Output: {file, session, thread_id, cwd, live, mtime, busy, activity, messages,
final, exchange}, live being null when open sessions cannot be told; or
{error, detail} where error is no_root, no_file or no_session.
Every message, the activity and the final answer carry ts (UTC) and hm (local
HH:MM). The output is pure ASCII JSON, so no console encoding can break it.
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

DAYS_SCANNED = 3


def local_hm(ts):
    """HH:MM in the machine's local time for a Codex UTC timestamp; '' if unreadable."""
    try:
        dt = datetime.strptime(str(ts)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%H:%M")
    except ValueError:
        return ""


def emit(obj):
    print(json.dumps(obj, ensure_ascii=True))


def recent_days(root):
    """Day folders (root/YYYY/MM/DD) from the most recent, at most DAYS_SCANNED."""
    days = []
    for year in sorted(os.listdir(root), reverse=True):
        ypath = os.path.join(root, year)
        if not os.path.isdir(ypath):
            continue
        for month in sorted(os.listdir(ypath), reverse=True):
            mpath = os.path.join(ypath, month)
            if not os.path.isdir(mpath):
                continue
            for day in sorted(os.listdir(mpath), reverse=True):
                dpath = os.path.join(mpath, day)
                if os.path.isdir(dpath):
                    days.append(dpath)
                if len(days) >= DAYS_SCANNED:
                    return days
    return days


def lock_is_held(path):
    """True when a running Codex process holds this thread lock.

    Codex takes an exclusive File::try_lock (LockFileEx on Windows, flock
    elsewhere). Windows: reading a held lock fails with PermissionError.
    Elsewhere: a shared non-blocking flock fails with BlockingIOError, and is
    released at once when it succeeds. Any other error (the lock was just
    removed, unreadable file) counts as not held, so a closed session is never
    offered as open.
    """
    try:
        fh = open(path, "rb")
    except OSError:
        return False
    with fh:
        if os.name == "nt":
            try:
                fh.read(1)
            except PermissionError:
                return True
            except OSError:
                return False
            return False
        import fcntl
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        except OSError:
            return False
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        return False


def live_thread_ids(root):
    """Ids of the Codex threads open right now, or None when this cannot be told.

    A running Codex session holds <CODEX_HOME>/thread-writer-locks/<thread id>.lock.
    """
    lock_dir = os.path.join(os.path.dirname(os.path.abspath(root)), "thread-writer-locks")
    try:
        names = os.listdir(lock_dir)
    except OSError:
        return None  # no lock folder, or unreadable: open sessions cannot be told
    ids = set()
    for name in names:
        if name.endswith(".lock") and not name.startswith(".") and lock_is_held(os.path.join(lock_dir, name)):
            ids.add(name[:-len(".lock")])
    return ids


def thread_id_of(name):
    """Thread id at the end of a rollout file name (rollout-<local time>-<id>.jsonl)."""
    return name[-len(".jsonl") - 36:-len(".jsonl")]


def session_entry(path, live):
    return {"path": path, "mtime": os.path.getmtime(path), "last_ts": last_timestamp(path) or "", "live": live}


def main_sessions(root):
    """Terminal sessions, most recent first: [{path, mtime, last_ts, live}].

    The open sessions (see live_thread_ids) come first, wherever their file is
    (a session can stay open for days); then the closed sessions of the recent
    days. Two traps:
    - subagents started by Codex have their own file, which is not the user's
      conversation (see is_terminal_session);
    - Windows does not update the modification time of a file kept open, so
      sessions are sorted by the timestamp of their last written line.
    """
    live = live_thread_ids(root)
    found = {}
    for dpath in recent_days(root):
        for name in os.listdir(dpath):
            if name.startswith("rollout-") and name.endswith(".jsonl"):
                path = os.path.join(dpath, name)
                if is_terminal_session(path):
                    found[thread_id_of(name)] = session_entry(path, bool(live and thread_id_of(name) in live))
    for tid in (live or set()) - set(found):
        for path in glob.glob(os.path.join(root, "*", "*", "*", "rollout-*-" + tid + ".jsonl")):
            if is_terminal_session(path):
                found[tid] = session_entry(path, True)
    sessions = list(found.values())
    sessions.sort(key=lambda s: (s["live"], s["last_ts"], s["mtime"]), reverse=True)
    return sessions, live is not None


def session_meta(path):
    """Payload of the first line (session_meta); {} when unreadable."""
    try:
        with open(path, "rb") as fh:
            meta = json.loads(fh.readline().decode("utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}
    return meta.get("payload") or {}


def is_terminal_session(path):
    """True for a conversation the user opened in a Codex terminal (source "cli").

    Subagents (source {"subagent": ...}), `codex exec` runs (source "exec") and
    editor integrations (source "vscode") are left out.
    """
    return session_meta(path).get("source") == "cli"


def session_name(path):
    return os.path.basename(path)[len("rollout-"):-len(".jsonl")]


def list_sessions(root, count):
    """Sessions offered by the pane's session picker, with their folder and the
    user's last message: the `count` most recently active open ones when open
    sessions can be told, otherwise the `count` most recent."""
    sessions, known = main_sessions(root)
    chosen = [s for s in sessions if s["live"]][:count] if known else sessions[:count]
    out = []
    for s in chosen:
        meta = session_meta(s["path"])
        parsed = parse_lines(read_tail(s["path"], 2_000_000))
        user = [m for m in parsed["messages"] if m["role"] == "user"]
        out.append({
            "file": s["path"],
            "session": session_name(s["path"]),
            "thread_id": meta.get("id", ""),
            "cwd": meta.get("cwd", ""),
            "last_ts": s["last_ts"],
            "live": s["live"],
            "last_user": user[-1]["text"][:200] if user else "",
        })
    return out


def last_timestamp(path, tail_bytes=65536):
    """ISO (UTC) timestamp of the file's last complete line."""
    try:
        lines = read_tail(path, tail_bytes)
    except OSError:
        return None
    for line in reversed(lines):
        try:
            ts = json.loads(line).get("timestamp")
        except ValueError:
            continue
        if isinstance(ts, str):
            return ts
    return None


def read_tail(path, max_bytes):
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size > max_bytes:
            fh.seek(size - max_bytes)
            fh.readline()  # cut line
        data = fh.read()
    return data.decode("utf-8", errors="replace").splitlines()


def text_of(content):
    parts = []
    for block in content or []:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(parts).strip()


def parse_lines(lines):
    messages = []
    activity = None
    final = None
    last_started = ""
    last_complete = ""
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") != "event_msg":
            continue
        payload = event.get("payload") or {}
        ts = event.get("timestamp", "")
        hm = local_hm(ts)
        kind = payload.get("type")
        if kind == "task_started":
            last_started = ts
        elif kind == "task_complete":
            last_complete = ts
            text = (payload.get("last_agent_message") or "").strip()
            if text:
                final = {"text": text, "ts": ts, "hm": hm, "turn_id": payload.get("turn_id", "")}
        elif kind == "item_completed":
            item = payload.get("item") or {}
            itype = item.get("type")
            if itype == "UserMessage":
                text = text_of(item.get("content"))
                if text:
                    messages.append({"role": "user", "text": text, "ts": ts, "hm": hm})
            elif itype == "AgentMessage":
                text = text_of(item.get("content"))
                if text:
                    messages.append({"role": "codex", "text": text, "ts": ts, "hm": hm})
            elif itype == "CommandExecution":
                cmd = item.get("command") or []
                shown = cmd[-1] if isinstance(cmd, list) and cmd else str(cmd)
                activity = {"kind": "command", "text": " ".join(str(shown).split())[:160], "ts": ts, "hm": hm}
            elif itype == "FileChange":
                files = list((item.get("changes") or {}).keys())
                names = [os.path.basename(f) for f in files]
                activity = {"kind": "file", "text": ", ".join(names)[:160], "ts": ts, "hm": hm}
    return {
        "messages": messages,
        "activity": activity,
        "final": final,
        "last_started": last_started,
        "last_complete": last_complete,
    }


def summarize(path, mtime, parsed, limit, live):
    # Current exchange: the user's last message and everything Codex wrote since
    # (progress messages included). A long task can run for many minutes with no
    # task_complete, so the last final answer would be stale.
    messages = parsed["messages"]
    last_user = max((i for i, m in enumerate(messages) if m["role"] == "user"), default=None)
    busy = bool(parsed["last_started"] and parsed["last_started"] > parsed["last_complete"])
    exchange = None
    if last_user is not None:
        replies = [m for m in messages[last_user + 1:] if m["role"] == "codex"]
        exchange = {
            "user": messages[last_user],
            "codex": replies,
            "done": not busy,
            "last_ts": replies[-1]["ts"] if replies else messages[last_user]["ts"],
        }
    meta = session_meta(path)
    return {
        "file": path,
        "session": session_name(path),
        "thread_id": meta.get("id", ""),
        "cwd": meta.get("cwd", ""),
        "live": live,
        "mtime": mtime,
        "busy": busy,
        "activity": parsed["activity"],
        "messages": messages[-limit:],
        "final": parsed["final"],
        "exchange": exchange,
    }


def main():
    ap = argparse.ArgumentParser()
    codex_home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    ap.add_argument("--root", default=os.path.join(codex_home, "sessions"))
    ap.add_argument("--max-bytes", type=int, default=3_000_000)
    ap.add_argument("--limit", type=int, default=8)
    ap.add_argument("--file", help="read this session instead of the most recent one")
    ap.add_argument("--list", type=int, metavar="N", help="list the open terminal sessions (the N most recent when that cannot be told)")
    args = ap.parse_args()

    if not os.path.isdir(args.root):
        emit({"error": "no_root", "detail": args.root})
        return 0
    if args.list:
        emit({"sessions": list_sessions(args.root, args.list)})
        return 0
    if args.file:
        if not os.path.isfile(args.file):
            emit({"error": "no_file", "detail": args.file})
            return 0
        path, mtime = args.file, os.path.getmtime(args.file)
        ids = live_thread_ids(args.root)
        live = None if ids is None else thread_id_of(os.path.basename(path)) in ids
    else:
        # Automatic: the most recently active open session, or the most recent
        # closed one when none is open.
        sessions, known = main_sessions(args.root)
        if not sessions:
            emit({"error": "no_session", "detail": args.root})
            return 0
        path, mtime = sessions[0]["path"], sessions[0]["mtime"]
        live = sessions[0]["live"] if known else None

    # Widen the tail read until the user's last message is found: a long Codex
    # task can write tens of MB after it.
    size = os.path.getsize(path)
    for limit in (args.max_bytes, 12_000_000, 50_000_000, size):
        parsed = parse_lines(read_tail(path, limit))
        if any(m["role"] == "user" for m in parsed["messages"]) or limit >= size:
            break
    emit(summarize(path, mtime, parsed, args.limit, live))
    return 0


if __name__ == "__main__":
    sys.exit(main())
