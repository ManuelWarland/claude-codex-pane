import { expect, mock, test } from 'claude-code/testing'
import {
  clip,
  folderName,
  isFromClaude,
  extractForCodex,
  hm,
  makeLocale,
  messageLines,
  pickLanguage,
  sessionLabel,
  sessionName,
  toCodexMessage,
  transmission,
  windowOf,
  wrapLines,
} from '../hooks/codex-pane.mjs'

// A real situation: Codex has been working for a long time, its last "final"
// answer (03:38) is stale, the current exchange is recent.
const STALE_FINAL = { text: 'Old answer from 03:38', ts: '2026-10-05T01:38:44.000Z', hm: '03:38', turn_id: 't-old' }
const EXCHANGE = {
  user: { role: 'user', text: 'When you are done, we try something with Claude', ts: '2026-10-05T02:01:08.000Z', hm: '04:01' },
  codex: [
    { role: 'codex', text: 'Got it. Finishing the run first.', ts: '2026-10-05T02:01:14.000Z', hm: '04:01' },
    { role: 'codex', text: 'The last run got stuck:\n\n- question **3.2**', ts: '2026-10-05T02:03:44.000Z', hm: '04:03' },
  ],
  done: false,
  last_ts: '2026-10-05T02:03:44.000Z',
}
const DATA = {
  file: '/home/demo/.codex/sessions/2026/10/03/rollout-a.jsonl',
  session: '2026-10-03T19-37-53-01a1',
  thread_id: 'th-123',
  cwd: '/home/demo/projects/todo-app',
  live: true,
  mtime: 1,
  busy: true,
  activity: { kind: 'command', text: 'npm test', ts: '2026-10-05T02:03:50.000Z', hm: '04:03' },
  messages: [EXCHANGE.user, ...EXCHANGE.codex],
  final: STALE_FINAL,
  exchange: EXCHANGE,
}
const EN = makeLocale('en', '')
const FR = makeLocale('fr', 'Camille')

test('language and user name', () => {
  expect(pickLanguage('auto', 'Français')).toBe('fr')
  expect(pickLanguage('auto', 'french')).toBe('fr')
  expect(pickLanguage('auto', 'fr-BE')).toBe('fr')
  expect(pickLanguage('auto', 'English')).toBe('en')
  expect(pickLanguage('auto', undefined)).toBe('en')
  expect(pickLanguage('en', 'Français')).toBe('en')
  expect(pickLanguage('fr', '')).toBe('fr')
  expect(EN.who).toBe('the user')
  expect(EN.Who).toBe('The user')
  expect(FR.who).toBe('Camille')
  expect(makeLocale('de', '').lang).toBe('en')
})

test('small helpers', () => {
  expect(clip('abcdef', 3)).toBe('abc…')
  expect(hm({ ts: '2026-10-05T01:45:14.000Z', hm: '03:45' })).toBe('03:45')
  expect(hm({ ts: '2026-10-05T01:45:14.000Z' })).toBe('01:45')
})

test('line wrapping and bottom-anchored window', () => {
  expect(wrapLines('one two three four', 10)).toEqual(['one two', 'three four'])
  expect(wrapLines('abcdefghijklmnopqrstuvwxyz', 10)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz'])
  expect(wrapLines('a\n\nb', 10)).toEqual(['a', '', 'b'])
  const lines = Array.from({ length: 10 }, (_, i) => ({ text: 'l' + i }))
  expect(windowOf(lines, 4, 0).rows.map((r) => r.text)).toEqual(['l6', 'l7', 'l8', 'l9'])
  expect(windowOf(lines, 4, 2).rows.map((r) => r.text)).toEqual(['l4', 'l5', 'l6', 'l7'])
  expect(windowOf(lines, 4, 99)).toMatchObject({ back: 6, maxBack: 6 })
  expect(windowOf(lines.slice(0, 2), 4, 3)).toMatchObject({ back: 0, maxBack: 0 })
  const ml = messageLines(EXCHANGE.codex, 40, EN)
  expect(ml[0].text.startsWith('04:01 Codex : ')).toBe(true)
  expect(ml.some((l) => l.text === '')).toBe(true)
  expect(messageLines([EXCHANGE.user], 80, FR)[0].text.startsWith('04:01 Toi : ')).toBe(true)
})

test('the relay holds the current exchange, not the stale final answer', () => {
  const t = transmission(EXCHANGE, EN)
  expect(t).toContain('relayed by the user')
  expect(t).toContain('Codex is still working')
  expect(t).toContain('### The user to Codex (04:01)')
  expect(t).toContain('### Codex (04:03)')
  expect(t).toContain('- question **3.2**')
  expect(t).not.toContain('Old answer')
  expect(transmission({ ...EXCHANGE, done: true }, EN)).toContain('Codex has finished its task')
  const fr = transmission(EXCHANGE, FR)
  expect(fr).toContain('transmis par Camille')
  expect(fr).toContain('### Camille à Codex (04:01)')
})

test('session label and message for Codex', () => {
  const s = { session: '2026-10-05T12-55-34-01a1', cwd: 'D:\\work\\my-app', last_user: 'make a checklist' }
  expect(sessionLabel(s, EN)).toBe('my-app · 2026-10-05 12:55 · make a checklist')
  expect(sessionLabel(s, FR)).toBe('my-app · 05/10 12h55 · make a checklist')
  expect(sessionName({ session: '2026-10-05T12-55-34-01a1' }, FR)).toBe('05/10 12h55')
  expect(folderName('/home/demo/projects/todo-app/')).toBe('todo-app')
  expect(folderName('')).toBe('')
  const m = toCodexMessage('Hello Codex', false, EN)
  expect(m.startsWith('Message from Claude Code, relayed by the user')).toBe(true)
  expect(m.endsWith('Hello Codex')).toBe(true)
  expect(m).toContain('its whole answer')
  expect(toCodexMessage('Block', true, EN)).toContain('the part of its answer written for you')
  expect(toCodexMessage('Bloc', true, FR)).toContain('transmis par Camille')
})

test('messages relayed from Claude are labelled Claude', () => {
  const fromClaude = { role: 'user', text: toCodexMessage('Check the bounds.', true, EN), ts: '2026-10-05T02:05:00.000Z', hm: '04:05' }
  expect(isFromClaude(fromClaude.text)).toBe(true)
  expect(isFromClaude(toCodexMessage('Bloc', true, FR))).toBe(true)
  expect(isFromClaude('Message from Claude Code is great')).toBe(true) // same prefix: accepted, rare
  expect(isFromClaude('Please fix the bug')).toBe(false)
  expect(messageLines([fromClaude], 80, EN)[0].text.startsWith('04:05 Claude : Message from Claude Code')).toBe(true)
  const t = transmission({ user: fromClaude, codex: [], done: false, last_ts: fromClaude.ts }, EN)
  expect(t).toContain('### Claude to Codex, through the pane (04:05)')
  expect(t).not.toContain('### The user to Codex')
})

test('only the ```codex blocks go when there are some', () => {
  const answer = 'Press x.\n\n```codex\nHello Codex.\nReply "received".\n```\n\nAnd tell me.'
  expect(extractForCodex(answer)).toEqual({ text: 'Hello Codex.\nReply "received".', partial: true })
  const two = '```codex\nA\n```\ntext\n```codex\nB\n```'
  expect(extractForCodex(two).text).toBe('A\n\nB')
  const nested = '````codex\nHere:\n```python\nprint(1)\n```\nEnd.\n````'
  expect(extractForCodex(nested).text).toBe('Here:\n```python\nprint(1)\n```\nEnd.')
  expect(extractForCodex('```python\nx\n```')).toEqual({ text: '```python\nx\n```', partial: false })
  expect(extractForCodex('Plain answer.')).toEqual({ text: 'Plain answer.', partial: false })
  expect(extractForCodex('Intro\r\n```codex\r\nWindows line ends\r\n```\r\n')).toEqual({ text: 'Windows line ends', partial: true })
  expect(extractForCodex('- item\n  ```codex\n  Indented\n  ```')).toEqual({ text: 'Indented', partial: true })
})

function stubs(on: any, data: object, submitted: string[], toasts: string[] = []) {
  const clock = mock.clock(on, { now: 0 })
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(data), stderr: '' } }))
  // prompt.submit is an event: its stub answers { text }, not { value }.
  on('prompt.submit', ($: any, e: any) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return clock
}

const PANE = {
  plugin: 'codex-pane',
  component: 'Pane',
  requestId: 'codex-pane',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Codex', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('/codex-to-claude sends the exchange once while nothing is new', { options: { language: 'en' } }, async ($, on) => {
  const submitted: string[] = []
  const clock = stubs(on, DATA, submitted)
  await $.command.run({ command: 'codex-to-claude', args: '' } as any)
  // The send runs from a timer (outside the command): let it run.
  await clock.advance(1)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('The last run got stuck')
  const again: any = await $.command.run({ command: 'codex-to-claude', args: '' } as any)
  await clock.advance(1)
  expect(submitted.length).toBe(1)
  expect(again.text).toContain('already sent')
})

test('without an exchange nothing is sent', { options: { language: 'en' } }, async ($, on) => {
  const submitted: string[] = []
  stubs(on, { ...DATA, exchange: null }, submitted)
  const out: any = await $.command.run({ command: 'codex-to-claude', args: '' } as any)
  expect(submitted.length).toBe(0)
  expect(out.text).toContain('No exchange')
})

test('the button says so when there is nothing to send', { options: { language: 'en' } }, async ($, on) => {
  const toasts: string[] = []
  stubs(on, { ...DATA, exchange: null }, [], toasts)
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  await ui.press({ key: 'send' })
  expect(toasts.some((t) => t.includes('No exchange'))).toBe(true)
  await ui.unmount()
})

test('a Python error code is shown in the chosen language', { options: { language: 'fr' } }, async ($, on) => {
  stubs(on, { error: 'no_root', detail: '/home/demo/.codex/sessions' }, [])
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /dossier des sessions Codex introuvable/ })).toBeDefined()
  await ui.unmount()
})

test('falls back to the next Python command when one is missing', { options: { language: 'en' } }, async ($, on) => {
  const tried: string[] = []
  mock.clock(on, { now: 0 })
  on('process.run', ($: any, e: any) => {
    tried.push(e.argv[0])
    if (e.argv[0] === 'python3') return { value: { exitCode: 9009, stdout: '', stderr: 'not found' } }
    return { value: { exitCode: 0, stdout: JSON.stringify(DATA), stderr: '' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(tried.slice(0, 2)).toEqual(['python3', 'python'])
  expect(await ui.find({ type: 'Text', text: /Codex is working/ })).toBeDefined()
  await ui.unmount()
})

test('docked pane: fixed header, last message visible, exact height', { options: { language: 'en' } }, async ($, on) => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'codex' : 'user',
    text: 'message number ' + i,
    ts: '2026-10-05T02:' + String(10 + i).padStart(2, '0') + ':00.000Z',
  }))
  stubs(on, { ...DATA, messages: many }, [])
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /◆ Codex Pane/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /message number 29/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /message number 0$/ })).toBeUndefined()
  // 30 body rows: the pane draws exactly 30 (28 texts + 2 rows of buttons).
  const texts = await ui.findAll({ type: 'Text' })
  const buttonRowTexts = (await ui.findAll({ type: 'Text', text: /Esc: close/ })).length
  expect(texts.length - buttonRowTexts).toBe(28)
  await ui.unmount()
})

test('Send to Codex: confirmation, codex queue on the right session, only once', { options: { language: 'en', userName: 'Alex' } }, async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  const asked: string[] = []
  let choice = 'Send'
  mock.clock(on, { now: 0 })
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'codex') return { value: { exitCode: 0, stdout: '', stderr: '' } }
    return { value: { exitCode: 0, stdout: JSON.stringify({ ...DATA, busy: false }), stderr: '' } }
  })
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: choice } } }
    }
    return { result: '' }
  })
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '' }))
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)

  // No answer from Claude kept yet: nothing is sent.
  await ui.press({ key: 'to-codex' })
  expect(toasts.at(-1)).toContain('No answer from Claude')

  await $.turn.complete({
    turnId: 't1',
    answer: 'Press x.\n\n```codex\nHere is my review.\n```',
    durationMs: 5,
    isAborted: false,
    reason: 'answer',
  } as any)
  choice = 'Cancel'
  await ui.press({ key: 'to-codex' })
  expect(toasts.at(-1)).toContain('cancelled')
  expect(runs.some((r) => r[0] === 'codex')).toBe(false)

  choice = 'Send'
  await ui.press({ key: 'to-codex' })
  expect(asked.at(-1)).toContain('Here is my review.')
  expect(asked.at(-1)).toContain('```codex blocks')
  expect(asked.at(-1)).toContain('session todo-app · 2026-10-03 19:37')
  const queue = runs.find((r) => r[0] === 'codex')!
  expect(queue.slice(0, 4)).toEqual(['codex', 'queue', '--thread', 'th-123'])
  expect(queue[5]).toContain('Here is my review.')
  expect(queue[5]).toContain('relayed by Alex')
  expect(queue[5]).not.toContain('Press x')
  expect(toasts.at(-1)).toContain('sent to Codex')

  await ui.press({ key: 'to-codex' })
  expect(toasts.at(-1)).toContain('already sent')
  expect(runs.filter((r) => r[0] === 'codex').length).toBe(1)
  await ui.unmount()
})

test('the pane shows the state, the activity and the current exchange', { options: { language: 'fr' } }, async ($, on) => {
  const submitted: string[] = []
  const clock = stubs(on, DATA, submitted)
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /Codex travaille/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session todo-app · 03\/10 19h37 · automatique$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /04:03 commande : npm test/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Échange en cours \(depuis 04:01, 2 réponses\)/ })).toBeDefined()
  await ui.press({ key: 'send' })
  await clock.advance(1)
  expect(submitted.length).toBe(1)
  expect(submitted[0]).not.toContain('Old answer')
  await ui.unmount()
})

test('a closed session is marked as such', { options: { language: 'en' } }, async ($, on) => {
  stubs(on, { ...DATA, live: false }, [])
  await $.command.run({ command: 'codex', args: '' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /session todo-app · 2026-10-03 19:37 · automatic · closed/ })).toBeDefined()
  await ui.unmount()
})
