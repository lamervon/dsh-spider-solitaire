import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9531', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9531/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }
const BOOT = `(() => {
  const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'two-suits', seed:3,
    columns: Array.from({length:10}, (_, i) => ({ cards:[c('a'+i, 5, i%4)] })), stock:[], completed:0, score:500, moves:4, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()`

for (const [w, label] of [[940, 'wide'], [420, 'narrow'], [300, 'tiny']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w + 20, height: 1050, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(900)
  await send('Runtime.evaluate', { expression: BOOT })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(1600)
  const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const btn = document.querySelector('.sp-new')
    const tools = [...document.querySelectorAll('.sp-tool')]
    const b = btn.getBoundingClientRect()
    const t0 = tools[0].getBoundingClientRect()
    const row = document.querySelector('.sp-tools').getBoundingClientRect()
    return JSON.stringify({
      text: btn.textContent.trim(),
      hasLabelSpan: btn.querySelector('.sp-new-label') !== null,
      size: Math.round(b.width) + 'x' + Math.round(b.height),
      sameAsTools: Math.round(b.width) === Math.round(t0.width) && Math.round(b.height) === Math.round(t0.height),
      aligned: Math.round(b.top) === Math.round(t0.top),
      svg: btn.querySelectorAll('svg').length,
      ariaLabel: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      fits: b.right <= row.right + 1,
      overflow: document.querySelector('.sp-tools').scrollWidth > document.querySelector('.sp-tools').clientWidth + 1,
    })
  })()`, returnByValue: true })).result.result.value)
  console.log(label, JSON.stringify(r))
  check(label + ': icon only, no text', r.text === '' && !r.hasLabelSpan && r.svg === 1, JSON.stringify(r))
  check(label + ': same size and alignment as the tools', r.sameAsTools && r.aligned, JSON.stringify(r))
  check(label + ': still named for assistive tech', r.ariaLabel === '新游戏' && r.title === '新游戏', JSON.stringify(r))
  check(label + ': row does not overflow', r.fits && !r.overflow, JSON.stringify(r))
}

// The button still deals a fresh board.
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(900)
await send('Runtime.evaluate', { expression: BOOT })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1700)
const box = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('.sp-new').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }) })()`, returnByValue: true })).result.result.value)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 })
await wait(400)
const after = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify({ cols: [...document.querySelectorAll('[data-column]')].map(c => c.querySelectorAll('.sp-card').length).join(','), moves: [...document.querySelectorAll('.sp-meta-value')][1].textContent })`, returnByValue: true })).result.result.value)
check('it still deals a new game', after.cols === '6,6,6,6,5,5,5,5,5,5' && after.moves === '0', JSON.stringify(after))

console.log(failures === 0 ? '\nPASS: New game is an icon-only button' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
