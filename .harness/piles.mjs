import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9551', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9551/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

// Three cleared runs so the piles are on screen, plus a stock and hidden cards.
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1000)
await send('Runtime.evaluate', { expression: `(() => {
  const c = (id, rank, suit, faceUp) => ({ id, rank, suit, faceUp })
  const round = Array.from({ length: 10 }, (_, i) => c('r'+i, 1 + i, i%4, false))
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: Array.from({length:10}, (_, i) => ({ cards:[c('h'+i, 9, i%4, false), c('u'+i, 8, i%4, true)] })),
    stock: [round], completed: 3, score: 800, moves: 12, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1700)

const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const read = (el, label) => {
    const s = getComputedStyle(el)
    const b = getComputedStyle(el, '::before')
    return {
      label,
      bg: s.backgroundImage,
      color: s.backgroundColor,
      radius: s.borderRadius,
      border: s.borderColor + ' / ' + s.borderWidth,
      ringInset: b.inset,
      ringBorder: b.border,
      ringRadius: b.borderRadius,
      hasRing: b.content !== 'none',
    }
  }
  const span = document.querySelector('.sp-run-done')
  return JSON.stringify({
    tableau: read(document.querySelector('.sp-back'), 'tableau'),
    stock: read(document.querySelector('.sp-stock-back'), 'stock'),
    pile: read(span, 'pile'),
    pileCount: document.querySelectorAll('.sp-run-done').length,
    pileText: span.textContent,
  })
})()`, returnByValue: true })).result.result.value)

console.log('tableau:', JSON.stringify(r.tableau))
console.log('stock:  ', JSON.stringify(r.stock))
console.log('pile:   ', JSON.stringify(r.pile))

check('three cleared piles are on screen', r.pileCount === 3, String(r.pileCount))
const keys = ['bg', 'color', 'radius', 'border', 'ringInset', 'ringBorder', 'ringRadius', 'hasRing']
const diffs = keys.filter(k => r.tableau[k] !== r.pile[k] || r.stock[k] !== r.pile[k])
check('the cleared pile wears the identical back', diffs.length === 0,
  diffs.map(k => `${k}: tableau=${r.tableau[k]} pile=${r.pile[k]}`).join('; '))
check('the cleared pile still shows its pips', r.pileText.length > 0, JSON.stringify(r.pileText))

console.log(failures === 0 ? '\nPASS: the cleared pile matches every other back' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
