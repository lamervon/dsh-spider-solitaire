import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9491', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9491/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

const boot = async (board) => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1000)
  await send('Runtime.evaluate', { expression: board })
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1700)
}
const clickHint = async () => {
  const b = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const el = [...document.querySelectorAll('.sp-tool')].find(x => x.getAttribute('aria-label') === '提示'); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }) })()`, returnByValue: true })).result.result.value)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
  await wait(400)
}

// 1. No card can move, the stock still holds a round: the hint lights the stock.
await boot(`(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const round = Array.from({ length: 10 }, (_, i) => c('r'+i, i + 1, 0))
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: [{ cards:[c('a',9,0)] }, { cards:[c('b',5,1)] }, ...Array.from({length:8}, (_, i) => ({ cards:[c('z'+i, 2, i%4)] }))],
    stock: [round], completed:0, score:500, moves:3, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()`)
await clickHint()
let r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const s = document.querySelector('.sp-stock')
  return JSON.stringify({ hintClass: s.classList.contains('sp-stock-hint'), anim: getComputedStyle(s).animationName, status: document.querySelector('.sp-status').textContent, over: document.querySelector('.sp-result-card') !== null })
})()`, returnByValue: true })).result.result.value)
check('no move + stock available: the stock is highlighted', r.hintClass && r.anim === 'sp-pulse', JSON.stringify(r))
check('no move + stock available: the game is NOT over', !r.over, JSON.stringify(r))
check('the status line points at the deal', r.status.includes('发一轮'), r.status)

// 2. No move and no stock: the game ends with the dead-end card.
await boot(`(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: [{ cards:[c('a',9,0)] }, { cards:[c('b',5,1)] }, ...Array.from({length:8}, (_, i) => ({ cards:[c('z'+i, 2, i%4)] }))],
    stock: [], completed:2, score:500, moves:8, startedAt: Date.now()-60000, finishedAt:null, won:false }))
})()`)
await clickHint()
r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const card = document.querySelector('.sp-result-card')
  return JSON.stringify({
    over: card !== null,
    lost: document.querySelector('.sp-win')?.classList.contains('sp-win-lost') ?? false,
    title: document.querySelector('.sp-result-title')?.textContent,
    note: document.querySelector('.sp-result-note')?.textContent,
    body: card?.textContent ?? '',
    movesDisabled: [...document.querySelectorAll('.sp-tool')].find(x => x.getAttribute('aria-label') === '撤销')?.disabled,
    stats: JSON.parse(localStorage.getItem('dsh.spider.stats.v1'))?.['four-suits']?.played ?? 0,
  })
})()`, returnByValue: true })).result.result.value)
check('no move + no stock: the game is over', r.over && r.lost, JSON.stringify(r))
check('the dead end is explained', r.title === '没有可走的棋了' && r.note.includes('牌堆已发完'), JSON.stringify({ t: r.title, n: r.note }))
check('the board is frozen', r.movesDisabled === true, String(r.movesDisabled))
check('the loss is counted', r.stats === 1, 'played=' + r.stats)

// 3. A real move still takes precedence over the stock hint.
await boot(`(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const round = Array.from({ length: 10 }, (_, i) => c('r'+i, i + 1, 0))
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: [{ cards:[c('a',8,0)] }, { cards:[c('b',9,0)] }, ...Array.from({length:8}, (_, i) => ({ cards:[c('z'+i, 2, i%4)] }))],
    stock: [round], completed:0, score:500, moves:3, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()`)
await clickHint()
r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => JSON.stringify({ colHint: document.querySelectorAll('.sp-col-hint').length, stockHint: document.querySelector('.sp-stock').classList.contains('sp-stock-hint') }))()`, returnByValue: true })).result.result.value)
check('a legal move highlights its column, not the stock', r.colHint === 1 && !r.stockHint, JSON.stringify(r))

console.log(failures === 0 ? '\nPASS: hint highlights the stock; a dead end ends the game' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
