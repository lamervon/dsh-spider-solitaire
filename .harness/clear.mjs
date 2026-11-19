import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=9442', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9442/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })
const INSTRUMENT = `(() => {
  window.__audio = { oscillators: [], buffers: 0, contexts: 0 }
  const RealCtx = window.AudioContext
  window.AudioContext = class extends RealCtx {
    constructor(...a) { super(...a); window.__audio.contexts++ }
    createOscillator() { const o = super.createOscillator(); const s = o.start.bind(o); const sv = o.frequency.setValueAtTime.bind(o.frequency); let planned = 440; o.frequency.setValueAtTime = (v, t) => { planned = v; return sv(v, t) }; o.start = (w) => { window.__audio.oscillators.push(Math.round(planned)); return s(w) }; return o }
    createBufferSource() { const b = super.createBufferSource(); const s = b.start.bind(b); b.start = (w) => { window.__audio.buffers++; return s(w) }; return b }
  }
})()`
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1000)
await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT })
// Build a board where the last card of a king-to-ace run can be dropped in.
await send('Runtime.evaluate', { expression: `(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const stair = Array.from({ length: 12 }, (_, i) => c('s'+i, 12 - i, 0)) // Q..A of spades
  const columns = [
    { cards: stair },
    { cards: [c('k1', 13, 0)] },
    ...Array.from({ length: 8 }, (_, i) => ({ cards: [c('z'+i, 2, i % 4)] })),
  ]
  localStorage.removeItem('dsh.spider.sound.v1')
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1, columns, stock:[], completed:0, score:500, moves:0, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1800)
const pt = async (col, idx) => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const cards = [...document.querySelectorAll('[data-column="${col}"] .sp-card')]
  const r = cards[${idx}].getBoundingClientRect()
  const next = cards[${idx}+1]?.getBoundingClientRect()
  const b = next ? next.top : r.bottom
  return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top + Math.max(3,(b-r.top)/2)) })
})()`, returnByValue: true })).result.result.value)
const bg = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('[data-column="1"]').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height*0.6) }) })()`, returnByValue: true })).result.result.value)
const from = await pt(0, 0)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 16, y: from.y + 16, button: 'left', buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bg.x, y: bg.y, button: 'left', buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bg.x, y: bg.y, button: 'left', buttons: 0, clickCount: 1 })
await wait(500)
const r = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify({ audio: window.__audio, badge: document.querySelector('.sp-badge')?.textContent, runs: document.querySelector('.sp-run-label')?.textContent })`, returnByValue: true })).result.result.value)
console.log(JSON.stringify(r))
// The clear arpeggio is 4 notes at 523/659/784/1046 Hz.
const freqs = r.audio.oscillators
const hasArpeggio = [523, 659, 784, 1046].every(f => freqs.some(x => Math.abs(x - f) < 3))
console.log(hasArpeggio ? 'PASS: clearing a run plays the rising arpeggio' : 'FAIL: arpeggio — got ' + JSON.stringify(freqs))
console.log(r.runs === '1/8' ? 'PASS: the run counted on the board' : 'FAIL: runs ' + r.runs)
ws.close(); child.kill()
