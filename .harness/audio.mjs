import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9441', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9441/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

// Count every oscillator and buffer source the page creates, so a cue proves
// itself by the nodes it starts rather than by audible output.
const INSTRUMENT = `(() => {
  window.__audio = { oscillators: [], buffers: 0, contexts: 0 }
  const RealCtx = window.AudioContext
  window.AudioContext = class extends RealCtx {
    constructor(...args) { super(...args); window.__audio.contexts++ }
    createOscillator() {
      const osc = super.createOscillator()
      const realStart = osc.start.bind(osc)
      osc.start = (when) => { window.__audio.oscillators.push({ freq: osc.frequency.value, type: osc.type }); return realStart(when) }
      return osc
    }
    createBufferSource() {
      const src = super.createBufferSource()
      const realStart = src.start.bind(src)
      src.start = (when) => { window.__audio.buffers++; return realStart(when) }
      return src
    }
  }
})()`

const setup = async () => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1200)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT })
  await send('Runtime.evaluate', { expression: `(() => {
    const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
    const columns = [
      { cards: [c('a9',9,0), c('a8',8,0), c('a7',7,0), c('a6',6,0), c('a5',5,0)] },
      { cards: [c('b8',8,1)] },
      { cards: [c('c10',10,0)] },
      { cards: [c('d9',9,2)] },
      ...Array.from({ length: 6 }, (_, i) => ({ cards: [c('z'+i, 2, i % 4)] })),
    ]
    localStorage.removeItem('dsh.spider.sound.v1')
    localStorage.setItem('dsh.spider.game.v1', JSON.stringify({
      version: 1, difficulty: 'four-suits', seed: 1, columns, stock: [],
      completed: 0, score: 500, moves: 0, startedAt: Date.now() - 5000, finishedAt: null, won: false,
    }))
  })()` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1800)
}
const audio = async () => JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify(window.__audio ?? { missing: true })`, returnByValue: true })).result.result.value)
const point = async (col, index) => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const cards = [...document.querySelectorAll('[data-column="${col}"] .sp-card')]
  const r = cards[${index}].getBoundingClientRect()
  const next = cards[${index}+1]?.getBoundingClientRect()
  const bottom = next ? next.top : r.bottom
  return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + Math.max(3, (bottom - r.top)/2)) })
})()`, returnByValue: true })).result.result.value)
const bgPoint = async (col) => JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('[data-column="${col}"]').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top + r.height*0.6) }) })()`, returnByValue: true })).result.result.value)
const drag = async (a, b) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 16, y: a.y + 16, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
  await wait(500)
}

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) } }

await setup()
check('no audio before the first gesture', (await audio()).missing !== true)

let a0 = await audio()
console.log('  initial:', JSON.stringify(a0))
check('audio sleeps until a gesture', a0.contexts === 0, JSON.stringify(a0))

// A valid move: pick up the 8 and drop it on the 9 of diamonds.
await drag(await point(0, 1), await bgPoint(3))
const a1 = await audio()
check('a move creates an audio context', a1.contexts === 1, JSON.stringify(a1))
check('a move plays a lift and a slide', a1.oscillators.length >= 1 && a1.buffers >= 2, JSON.stringify(a1))

// An invalid move: 5 onto 9.
await setup()
const before = await audio()
await drag(await point(0, 4), await bgPoint(7))
const a2 = await audio()
check('an invalid move plays the warning tone', a2.oscillators.length > (before.oscillators?.length ?? 0), JSON.stringify(a2))

// Mute stops the cues entirely.
await setup()
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-tool')].find(b => (b.getAttribute('aria-label')||'').includes('关闭音效')).click()` })
await wait(200)
const mutedPref = (await send('Runtime.evaluate', { expression: `localStorage.getItem('dsh.spider.sound.v1')`, returnByValue: true })).result.result.value
check('muting persists the preference', mutedPref === 'off', String(mutedPref))
const m0 = await audio()
await drag(await point(0, 1), await bgPoint(3))
const m1 = await audio()
check('no sound nodes are created while muted',
  (m1.contexts ?? 0) <= (m0.contexts ?? 0) && (m1.oscillators?.length ?? 0) <= (m0.oscillators?.length ?? 0),
  JSON.stringify(m1))

// Unmuting persists too.
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-tool')].find(b => (b.getAttribute('aria-label')||'').includes('打开音效')).click()` })
await wait(200)
const unmuted = (await send('Runtime.evaluate', { expression: `localStorage.getItem('dsh.spider.sound.v1')`, returnByValue: true })).result.result.value
check('unmuting persists the preference', unmuted === 'on', String(unmuted))

console.log(failures === 0 ? '\nPASS: audio cues fire for moves, invalid moves and the mute toggle' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
