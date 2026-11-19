import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9481', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9481/json/list')).json()).find(t => t.type === 'page') } catch {} }
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
  localStorage.removeItem('dsh.spider.sound.v1')
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'two-suits', seed:7,
    columns: Array.from({length:10}, (_, i) => ({ cards: [c('a'+i, 5, i % 4)] })), stock:[], completed:0, score:500, moves:3, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()`

for (const [w, label] of [[940, 'wide'], [420, 'narrow'], [300, 'tiny']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w + 20, height: 1050, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(900)
  await send('Runtime.evaluate', { expression: BOOT })
  await send('Page.navigate', { url: `http://127.0.0.1:8791/.harness/index.html?lang=zh&width=${w}` })
  await wait(1700)
  const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const btn = document.querySelector('.sp-new')
    const label = document.querySelector('.sp-new-label')
    const tools = document.querySelector('.sp-tools')
    const br = btn.getBoundingClientRect()
    const tr = tools.getBoundingClientRect()
    const root = document.querySelector('.sp-root').getBoundingClientRect()
    return JSON.stringify({
      text: btn.textContent.trim(),
      ariaLabel: btn.getAttribute('aria-label'),
      labelVisible: label !== null && label.getBoundingClientRect().width > 0,
      size: Math.round(br.width) + 'x' + Math.round(br.height),
      fitsRow: br.right <= tr.right + 1,
      toolsOverflow: tools.scrollWidth > tools.clientWidth + 1,
      rowWithinRoot: tr.right <= root.right + 1,
      bg: getComputedStyle(btn).backgroundColor,
      iconCount: btn.querySelectorAll('svg path').length,
    })
  })()`, returnByValue: true })).result.result.value)
  console.log(label, JSON.stringify(r))
}

// The button deals a fresh game at the current difficulty and counts the old one as a loss.
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(900)
await send('Runtime.evaluate', { expression: BOOT })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1700)
const before = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify({ moves: [...document.querySelectorAll('.sp-meta-value')][1].textContent, score: [...document.querySelectorAll('.sp-meta-value')][0].textContent, cols: [...document.querySelectorAll('[data-column]')].map(c => c.querySelectorAll('.sp-card').length).join(',') })`, returnByValue: true })).result.result.value)
const box = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('.sp-new').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }) })()`, returnByValue: true })).result.result.value)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 })
await wait(500)
const after = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify({ moves: [...document.querySelectorAll('.sp-meta-value')][1].textContent, score: [...document.querySelectorAll('.sp-meta-value')][0].textContent, cols: [...document.querySelectorAll('[data-column]')].map(c => c.querySelectorAll('.sp-card').length).join(','), lost: JSON.parse(localStorage.getItem('dsh.spider.stats.v1'))?.['two-suits']?.played ?? 0 })`, returnByValue: true })).result.result.value)
check('the New game button deals a fresh board', after.cols === '6,6,6,6,5,5,5,5,5,5' && after.moves === '0' && after.score === '500', JSON.stringify(after))
check('the abandoned game was counted', after.lost === 1, 'played=' + after.lost)

console.log(failures === 0 ? '\nPASS: New game button' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
