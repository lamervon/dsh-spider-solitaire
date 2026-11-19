import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9561', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9561/json/list')).json()).find(t => t.type === 'page') } catch {} }
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
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: Array.from({length:10}, (_, i) => ({ cards:[c('a'+i, 2, i%4)] })), stock: [], completed: 8, score: 990, moves: 40,
    startedAt: Date.now()-300000, finishedAt: Date.now(), won: true, lost: false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1800)

// Sample coverage over time: how much of the canvas is lit, and how bright.
const samples = JSON.parse((await send('Runtime.evaluate', { expression: `(async () => {
  const canvas = document.querySelector('.sp-fireworks')
  const ctx = canvas.getContext('2d')
  const out = []
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250))
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0, bright = 0, maxA = 0
    for (let p = 3; p < d.length; p += 4) {
      const a = d[p]
      if (a > 12) lit++
      if (a > 120) bright++
      if (a > maxA) maxA = a
    }
    out.push({ lit, bright, maxA, area: canvas.width * canvas.height })
  }
  return JSON.stringify(out)
})()`, returnByValue: true, awaitPromise: true })).result.result.value)

const peakLit = Math.max(...samples.map(s => s.lit))
const peakBright = Math.max(...samples.map(s => s.bright))
const area = samples[0].area
console.log('peak lit px:', peakLit, '(', (peakLit / area * 100).toFixed(2), '% of canvas )')
console.log('peak bright px:', peakBright)
console.log('samples:', JSON.stringify(samples.map(s => s.lit)))

check('bursts cover far more of the pane', peakLit > 12000, String(peakLit))
check('the display has bright cores', peakBright > 1500, String(peakBright))
check('the sky stays busy across samples', samples.filter(s => s.lit > 2000).length >= 8, JSON.stringify(samples.map(s => s.lit)))
check('it animates frame to frame', new Set(samples.map(s => s.lit)).size >= 6, JSON.stringify(samples.map(s => s.lit)))

console.log(failures === 0 ? '\nPASS: the fireworks fill the pane' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
