// codex-pane: a bridge between your Codex CLI session and Claude Code, without copy-paste.
//
// - /codex opens or closes a pane that follows the most recent Codex session live:
//   state (working / idle), latest command or file changed, the latest messages,
//   and the current exchange.
// - "Send to Claude" (or /codex-to-claude) relays the current exchange as is: your
//   last message to Codex and every Codex reply since, saying whether Codex is still
//   working. (Not the last "final" answer: a long task can run for many minutes and
//   that answer would be stale.)
// - "Send to Codex" sends Claude's latest answer to the session shown in the pane,
//   through `codex queue`, after you confirm. Only its ```codex blocks go when it
//   has some.
// - "Switch session" follows the most recent session (automatic) or one you pick.
// - A toast says when Codex finishes a task.
//
// Reading is done by hooks/read_codex.py ($CODEX_HOME/sessions/.../rollout-*.jsonl).
// The pane never writes into a Codex session by itself: you approve every relay,
// in both directions. There is no automatic dialogue between the two AIs.

const PANE = 'codex-pane'
const POLL_OPEN_MS = 5 * 1000
const POLL_CLOSED_MS = 20 * 1000
const MAX_MESSAGE_CHARS = 4000
const HISTORY_MESSAGES = 20
const WHEEL_STEP = 3 // lines per wheel notch
const MAX_TO_CODEX_CHARS = 20000
const PYTHONS = ['python3', 'python', 'py']

// ---- Strings -----------------------------------------------------------------

const STRINGS = {
  en: {
    title: '◆ Codex Pane',
    you: 'You',
    someone: 'the user',
    reading: 'reading the Codex session…',
    session: (name, pinned) => 'session ' + name + (pinned ? ' · pinned' : ' · automatic'),
    closed: ' · closed',
    busy: '⏳ Codex is working',
    idle: '✔ Codex is idle',
    kind: { command: 'command', file: 'file' },
    exchange: (since, n, done, sent) =>
      'Current exchange (since ' + since + ', ' + n + ' repl' + (n === 1 ? 'y' : 'ies') + ')' +
      (done ? ' · finished' : ' · Codex is working') + (sent ? ' · ✔ sent' : ''),
    latest: 'Latest messages',
    scrolled: (n) => ' · scrolled up ' + n + ' lines (wheel down to return)',
    keys: { toClaude: 'c', toCodex: 'x', session: 's', refresh: 'r' },
    toClaude: 'Send to Claude',
    toClaudeBusy: 'Sending…',
    toCodex: 'Send to Codex',
    toCodexBusy: 'Sending to Codex…',
    switchSession: 'Switch session',
    refresh: 'Refresh',
    escClose: 'Esc: close',
    errors: {
      no_root: (d) => 'Codex sessions folder not found: ' + d,
      no_file: (d) => 'chosen session not found: ' + d,
      no_session: () => 'no Codex terminal session found',
    },
    readFailed: (m) => 'cannot read the session: ' + m,
    noPython: 'Python 3 not found (tried python3, python, py)',
    toastDone: 'Codex finished a task · /codex-to-claude to send it to me',
    nothingToSend: 'No exchange with Codex to send.',
    alreadySending: 'Already sending.',
    alreadySent: 'This exchange with Codex was already sent (nothing new since).',
    scheduled: 'Sending to Claude as soon as Claude is free',
    sent: 'Exchange with Codex sent to Claude',
    sendFailed: 'Could not send to Claude',
    relayHead: (who, done) =>
      'Exchange with Codex, relayed by ' + who + ' from the codex-pane pane (full text). ' +
      (done ? 'Codex has finished its task.' : 'Codex is still working: these are only its messages so far.'),
    relayUser: (Who, at) => '### ' + Who + ' to Codex (' + at + ')',
    relayCodex: (at) => '### Codex (' + at + ')',
    relayClaude: (at) => '### Claude to Codex, through the pane (' + at + ')',
    noReplyYet: '(no reply yet)',
    listFailed: 'Cannot list the Codex sessions',
    noUserMessage: '(no message)',
    auto: 'Automatic: the most recently active open session',
    askSession: 'Which open Codex session should the pane follow?',
    askSessionHeader: 'Session',
    pinnedTo: (label) => 'Pane pinned to the session ' + label,
    autoMode: 'Pane in automatic mode',
    sessionLabel: (date, time) => date + ' ' + time,
    alreadyToCodex: 'Already sending to Codex',
    noThread: 'No Codex session to send to',
    noAnswer: 'No answer from Claude to send since the pane was loaded',
    answerAlreadySent: 'This answer from Claude was already sent to Codex',
    askToCodex: (session, busy, partial, chars, excerpt) =>
      'Send to Codex (session ' + session + (busy ? ', working: the message will wait for the end of its task' : ', idle') + ') ' +
      (partial ? 'the ```codex blocks of Claude\'s latest answer' : 'Claude\'s whole latest answer (it has no ```codex block)') +
      ', ' + chars + ' characters: "' + excerpt + '"?',
    askToCodexHeader: 'To Codex',
    send: 'Send',
    cancel: 'Cancel',
    cancelled: 'Sending to Codex cancelled',
    sentToCodex: 'Claude\'s answer sent to Codex',
    queueFailed: (detail) => 'codex queue failed: ' + detail,
    codexPathHint: ' (is `codex` on the PATH Claude Code was started with?)',
    toCodexHead: (who, partial) =>
      'Message from Claude Code, relayed by ' + who + ' from the codex-pane pane (' +
      (partial ? 'the part of its answer written for you' : 'its whole answer') + '):',
    cmdPane: 'Open or close the Codex session pane',
    cmdToClaude: 'Send Claude the current exchange with Codex (your last message and its replies)',
  },
  fr: {
    title: '◆ Pont Codex',
    you: 'Toi',
    someone: "l'utilisateur",
    reading: 'lecture de la session Codex…',
    session: (name, pinned) => 'session ' + name + (pinned ? ' · fixée' : ' · automatique'),
    closed: ' · fermée',
    busy: '⏳ Codex travaille',
    idle: '✔ Codex au repos',
    kind: { command: 'commande', file: 'fichier' },
    exchange: (since, n, done, sent) =>
      'Échange en cours (depuis ' + since + ', ' + n + ' réponse' + (n > 1 ? 's' : '') + ')' +
      (done ? ' · terminé' : ' · Codex travaille') + (sent ? ' · ✔ transmis' : ''),
    latest: 'Derniers échanges',
    scrolled: (n) => ' · remonté de ' + n + ' lignes (molette vers le bas pour revenir)',
    keys: { toClaude: 't', toCodex: 'e', session: 'c', refresh: 'r' },
    toClaude: 'Transmettre à Claude',
    toClaudeBusy: 'Envoi…',
    toCodex: 'Envoyer à Codex',
    toCodexBusy: 'Envoi à Codex…',
    switchSession: 'Changer de session',
    refresh: 'Rafraîchir',
    escClose: 'Échap : fermer',
    errors: {
      no_root: (d) => 'dossier des sessions Codex introuvable : ' + d,
      no_file: (d) => 'session choisie introuvable : ' + d,
      no_session: () => 'aucune session Codex de terminal trouvée',
    },
    readFailed: (m) => 'lecture impossible : ' + m,
    noPython: 'Python 3 introuvable (essayé : python3, python, py)',
    toastDone: 'Codex a terminé une tâche · /codex-to-claude pour me l’envoyer',
    nothingToSend: 'Aucun échange avec Codex à transmettre.',
    alreadySending: 'Transmission déjà en cours.',
    alreadySent: 'Cet échange avec Codex a déjà été transmis (rien de nouveau depuis).',
    scheduled: 'Envoi à Claude programmé (il part dès que Claude est libre)',
    sent: 'Échange avec Codex transmis à Claude',
    sendFailed: 'Échec de la transmission à Claude',
    relayHead: (who, done) =>
      'Échange avec Codex transmis par ' + who + ' depuis le panneau codex-pane (textes intégraux). ' +
      (done ? 'Codex a terminé sa tâche.' : 'Codex travaille encore : ce ne sont que ses messages en cours.'),
    relayUser: (Who, at) => '### ' + Who + ' à Codex (' + at + ')',
    relayCodex: (at) => '### Codex (' + at + ')',
    relayClaude: (at) => '### Claude à Codex, via le panneau (' + at + ')',
    noReplyYet: '(pas encore de réponse)',
    listFailed: 'Impossible de lister les sessions Codex',
    noUserMessage: '(pas de message)',
    auto: 'Automatique : la session ouverte la plus récemment active',
    askSession: 'Quelle session Codex ouverte suivre dans le panneau ?',
    askSessionHeader: 'Session',
    pinnedTo: (label) => 'Panneau fixé sur la session ' + label,
    autoMode: 'Panneau en mode automatique',
    sessionLabel: (date, time) => date.split('-').slice(1).reverse().join('/') + ' ' + time.replace(':', 'h'),
    alreadyToCodex: 'Envoi à Codex déjà en cours',
    noThread: 'Aucune session Codex à qui envoyer',
    noAnswer: 'Aucune réponse de Claude à envoyer depuis le chargement du panneau',
    answerAlreadySent: 'Cette réponse de Claude a déjà été envoyée à Codex',
    askToCodex: (session, busy, partial, chars, excerpt) =>
      'Envoyer à Codex (session ' + session + (busy ? ', il travaille : le message attendra sa fin' : ', au repos') + ') ' +
      (partial ? 'les blocs ```codex de la dernière réponse de Claude' : 'la dernière réponse de Claude entière (aucun bloc ```codex)') +
      ', ' + chars + ' caractères : « ' + excerpt + ' » ?',
    askToCodexHeader: 'Vers Codex',
    send: 'Envoyer',
    cancel: 'Annuler',
    cancelled: 'Envoi à Codex annulé',
    sentToCodex: 'Réponse de Claude envoyée à Codex',
    queueFailed: (detail) => 'échec de codex queue : ' + detail,
    codexPathHint: ' (la commande `codex` est-elle dans le PATH de Claude Code ?)',
    toCodexHead: (who, partial) =>
      'Message de Claude Code, transmis par ' + who + ' depuis le panneau codex-pane (' +
      (partial ? 'partie de sa réponse écrite pour toi' : 'sa réponse entière') + ') :',
    cmdPane: 'Ouvrir ou fermer le panneau de la session Codex',
    cmdToClaude: "Envoyer à Claude l'échange en cours avec Codex (ton dernier message et ses réponses)",
  },
}

// ---- Pure functions ------------------------------------------------------------

// Language of the pane: the `language` option, or with `auto` the Claude Code
// `language` setting ("Français", "french", "fr-BE"…). English otherwise.
export function pickLanguage(option, setting) {
  if (option === 'en' || option === 'fr') return option
  return /^\s*(fr|fran)/i.test(String(setting ?? '')) ? 'fr' : 'en'
}

// Everything the texts depend on: the strings and how to name the user.
export function makeLocale(lang, userName) {
  const s = STRINGS[lang] || STRINGS.en
  const name = String(userName ?? '').trim()
  const who = name || s.someone
  return { lang: STRINGS[lang] ? lang : 'en', s, who, Who: who.charAt(0).toUpperCase() + who.slice(1) }
}

export function clip(text, max) {
  const t = String(text ?? '').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

// Local HH:MM of a message: computed by read_codex.py, which knows the machine's
// time zone; the UTC time as a fallback.
export function hm(m) {
  if (m && m.hm) return m.hm
  return String((m && m.ts) ?? '').slice(11, 16)
}

// A message the pane itself queued into Codex on Claude's behalf (see
// toCodexMessage), in either language.
export function isFromClaude(text) {
  return /^(Message from Claude Code|Message de Claude Code)\b/.test(String(text ?? ''))
}

export function transmission(exchange, L) {
  const head = isFromClaude(exchange.user.text) ? L.s.relayClaude(hm(exchange.user)) : L.s.relayUser(L.Who, hm(exchange.user))
  const parts = [L.s.relayHead(L.who, exchange.done), '', head, exchange.user.text]
  if (exchange.codex.length === 0) parts.push('', '### Codex', L.s.noReplyYet)
  for (const reply of exchange.codex) parts.push('', L.s.relayCodex(hm(reply)), reply.text)
  return parts.join('\n')
}

// Splits a text into lines of at most `width` characters (whole words when
// possible). The pane draws one line per element: that is what keeps the header
// fixed and the messages anchored at the bottom.
export function wrapLines(text, width) {
  const w = Math.max(10, width)
  const out = []
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      let rest = word
      while (rest.length > w) {
        if (line) {
          out.push(line)
          line = ''
        }
        out.push(rest.slice(0, w))
        rest = rest.slice(w)
      }
      if (!line) line = rest
      else if (line.length + 1 + rest.length <= w) line += ' ' + rest
      else {
        out.push(line)
        line = rest
      }
    }
    out.push(line)
  }
  return out
}

// Lines of all messages, oldest first, separated by an empty line.
export function messageLines(messages, width, L) {
  const lines = []
  for (const m of messages) {
    const who = m.role !== 'user' ? 'Codex' : isFromClaude(m.text) ? 'Claude' : L.s.you
    const text = clip(String(m.text ?? '').replace(/\n{2,}/g, '\n'), MAX_MESSAGE_CHARS)
    if (lines.length) lines.push({ text: '', color: undefined })
    for (const t of wrapLines(hm(m) + ' ' + who + ' : ' + text, width)) {
      lines.push({ text: t, color: m.role === 'user' ? 'cyan' : undefined })
    }
  }
  return lines
}

// Window of `avail` lines, anchored at the bottom, scrolled up by `back` lines.
export function windowOf(lines, avail, back) {
  const maxBack = Math.max(0, lines.length - avail)
  const b = Math.min(Math.max(0, back), maxBack)
  const end = lines.length - b
  return { rows: lines.slice(Math.max(0, end - avail), end), back: b, maxBack }
}

// Last folder of a working directory, Windows or POSIX ("D:\work\my-app" → "my-app").
export function folderName(cwd) {
  const parts = String(cwd ?? '').split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

// "my-app · 05/10 12h55": the session's folder and start time (session file
// names start with the local date and time: 2026-10-05T12-55-34-<id>).
export function sessionName(s, L) {
  const date = s.session.slice(0, 10)
  const time = s.session.slice(11, 16).replace('-', ':')
  const folder = folderName(s.cwd)
  return (folder ? folder + ' · ' : '') + L.s.sessionLabel(date, time)
}

export function sessionLabel(s, L) {
  const excerpt = clip(String(s.last_user || L.s.noUserMessage).replace(/\s+/g, ' '), 40)
  return sessionName(s, L) + ' · ' + excerpt
}

// The part of Claude's answer meant for Codex: the code blocks labelled `codex`
// (```codex … ```, or ````codex for a block that itself holds code), joined.
// Without such a block the whole answer goes: sent whole, an answer also carries
// the instructions meant for the user.
export function extractForCodex(answer) {
  const text = String(answer ?? '').replace(/\r\n?/g, '\n')
  const blocks = []
  // A fence may be indented by up to 3 spaces, as in Markdown.
  const re = /^ {0,3}(`{3,})codex[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*$/gm
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[2].trim()) blocks.push(m[2].trim())
  }
  return blocks.length ? { text: blocks.join('\n\n'), partial: true } : { text: text.trim(), partial: false }
}

export function toCodexMessage(answer, partial, L) {
  return L.s.toCodexHead(L.who, partial) + '\n\n' + clip(answer, MAX_TO_CODEX_CHARS)
}

// ---- State -------------------------------------------------------------------

const state = {
  L: makeLocale('en', ''),
  data: null, // latest read_codex.py output
  error: '',
  open: false,
  lastPollMs: 0,
  seenFinal: null, // turn_id of the latest final answer already seen
  sentKey: null, // last_ts of the exchange already sent to Claude
  sending: false,
  back: 0, // lines scrolled up from the bottom (0 = follows the last message)
  maxBack: 0, // limit computed at the last drawing
  pinned: null, // file of the session the user picked; null = the most recent
  lastAnswer: null, // Claude's latest answer (main thread): { text, at }
  sentToCodexAt: null, // `at` of the latest answer already sent to Codex
  sendingToCodex: false,
  python: null, // the Python command that worked
}

// ---- Reading -----------------------------------------------------------------

async function readCodex($, args) {
  const script = $.plugin.root + '/hooks/read_codex.py'
  const candidates = state.python ? [state.python] : PYTHONS
  for (const python of candidates) {
    try {
      const run = await $.process.run([python, script, ...args], { timeoutMs: 20000 })
      if (run.exitCode !== 0) continue
      const data = JSON.parse(run.stdout.trim())
      state.python = python
      return data
    } catch {
      // not installed, or not Python 3: try the next one
    }
  }
  state.python = null
  throw new Error(state.L.s.noPython)
}

async function poll($) {
  const s = state.L.s
  try {
    const args = ['--limit', String(HISTORY_MESSAGES)]
    if (state.pinned) args.push('--file', state.pinned)
    const data = await readCodex($, args)
    if (data.error) {
      const describe = s.errors[data.error]
      state.error = describe ? describe(data.detail) : String(data.error)
      state.data = null
    } else {
      state.error = ''
      const previous = state.data
      state.data = data
      const final = data.final
      if (final && previous && final.turn_id !== state.seenFinal) $.ui.toast(s.toastDone)
      if (final) state.seenFinal = final.turn_id
    }
  } catch (error) {
    state.error = s.readFailed(String(error && error.message ? error.message : error).slice(0, 120))
  }
  state.lastPollMs = await $.clock.now()
  $.ui.invalidate('ui.render')
}

// ---- To Claude ---------------------------------------------------------------

async function sendExchange($) {
  const s = state.L.s
  const exchange = state.data && state.data.exchange
  if (!exchange) return s.nothingToSend
  if (state.sending) return s.alreadySending
  if (state.sentKey === exchange.last_ts) return s.alreadySent
  state.sending = true
  state.sentKey = exchange.last_ts
  $.ui.invalidate('ui.render')
  // $.prompt.submit resolves once Claude is free. A call left pending at the end
  // of a command is rejected, so it runs from a timer, outside any event: the
  // message goes as soon as Claude has finished its current answer.
  $.clock.after(0, () => submitExchange($, exchange))
  return ''
}

async function pressSend($) {
  await poll($)
  const problem = await sendExchange($)
  $.ui.toast(problem || state.L.s.scheduled)
}

async function submitExchange($, exchange) {
  try {
    await $.prompt.submit({ text: transmission(exchange, state.L) })
    $.ui.toast(state.L.s.sent)
  } catch {
    state.sentKey = null
    $.ui.toast(state.L.s.sendFailed)
  } finally {
    state.sending = false
    $.ui.invalidate('ui.render')
  }
}

// ---- Session picker ----------------------------------------------------------

async function chooseSession($) {
  const s = state.L.s
  let sessions = []
  try {
    sessions = (await readCodex($, ['--list', '3'])).sessions || []
  } catch {
    $.ui.toast(s.listFailed)
    return
  }
  const labels = sessions.map((x) => sessionLabel(x, state.L))
  let answer
  try {
    answer = await $.ui.ask(s.askSession, { header: s.askSessionHeader, options: [s.auto, ...labels] })
  } catch {
    return // question closed: nothing changes
  }
  const index = labels.indexOf(answer)
  state.pinned = index >= 0 ? sessions[index].file : null
  state.back = 0
  $.ui.toast(index >= 0 ? s.pinnedTo(sessionName(sessions[index], state.L)) : s.autoMode)
  await poll($)
}

// ---- To Codex ----------------------------------------------------------------

// Sends Claude's latest answer to the session shown, with `codex queue` (the
// message waits for the end of Codex's current task). The user confirms each
// send: the question names the session and quotes the start of the text, so
// topics do not get mixed between sessions.
async function sendToCodex($) {
  const s = state.L.s
  if (state.sendingToCodex) return $.ui.toast(s.alreadyToCodex)
  await poll($)
  const d = state.data
  const answer = state.lastAnswer
  if (!d || !d.thread_id) return $.ui.toast(s.noThread)
  if (!answer) return $.ui.toast(s.noAnswer)
  if (state.sentToCodexAt === answer.at) return $.ui.toast(s.answerAlreadySent)
  const part = extractForCodex(answer.text)
  const question = s.askToCodex(sessionName(d, state.L), d.busy, part.partial, part.text.length, clip(part.text.replace(/\s+/g, ' '), 90))
  let choice
  try {
    choice = await $.ui.ask(question, { header: s.askToCodexHeader, options: [s.send, s.cancel] })
  } catch {
    return
  }
  if (choice !== s.send) return $.ui.toast(s.cancelled)
  state.sendingToCodex = true
  $.ui.invalidate('ui.render')
  try {
    const run = await $.process.run(['codex', 'queue', '--thread', d.thread_id, '--message', toCodexMessage(part.text, part.partial, state.L)], { timeoutMs: 60000 })
    if (run.exitCode === 0) {
      state.sentToCodexAt = answer.at
      $.ui.toast(s.sentToCodex)
    } else {
      $.ui.toast(s.queueFailed('code ' + run.exitCode + ', ' + clip((run.stderr || run.stdout || '').trim(), 160)))
    }
  } catch (error) {
    // Usually: `codex` is not on the PATH Claude Code was started with.
    $.ui.toast(s.queueFailed(clip(String(error && error.message ? error.message : error), 120)) + s.codexPathHint)
  } finally {
    state.sendingToCodex = false
    $.ui.invalidate('ui.render')
  }
}

// ---- Drawing -----------------------------------------------------------------

// Three blocks: a fixed header (title, session, state, activity, current
// exchange), a window on the latest messages anchored on the last one, and fixed
// buttons at the bottom. The pane draws exactly its height, line by line, and
// handles the wheel itself (ui.scroll hook), so the header never scrolls away.
function draw($, e) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const s = state.L.s
  const line = (text, props = {}) => Text({ ...props, children: [text || ' '], wrap: 'truncate-end' })
  const header = []
  const d = state.data

  header.push(line(s.title, { bold: true, color: 'magenta' }))
  if (state.error) header.push(line('  ' + state.error, { color: 'red' }))
  if (!d) {
    header.push(line('  ' + s.reading, { dimColor: true }))
    return Box({ flexDirection: 'column', children: header })
  }

  header.push(line('  ' + s.session(sessionName(d, state.L), !!state.pinned) + (d.live === false ? s.closed : ''), { dimColor: true }))
  header.push(line('  ' + (d.busy ? s.busy : s.idle), { color: d.busy ? 'yellow' : 'green' }))
  if (d.activity) {
    header.push(line('  ' + hm(d.activity) + ' ' + (s.kind[d.activity.kind] || d.activity.kind) + ' : ' + d.activity.text, { dimColor: true }))
  }
  if (d.exchange) {
    const x = d.exchange
    header.push(line('  ' + s.exchange(hm(x.user), x.codex.length, x.done, state.sentKey === x.last_ts), { dimColor: true }))
  }
  header.push(line(' '))

  const width = Math.max(20, (e.props && e.props.bodyColumns) || 60)
  const all = messageLines(d.messages, width, state.L)
  const footerRows = 3 // empty line + two rows of buttons
  const bodyRows = e.props && e.props.scroll && e.props.scroll.bodyRows
  // Docked pane: known height, filled exactly. Above the prompt the pane grows
  // with its content, so it is capped at 20 lines.
  const avail = e.props && e.props.placement === 'dock' && bodyRows
    ? Math.max(3, bodyRows - header.length - 1 - footerRows)
    : Math.min(all.length, 20)
  const win = windowOf(all, avail, state.back)
  state.back = win.back
  state.maxBack = win.maxBack

  header.push(line(s.latest + (win.back > 0 ? s.scrolled(win.back) : ''), { bold: true }))
  const rows = [...header]
  for (const r of win.rows) rows.push(line(r.text, { color: r.color }))
  for (let i = win.rows.length; i < avail; i++) rows.push(line(' '))
  rows.push(line(' '))

  rows.push(
    Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        // The button always says what it did, even when there is nothing to send.
        Button({ key: 'send', label: state.sending ? s.toClaudeBusy : s.toClaude, hotkey: s.keys.toClaude, plain: true, onPress: () => pressSend($) }),
        Button({ key: 'to-codex', label: state.sendingToCodex ? s.toCodexBusy : s.toCodex, hotkey: s.keys.toCodex, plain: true, onPress: () => sendToCodex($) }),
      ],
    }),
  )
  rows.push(
    Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Button({ key: 'session', label: s.switchSession, hotkey: s.keys.session, plain: true, onPress: () => chooseSession($) }),
        Button({ key: 'refresh', label: s.refresh, hotkey: s.keys.refresh, plain: true, onPress: () => poll($) }),
        Text({ dimColor: true, children: [s.escClose] }),
      ],
    }),
  )
  return Box({ flexDirection: 'column', children: rows })
}

// ---- Hooks -------------------------------------------------------------------

export function register(on, options) {
  const option = options && options.language
  const userName = options && options.userName
  state.L = makeLocale(pickLanguage(option, ''), userName)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (option !== 'en' && option !== 'fr') {
      try {
        const settings = await $.settings.read()
        state.L = makeLocale(pickLanguage(option, settings && settings.language), userName)
      } catch {
        // settings unreadable: English stays
      }
    }
    // Frequent reads while the pane is open, sparser while closed (for the toast).
    $.clock.after(0, () => poll($))
    $.clock.every(POLL_OPEN_MS, async () => {
      const now = await $.clock.now()
      if (state.open || now - state.lastPollMs >= POLL_CLOSED_MS) await poll($)
    })
    try {
      await $.command.register({ name: 'codex', description: state.L.s.cmdPane, immediate: true })
      await $.command.register({ name: 'codex-to-claude', description: state.L.s.cmdToClaude, immediate: true })
    } catch {
      // Name already taken: the pane stays reachable through the other command.
    }
    return result
  })

  on('command.run', { command: 'codex' }, async ($) => {
    const panes = await $.ui.panes()
    if (panes.some((p) => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      state.open = false
      return {}
    }
    await $.ui.open({ id: PANE, title: 'Codex', focus: true, closeOnEscape: true })
    state.open = true
    state.back = 0
    await poll($)
    return {}
  })

  on('command.run', { command: 'codex-to-claude' }, async ($) => {
    await poll($)
    const problem = await sendExchange($)
    return problem ? { text: problem } : {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) state.open = false
    return next(e)
  })

  // Keeps Claude's latest answer (main thread) for "Send to Codex".
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && !e.isAborted && e.answer) {
      state.lastAnswer = { text: e.answer, at: await $.clock.now() }
    }
    return result
  })

  // Wheel or arrows on the pane: the pane moves its own message window (the
  // header stays in place) and does not let the engine scroll.
  on('ui.scroll', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const step = e.origin && e.origin.kind === 'person' && Math.abs(e.by) === 1 ? e.by * WHEEL_STEP : e.by
    state.back = Math.min(Math.max(0, state.back - step), state.maxBack)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return draw($, e)
  })
}
