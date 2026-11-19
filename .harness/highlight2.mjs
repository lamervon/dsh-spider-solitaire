import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9452', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9452/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
for (const [w, label] of [[940, 'wide'], [420, 'narrow']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w + 20, height: 1050, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(1000)
  await send('Runtime.evaluate', { expression: `(() => {
    const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
    const cards = []
    for (let r = 13; r >= 1; r--) cards.push(c('a'+r, r, 0))
    const columns = [
      { cards },
      { cards: [c('b8',8,1)] },
      ...Array.from({ length: 8 }, (_, i) => ({ cards: [c('z'+i, 2, i % 4)] })),
    ]
    localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1, columns, stock:[], completed:0, score:500, moves:0, startedAt: Date.now()-5000, finishedAt:null, won:false }))
  })()` })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(1600)
  // Select from the middle of a 13-card column: the worst case for stacking.
  const p = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const cards = [...document.querySelectorAll('[data-column="0"] .sp-card')]
    const r = cards[6].getBoundingClientRect()
    const n = cards[7].getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top + Math.max(2,(n.top-r.top)/2)) })
  })()`, returnByValue: true })).result.result.value)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  await wait(350)
  const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const all = [...document.querySelectorAll('[data-column="0"] .sp-card')]
    const sel = all.filter(c => c.classList.contains('sp-card-selected'))
    // Is each bar inside the strip the card actually shows?
    const visible = all.slice(0, -1).map((card, i) => {
      const next = all[i+1].getBoundingClientRect()
      return Math.round(next.top - card.getBoundingClientRect().top)
    })
    return JSON.stringify({
      selected: sel.length,
      barHeights: sel.map(c => parseFloat(getComputedStyle(c, '::after').height)),
      stripHeights: visible.slice(6),
      barsFit: visible.slice(6).every((strip, i) => sel[i] && strip >= 3),
    })
  })()`, returnByValue: true })).result.result.value)
  console.log(label, JSON.stringify(r))
}
ws.close(); child.kill()
