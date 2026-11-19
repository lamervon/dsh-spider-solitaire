import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9386', '--window-size=1400,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9386/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 1032, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=1238' })
await wait(2000)

// Write the broken save this build used to produce: a stock whose last round
// holds four cards, plus columns carrying an empty `{ faceUp: true }` card.
await send('Runtime.evaluate', { expression: `(() => {
  const cards = (n, start) => Array.from({ length: n }, (_, i) => ({ id: 'x' + (start + i), rank: (i % 13) + 1, suit: 0 }))
  const columns = Array.from({ length: 10 }, (_, i) => ({ cards: cards(6, i * 6).map((c, k) => ({ ...c, faceUp: k === 5 })) }))
  columns[9].cards.push({ faceUp: true })
  const stock = [cards(10, 0), cards(10, 10), cards(10, 20), cards(10, 30), cards(4, 40)]
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({
    version: 1, difficulty: 'one-suit', seed: 1, columns, stock,
    completed: 0, score: 500, moves: 1, startedAt: Date.now() - 60000, finishedAt: null, won: false,
  }))
  return 'written'
})()`, returnByValue: true })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=1238' })
await wait(2200)
const r = await send('Runtime.evaluate', { expression: `(() => {
  const cols = [...document.querySelectorAll('[data-column]')]
  const all = cols.map(c => [...c.querySelectorAll('.sp-card')])
  const blanks = all.flat().filter(c => !c.classList.contains('sp-back') && !c.querySelector('.sp-rank'))
  const shape = all.map(c => c.length)
  const broken = JSON.parse(localStorage.getItem('dsh.spider.game.v1'))
  return JSON.stringify({
    columns: shape,
    blanks: blanks.length,
    savedStockRounds: broken.stock.map(r => r.length),
    savedDifficult: broken.difficulty,
  })
})()`, returnByValue: true })
console.log(r.result?.result?.value)
ws.close(); child.kill()
