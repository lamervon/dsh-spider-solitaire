import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9791', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9791/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

// The card's own glyphs must never overlap each other, at any pane width.
for (const w of [300, 360, 420, 700, 1240]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w + 20, height: 1050, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(1000)
  await send('Runtime.evaluate', { expression: `(() => {
    const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
    const columns = [{ cards: [c('a1', 13, 0)] }, ...Array.from({ length: 9 }, (_, i) => ({ cards: [c('z' + i, 3, 2)] }))]
    localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version: 1, difficulty: 'four-suits', seed: 1, columns, stock: [], completed: 0, score: 500, moves: 0, startedAt: Date.now() - 5000, finishedAt: null, won: false }))
  })()` })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(2000)
  const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const card = document.querySelector('[data-column="0"] .sp-card')
    const cr = card.getBoundingClientRect()
    const visible = el => { const b = el.getBoundingClientRect(); return b.width > 1 && b.height > 1 }
    const pip = card.querySelector('.sp-pip')
    const corners = [...card.querySelectorAll('.sp-corner')]
    const drawn = [...corners.filter(visible), ...(visible(pip) ? [pip] : [])].map(el => el.getBoundingClientRect())
    let overlaps = false
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j]
      if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) overlaps = true
    }
    return JSON.stringify({
      card: [Math.round(cr.width), Math.round(cr.height)],
      corners: corners.filter(visible).length,
      pip: visible(pip),
      overlaps,
    })
  })()`, returnByValue: true })).result.result.value)
  check(`${w}px: no card glyph overlaps (card ${r.card.join('x')}, ${r.corners} index, pip ${r.pip ? 'shown' : 'hidden'})`, !r.overlaps, JSON.stringify(r))
}

console.log(failures === 0 ? '\nPASS: card glyphs stay clear of one another' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
