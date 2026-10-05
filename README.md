# claude-codex-pane

[Français](README.fr.md) | **English**

A side pane in Claude Code that follows your Codex CLI session live, and relays messages between the two agents when you decide to, one keypress and one confirmation at a time.

![The Codex pane on the right of Claude Code: Codex's exchange relayed to Claude, and Claude's review with a codex block](docs/pane.png)

You run Codex in one terminal and Claude Code in another. Instead of copying answers from one window to the other, you open `/codex` in Claude Code:

- the pane shows what Codex is doing right now: working or idle, the last command it ran or file it changed, and the latest messages;
- **Send to Claude** puts the current exchange (your last message to Codex and every reply since) into Claude's conversation;
- **Send to Codex** queues Claude's latest answer into your Codex session, after you confirm. If Claude wrote one or more ` ```codex ` blocks, only those go, so the instructions meant for you stay out.

Nothing is relayed automatically. The two agents never talk to each other behind your back.

| You confirm every send to Codex | Codex receives Claude's message and acts on it |
| --- | --- |
| ![The confirmation question before sending to Codex](docs/confirm.png) | ![The Codex terminal receiving the message relayed from Claude](docs/codex-side.png) |

## Why another Claude/Codex bridge?

There are many good projects that connect the two, most of them built so that one agent drives the other: Claude delegates a task to Codex, or the reverse. This one starts from the opposite idea: **you** drive both agents, each in its own terminal, and the pane is only a window and a relay. If you want automatic delegation, look at [careless10/claude-codex-bridge](https://github.com/careless10/claude-codex-bridge), [codex-flow](https://github.com/Eason412/codex-flow) or OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

## Requirements

- [Claude Code](https://claude.com/claude-code) 2.1.287 or later (mods support).
- [Codex CLI](https://github.com/openai/codex) with the `codex queue` command (check with `codex queue --help`; tested with 0.160.0). `codex` must be on the PATH of the terminal you start Claude Code from, or **Send to Codex** fails. If you set `CODEX_HOME`, set it there too.
- Python 3.8 or later, reachable as `python3`, `python` or `py`.

## Install

In Claude Code:

```
/plugin marketplace add ManuelWarland/claude-codex-pane
/plugin install codex-pane@codex-pane
```

Then type `/codex` to open the pane.

## Use

| Key | Button | What it does |
| --- | --- | --- |
| `c` | Send to Claude | Sends the current exchange with Codex to Claude. If Claude is busy, it goes as soon as Claude is free. |
| `x` | Send to Codex | Sends Claude's latest answer (or only its ` ```codex ` blocks) to the Codex session shown, through `codex queue`. You confirm first. If Codex is working, the message waits for the end of its task. |
| `s` | Switch session | Follow the most recently active open Codex session (automatic), or pin one of the open sessions (up to 3, shown with their folder). Closed sessions are not offered. |
| `r` | Refresh | Reads the session again (it is read every 5 seconds anyway). |

`/codex-to-claude` does the same as **Send to Claude** from the prompt. A notification tells you when Codex finishes a task, even with the pane closed.

To make Claude address Codex directly, ask it to put the part meant for Codex in a ` ```codex ` block.

### Options

In `/config`, under codex-pane:

- **Language**: `auto` (follows your Claude Code language setting), `en` or `fr`.
- **Your name**: how relayed messages refer to you. Empty means "the user".

## The other direction, from Codex

The pane already sends Claude's answers to Codex. If you would rather have Codex fetch them itself, copy [`codex/read_claude.py`](codex/read_claude.py) somewhere and add this to your `~/.codex/AGENTS.md`:

```markdown
When I say "read Claude", run `python /path/to/read_claude.py` and use its output:
it prints Claude Code's latest answer.
```

## Privacy

The plugin itself opens no network connection and sends nothing anywhere. It reads Codex's session files (`$CODEX_HOME/sessions`, by default `~/.codex/sessions`), and `read_claude.py` reads Claude Code's transcripts (`~/.claude/projects`), both read only. The only write is `codex queue`, when you confirm a send.

What you relay does leave your machine, like anything you type to an agent: an exchange sent to Claude goes to Anthropic, an answer sent to Codex goes to OpenAI.

## Limits

- Tested on Windows 11 only so far. macOS and Linux should work (only Python and standard paths are used); reports are welcome.
- Only Codex sessions opened in a terminal are followed: subagents, `codex exec` runs and editor integrations are left out.
- Claude's latest answer is kept in memory: after a reload of the plugin, wait for Claude's next answer before using **Send to Codex**.
- Codex's session files are not a documented format. A Codex update can break the reading; `plugin/hooks/read_codex.py` is the one file to fix.

## Development

```
claude plugin validate plugin
claude plugin test plugin
```

## License

[MIT](LICENSE), by Manuel Warland, written with Claude Code.
