import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9541', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9541/json/list')).json()).find(t => t.type === 'page') } catch {} }
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
  const c = (id, rank, suit, faceUp) => ({ id, rank, suit, faceUp })
  const round = Array.from({ length: 10 }, (_, i) => c('r'+i, 1 + i, i % 4, false))
  localStorage.setItem('dsh.spider.game.v1', JSON.stringify({ version:1, difficulty:'four-suits', seed:1,
    columns: Array.from({length:10}, (_, i) => ({ cards:[c('h'+i, 9, i%4, false), c('u'+i, 8, i%4, true)] })),
    stock: [round], completed:0, score:500, moves:2, startedAt: Date.now()-5000, finishedAt:null, won:false }))
})()` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(1700)

const r = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const read = (el, label) => {
    const s = getComputedStyle(el)
    const before = getComputedStyle(el, '::before')
    return {
      label,
      backgroundImage: s.backgroundImage,
      backgroundColor: s.backgroundColor,
      borderRadius: s.borderRadius,
      borderWidth: s.borderWidth,
      borderColor: s.borderColor,
      ringInset: before.inset,
      ringBorder: before.border,
      ringRadius: before.borderRadius,
      ringContent: before.content,
    }
  }
  const tableau = read(document.querySelector('.sp-back'), 'tableau')
  const stock = read(document.querySelector('.sp-stock-back'), 'stock')
  return JSON.stringify({ tableau, stock })
})()`, returnByValue: true })).result.result.value)

console.log('tableau:', JSON.stringify(r.tableau, null, 1))
console.log('stock:  ', JSON.stringify(r.stock, null, 1))

const keys = ['backgroundImage', 'backgroundColor', 'borderRadius', 'borderColor', 'ringInset', 'ringBorder', 'ringRadius']
const diffs = keys.filter(k => r.tableau[k] !== r.stock[k])
check('tableau and stock backs share identical styling', diffs.length === 0, diffs.map(k => `${k}: ${r.tableau[k]} vs ${r.stock[k]}`).join('; '))
check('both backs carry the inset ring', r.tableau.ringContent !== 'none' && r.stock.ringContent !== 'none', JSON.stringify({ t: r.tableau.ringContent, s: r.stock.ringContent }))

// No obsolete pattern element remains.
const dead = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.sp-back-pattern').length`, returnByValue: true })
check('the obsolete back-pattern element is gone', dead.result.result.value === 0, String(dead.result.result.value))

// The flight card uses the same recipe too.
const flyRule = (await send('Runtime.evaluate', { expression: `(() => {
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const rule of rules) {
      if (rule.selectorText && rule.selectorText.includes('.sp-back,') && rule.selectorText.includes('.sp-fly')) return rule.selectorText
    }
  }
  return null
})()`, returnByValue: true })).result.result.value
check('the flight card shares the same recipe', typeof flyRule === 'string', String(flyRule))

console.log(failures === 0 ? '\nPASS: every card back is one design' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
