// Values codex-pane keeps in the session's state, so that a reload of the
// plugin does not lose Claude's latest answer kept for "Send to Codex".
// Only the ```codex blocks are kept ('' when the answer had none).
export type KeptAnswer = { codex: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'codex-pane': {
      lastAnswer: KeptAnswer
      sentToCodexAt: number
    }
  }
}
