import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9431', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9431/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

// Column 0: 9-8-7-6-5 spades. Column 1: 8 hearts (accepts the tail from 7).
// Column 2: 10 spades. Column 3: 9 diamonds (accepts the tail from 8).
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
  await wait(400)
}
// What does the lifted group look like mid-drag?
const liftedDuringDrag = async (col, index) => {
  const a = await point(col, index)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 40, y: a.y + 40, button: 'left', buttons: 1 })
  await wait(150)
  const r = (await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.sp-card-lifted')].map(k => k.getAttribute('data-rank')))`, returnByValue: true })).result.result.value
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x + 40, y: a.y + 40, button: 'left', buttons: 0, clickCount: 1 })
  await wait(200)
  const after = await state()  // release over empty space = no move
  return { lifted: JSON.parse(r), after }
}

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) } }

// Grabbing the 8 lifts 8,7,6,5.
await setup()
let info = await liftedDuringDrag(0, 1)
check('grabbing the 8 lifts 8,7,6,5 together', JSON.stringify(info.lifted) === JSON.stringify(['8','7','6','5']), JSON.stringify(info.lifted))

// Grabbing the 9 lifts all five.
await setup()
info = await liftedDuringDrag(0, 0)
check('grabbing the 9 lifts 9,8,7,6,5 together', JSON.stringify(info.lifted) === JSON.stringify(['9','8','7','6','5']), JSON.stringify(info.lifted))

// Grabbing the 5 lifts just itself.
await setup()
info = await liftedDuringDrag(0, 4)
check('grabbing the 5 lifts only the 5', JSON.stringify(info.lifted) === JSON.stringify(['5']), JSON.stringify(info.lifted))

// A real drag of the 8 onto the 9 of diamonds moves 8,7,6,5 as one group.
await setup()
await drag(await point(0, 1), await bgPoint(3))
let s = await state()
check('dragging the 8 moves the whole 8,7,6,5 group', s[0] === '9' && s[3] === '9,8,7,6,5', JSON.stringify(s))

console.log(failures === 0 ? '\nPASS: grabbing a card takes every card below it' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
