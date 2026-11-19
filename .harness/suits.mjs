import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9571', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9571/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }

const boot = async (completed) => {
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(900)
  await send('Runtime.evaluate', { expression: `(() => {
    const c = (id, rank, suit) => ({ id, rank, suit, faceUp: true })
    localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
      columns: Array.from({length:10}, (_, i) => ({ cards:[c('a'+i, 2, i%4)] })), stock: [], completed: ${completed},
      score: 500, moves: 10, startedAt: Date.now()-60000, finishedAt:null, won:false }))
  })()` })
  await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
  await wait(1600)
}

const readPiles = async () => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const slots = [...document.querySelectorAll('.sp-run')]
  return JSON.stringify(slots.map((s, i) => ({
    i,
    text: s.textContent,
    done: s.classList.contains('sp-run-done'),
    red: s.classList.contains('sp-red-run'),
    color: getComputedStyle(s).color,
  })))
})()`, returnByValue: true })).result.result.value)

// All eight cleared: the glyphs must cycle through four suits twice.
await boot(8)
let piles = await readPiles()
console.log('all cleared:', JSON.stringify(piles.map(p => p.text + (p.red ? '(red)' : ''))))
const glyphs = piles.map(p => p.text)
check('eight slots all carry a glyph', glyphs.length === 8 && glyphs.every(g => g.length > 0), JSON.stringify(glyphs))
check('the suits cycle through four, twice', JSON.stringify(glyphs) === JSON.stringify(['♠','♥','♦','♣','♠','♥','♦','♣']), JSON.stringify(glyphs))
check('hearts and diamonds show red', piles[1].red && piles[2].red && piles[5].red && piles[6].red, JSON.stringify(piles.map(p => p.red)))
check('spades and clubs stay white', !piles[0].red && !piles[3].red, JSON.stringify(piles.map(p => p.red)))
check('red glyphs use the red ink', piles[1].color !== piles[0].color, `${piles[0].color} vs ${piles[1].color}`)

// Partially cleared: the cycle holds for the filled slots only.
await boot(3)
piles = await readPiles()
console.log('three cleared:', JSON.stringify(piles.map(p => p.text + (p.done ? '' : '.'))))
check('only the cleared runs carry a glyph', piles.filter(p => p.done).length === 3, JSON.stringify(piles.map(p => p.done)))
check('the first three follow the cycle', JSON.stringify(piles.slice(0, 3).map(p => p.text)) === JSON.stringify(['♠','♥','♦']), JSON.stringify(piles.slice(0, 3).map(p => p.text)))
check('empty slots stay blank', piles.slice(3).every(p => p.text === ''), JSON.stringify(piles.slice(3).map(p => p.text)))

console.log(failures === 0 ? '\nPASS: cleared runs cycle their suits' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
