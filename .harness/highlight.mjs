import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9451', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9451/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1200)
await send('Runtime.evaluate', { expression: `(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const columns = [
    { cards: [c('a9',9,0), c('a8',8,0), c('a7',7,0), c('a6',6,0), c('a5',5,0)] },
    { cards: [c('b8',8,1)] },
    ...Array.from({ length: 8 }, (_, i) => ({ cards: [c('z'+i, 2, i % 4)] })),
  ]
  localStorage.removeItem('dsh.spider.sound.v1')
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1, columns, stock:[], completed:0, score:500, moves:0, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1800)
// Click the 8 (index 1) to select 8,7,6,5.
const p = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const cards = [...document.querySelectorAll('[data-column="0"] .sp-card')]
  const r = cards[1].getBoundingClientRect()
  const n = cards[2].getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top + (n.top-r.top)/2) })
})()`, returnByValue: true })).result.result.value)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
await wait(350)
const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const sel = [...document.querySelectorAll('.sp-card-selected')]
  return JSON.stringify({
    count: sel.length,
    ranks: sel.map(c => c.getAttribute('data-rank')),
    ariaSelected: sel.map(c => c.getAttribute('aria-selected')),
    lastClosed: sel.filter(c => c.classList.contains('sp-card-selected-last')).map(c => c.getAttribute('data-rank')),
    barVisible: sel.map(c => {
      const s = getComputedStyle(c, '::after')
      return { h: s.height, bg: s.backgroundColor, pos: s.position }
    }),
    tint: sel.map(c => getComputedStyle(c).backgroundColor),
  })
})()`, returnByValue: true })).result.result.value)
console.log(JSON.stringify(r, null, 1))
const allBars = r.barVisible.every(b => parseFloat(b.h) > 0 && b.bg !== 'rgba(0, 0, 0, 0)')
const allTinted = r.tint.every(t => t === r.tint[0])
console.log(r.count === 4 ? 'PASS: four cards selected' : 'FAIL count ' + r.count)
console.log(allBars ? 'PASS: every selected card paints a top bar' : 'FAIL bars ' + JSON.stringify(r.barVisible))
console.log(allTinted ? 'PASS: the whole run is tinted alike' : 'FAIL tint ' + JSON.stringify(r.tint))
console.log(r.lastClosed.join(',') === '5' ? 'PASS: only the run\'s last card takes the closing outline' : 'FAIL last ' + r.lastClosed)
ws.close(); child.kill()
