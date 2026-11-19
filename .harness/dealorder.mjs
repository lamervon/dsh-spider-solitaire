import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9521', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9521/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1000)
await send('Runtime.evaluate', { expression: `(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  const round = (n) => Array.from({ length: 10 }, (_, i) => c('r'+n+'_'+i, 1 + i, i % 4))
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: Array.from({length:10}, (_, i) => ({ cards:[c('a'+i, 9, i%4)] })),
    stock: [round(0), round(1)], completed:0, score:500, moves:2, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1800)

/** The board's observable state at one instant. */
const observe = async () => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const layer = document.querySelector('.sp-fly-layer')
  const cards = layer ? [...layer.querySelectorAll('.sp-fly')] : []
  const positions = cards.map(c => {
    const m = getComputedStyle(c).transform.match(/matrix\\(([^)]+)\\)/)
    return m ? Math.round(parseFloat(m[1].split(',')[4])) : null
  })
  return JSON.stringify({
    flying: cards.length,
    positions,
    cols: [...document.querySelectorAll('[data-column]')].map(c => c.querySelectorAll('.sp-card').length).join(','),
    stockPiles: document.querySelectorAll('.sp-stock-back').length,
    moves: [...document.querySelectorAll('.sp-meta-value')][1].textContent,
  })
})()`, returnByValue: true })).result.result.value)

const stockBox = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('.sp-stock').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }) })()`, returnByValue: true })).result.result.value)
const before = await observe()
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stockBox.x, y: stockBox.y, button: 'left', buttons: 1, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stockBox.x, y: stockBox.y, button: 'left', buttons: 0, clickCount: 1 })

const during = await observe()          // immediately: cards are in the air
await wait(300)
const mid = await observe()
await wait(900)
const after = await observe()

console.log('before:', JSON.stringify(before))
console.log('during:', JSON.stringify(during))
console.log('mid:   ', JSON.stringify(mid))
console.log('after: ', JSON.stringify(after))

check('before the deal every column holds one card', before.cols === '1,1,1,1,1,1,1,1,1,1', before.cols)
check('the round takes flight immediately', during.flying === 10, String(during.flying))
check('the board does NOT change while cards fly', during.cols === before.cols && mid.cols === before.cols, `during=${during.cols} mid=${mid.cols}`)
check('the stock still shows its pile in flight', during.stockPiles === before.stockPiles, `${before.stockPiles} -> ${during.stockPiles}`)
check('the move count waits for the landing', during.moves === before.moves, `${before.moves} -> ${during.moves}`)
check('cards travel across the felt mid-flight', new Set(mid.positions).size >= 4, JSON.stringify(mid.positions))
check('the round commits once the last card lands', after.cols === '2,2,2,2,2,2,2,2,2,2', after.cols)
check('the overlay is gone after landing', after.flying === 0, String(after.flying))
check('the stock shrank after landing', after.stockPiles === before.stockPiles - 1, `${before.stockPiles} -> ${after.stockPiles}`)

console.log(failures === 0 ? '\nPASS: cards fly first, then land' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
