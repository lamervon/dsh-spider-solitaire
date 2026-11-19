import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9385', '--window-size=1400,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9385/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')

/** Read every card: back or face with its rank+ink; a blank face is a failure. */
const readAll = async () => JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const cols = [...document.querySelectorAll('[data-column]')]
  return JSON.stringify(cols.map(col => [...col.querySelectorAll('.sp-card')].map(c => {
    const back = c.classList.contains('sp-back')
    const rank = c.getAttribute('data-rank')
    const r = c.querySelector('.sp-rank')?.textContent ?? null
    const s = c.querySelector('.sp-suit')?.textContent ?? null
    const pip = c.querySelector('.sp-pip')?.textContent ?? null
    return { back, rank, r, s, pip, blank: !back && (!r || !s) }
  })))
})()`, returnByValue: true })).result.result.value)

async function deal() {
  const pt = JSON.parse((await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('.sp-stock').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }) })()`, returnByValue: true })).result.result.value)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 })
  }
  await wait(500)
}

await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 1032, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=1238' })
await wait(400)
await send('Runtime.evaluate', { expression: 'localStorage.clear()' })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=1238' })
await wait(2200)

let failures = 0
for (let round = 1; round <= 5; round++) {
  if (round > 1) await deal()
  const all = await readAll()
  const blanks = all.flat().filter(c => c.blank)
  const counts = all.map(col => col.length)
  const faces = all.flat().filter(c => !c.back)
  const missingPip = faces.filter(c => !c.pip)
  const missingCorner = faces.filter(c => !c.r || !c.s)
  const anyUndefined = all.flat().some(c => c.rank === null && !c.back)
  console.log(`round ${round}: columns=[${counts.join(',')}] blanks=${blanks.length} missingCorner=${missingCorner.length} missingPip=${missingPip.length} undefinedFace=${anyUndefined ? 'YES' : 'no'}`)
  if (blanks.length > 0) { failures++; console.log('  BLANK CARDS:', JSON.stringify(blanks.slice(0, 3))) }
  if (missingCorner.length > 0) failures++
  if (anyUndefined) failures++
}
console.log(failures === 0 ? 'PASS: all 5 stock rounds deal complete cards' : `FAIL: ${failures} problem(s)`)
ws.close(); child.kill()
