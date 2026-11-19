import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9501', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9501/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

const boot = async (won) => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1000)
  await send('Runtime.evaluate', { expression: `(() => {
    const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
    localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
      columns: Array.from({length:10}, (_, i) => ({ cards:[c('a'+i, 2, i%4)] })),
      stock: [], completed: ${won ? 8 : 2}, score: ${won ? 990 : 500}, moves: 40,
      startedAt: Date.now()-300000, finishedAt: ${won ? 'Date.now()' : 'null'}, won: ${won}, ${won ? 'lost: false' : 'lost: true'} }))
  })()` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1800)
}

// Sample the canvas repeatedly and count lit pixels.
const sample = async () => JSON.parse((await send('Runtime.evaluate', { expression: `(async () => {
  const canvas = document.querySelector('.sp-fireworks')
  if (!canvas) return JSON.stringify({ present: false })
  const ctx = canvas.getContext('2d')
  const samples = []
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 220))
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    for (let p = 3; p < d.length; p += 4) if (d[p] > 12) lit++
    samples.push(lit)
  }
  return JSON.stringify({
    present: true,
    w: canvas.width, h: canvas.height,
    cssW: Math.round(canvas.getBoundingClientRect().width),
    samples,
    maxLit: Math.max(...samples),
    animated: new Set(samples).size > 1,
    ariaHidden: canvas.getAttribute('aria-hidden'),
  })
})()`, returnByValue: true, awaitPromise: true })).result.result.value)

// 1. A win draws fireworks.
await boot(true)
let r = await sample()
console.log('win:', JSON.stringify(r))
check('the win renders a fireworks canvas', r.present === true, JSON.stringify(r))
check('the canvas matches its box', r.w > 0 && r.h > 0 && r.w >= r.cssW, JSON.stringify({ w: r.w, cssW: r.cssW }))
check('pixels are painted', r.maxLit > 200, 'maxLit=' + r.maxLit)
check('the display animates', r.animated === true, JSON.stringify(r.samples))
check('it is hidden from assistive tech', r.ariaHidden === 'true')

// 2. The result card stays on top of the canvas.
const stack = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const card = document.querySelector('.sp-result-card').getBoundingClientRect()
  const hit = document.elementFromPoint(card.left + card.width/2, card.top + 20)
  return JSON.stringify({ onTop: hit !== null && !hit.classList.contains('sp-fireworks') && hit.closest('.sp-result-card') !== null })
})()`, returnByValue: true })).result.result.value)
check('the score card sits above the display', stack.onTop === true, JSON.stringify(stack))

// 3. A dead end shows no fireworks.
await boot(false)
r = await sample()
check('a dead end shows no fireworks canvas', r.present === false, JSON.stringify(r))

// 4. Reduced motion draws none.
await boot(true)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const real = window.matchMedia.bind(window)
  window.matchMedia = (q) => q.includes('reduced-motion')
    ? { matches: true, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false } }
    : real(q)
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(2200)
r = await sample()
check('reduced motion suppresses the display', r.present === true ? r.maxLit < 50 : true, JSON.stringify(r))

console.log(failures === 0 ? '\nPASS: fireworks on a win' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
