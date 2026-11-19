import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9419', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9419/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

// Column 0: 9-8-7-6-5 of spades (one perfect descent).
// Column 1: 8 of hearts — accepts a tail starting at the 7.
// Column 2: 10 of spades — accepts the whole nine-high run.
const BOARD = `(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const columns = [
    { cards: [c('a9',9,0), c('a8',8,0), c('a7',7,0), c('a6',6,0), c('a5',5,0)] },
    { cards: [c('b8',8,1)] },
    { cards: [c('c10',10,0)] },
    { cards: [c('d9',9,2)] },
    ...Array.from({ length: 6 }, (_, i) => ({ cards: [c('z'+i, 2, i % 4)] })),
  ]
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({
    version: 1, difficulty: 'four-suits', seed: 1, columns, stock: [],
    completed: 0, score: 500, moves: 0, startedAt: Date.now() - 5000, finishedAt: null, won: false,
  }))
})()`

const setup = async () => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1200)
  await send('Runtime.evaluate', { expression: BOARD })
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1800)
}
const state = async () => JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('[data-column]')].slice(0,4).map(c => [...c.querySelectorAll('.sp-card')].map(k => k.getAttribute('data-rank')).join(',')))`, returnByValue: true })).result.result.value)
const point = async (col, index) => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const cards = [...document.querySelectorAll('[data-column="${col}"] .sp-card')]
  const r = cards[${index}].getBoundingClientRect()
  // A covered card shows only the strip above the next card; aim at the middle
  // of that strip so the press lands on this card, not the one beneath it.
  const next = cards[${index} + 1]?.getBoundingClientRect()
  const bottom = next ? next.top : r.bottom
  const y = Math.round(r.top + Math.max(3, (bottom - r.top) / 2))
  return JSON.stringify({ x: Math.round(r.left + r.width/2), y })
})()`, returnByValue: true })).result.result.value)
const bgPoint = async (col) => JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('[data-column="${col}"]').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top + r.height*0.6) }) })()`, returnByValue: true })).result.result.value)
const down = async (p) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
const up = async (p) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
const click = async (p) => { await down(p); await up(p); await wait(300) }
const drag = async (a, b) => {
  await down(a)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 14, y: a.y + 14, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 })
  await up(b)
  await wait(400)
}
const dbl = async (p) => {
  for (const clickCount of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount })
    await wait(110)
  }
  await wait(450)
}

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

// 1. Drag from the MIDDLE (the 7 at index 2) onto the 8 of hearts.
await setup()
await drag(await point(0, 2), await bgPoint(1))
let s = await state()
check('drag from the middle lifts only 7,6,5', s[0] === '9,8' && s[1] === '8,7,6,5', JSON.stringify(s))

// 2. Double click the MIDDLE (the 7): only 7,6,5 moves, onto the 8 of hearts.
await setup()
await dbl(await point(0, 2))
s = await state()
check('double click from the middle moves only 7,6,5', s[0] === '9,8' && s[1] === '8,7,6,5', JSON.stringify(s))

// 3. Click-to-select the MIDDLE (the 8), then click the 9 of diamonds' column.
await setup()
await click(await point(0, 1))
const selected = (await send('Runtime.evaluate', { expression: `document.querySelectorAll('.sp-card-selected').length`, returnByValue: true })).result.result.value
check('clicking the middle selects only 8,7,6,5', selected === 4, 'selected=' + selected)
await click(await bgPoint(3))
s = await state()
check('the selected tail lands on the 9 of diamonds', s[0] === '9' && s[3] === '9,8,7,6,5', JSON.stringify(s))

// 4. The whole run still moves when its head is used.
await setup()
await drag(await point(0, 0), await bgPoint(2))
s = await state()
check('dragging the head still moves the whole run', s[0] === '' && s[2] === '10,9,8,7,6,5', JSON.stringify(s))

console.log(failures === 0 ? '\nPASS: a descent can be split at any card' : `\nFAIL: ${failures} check(s)`)
ws.close(); child.kill()
