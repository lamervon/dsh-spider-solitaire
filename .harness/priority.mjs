import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9413', '--window-size=1300,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9413/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false })

// Column 1: 9♥ (different suit, accepts 8♠). Column 2: 9♠ (same suit). Both
// accept the 8♠; the same-suit column must win.
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=880' })
await wait(1500)
await send('Runtime.evaluate', { expression: `(() => {
  const card = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const columns = [
    { cards: [card('a1', 8, 0)] },
    { cards: [card('b1', 9, 1)] },
    { cards: [card('c1', 9, 0)] },
    ...Array.from({ length: 7 }, (_, i) => ({ cards: [card('z' + i, 2, i % 4)] })),
  ]
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({
    version: 1, difficulty: 'four-suits', seed: 1, columns, stock: [],
    completed: 0, score: 500, moves: 0, startedAt: Date.now() - 5000, finishedAt: null, won: false,
  }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=880' })
await wait(2000)

const pt = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const r = document.querySelector('[data-column="0"] .sp-card').getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+6) })
})()`, returnByValue: true })).result.result.value)
for (const clickCount of [1, 2]) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount })
  await wait(110)
}
await wait(400)
const r = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('[data-column]')].slice(0,3).map(c => [...c.querySelectorAll('.sp-card')].map(k => k.getAttribute('data-rank')).join(',')))`, returnByValue: true })
const cols = JSON.parse(r.result.result.value)
console.log('columns 0-2:', cols)
console.log(cols[2] === '9,8' && cols[0] === '' ? 'PASS: double click chose the SAME-SUIT column over the different-suit one' : 'FAIL: priority')
ws.close(); child.kill()
