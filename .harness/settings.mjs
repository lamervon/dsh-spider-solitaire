import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9701', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9701/json/list')).json()).find(t => t.type === 'page') } catch {} }
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
await wait(1200)
await send('Runtime.evaluate', { expression: `localStorage.removeItem('dsh.spider.table.v1'); localStorage.removeItem('dsh.spider.back.v1')` })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(2000)

// Open settings by its accessible name.
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === '设置').click()` })
await wait(400)
const opened = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const dlg = document.querySelector('.sp-dialog[aria-label="设置"]')
  return JSON.stringify({
    open: dlg !== null,
    tableSwatches: document.querySelectorAll('.sp-table-swatch-green, .sp-table-swatch-blue, .sp-table-swatch-red, .sp-table-swatch-charcoal').length,
    backSwatches: document.querySelectorAll('.sp-back-swatch-classic, .sp-back-swatch-ruby, .sp-back-swatch-violet, .sp-back-swatch-midnight').length,
    on: document.querySelectorAll('.sp-swatch-on').length,
    note: document.querySelector('.sp-dialog-note')?.textContent,
  })
})()`, returnByValue: true })).result.result.value)
console.log(JSON.stringify(opened))
check('the settings dialog opens with four felt and four back choices', opened.open && opened.tableSwatches === 4 && opened.backSwatches === 4, JSON.stringify(opened))
check('the current picks are marked', opened.on === 2, String(opened.on))

// Pick the blue felt and the ruby back.
await send('Runtime.evaluate', { expression: `document.querySelector('.sp-table-swatch-blue').click()` })
await wait(200)
await send('Runtime.evaluate', { expression: `document.querySelector('.sp-back-swatch-ruby').click()` })
await wait(300)
const applied = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const table = document.querySelector('.sp-table')
  const back = document.querySelector('.sp-back')
  const cls = table.className
  return JSON.stringify({
    classes: cls,
    felt: getComputedStyle(document.querySelector('.sp-root')).getPropertyValue('--sp-felt').trim() || getComputedStyle(table).getPropertyValue('--sp-felt').trim(),
    tableBg: getComputedStyle(table).backgroundColor,
    backInk: getComputedStyle(back).getPropertyValue('--sp-back-ink').trim(),
    backBg: getComputedStyle(back).backgroundColor,
    storedTable: localStorage.getItem('dsh.spider.table.v1'),
    storedBack: localStorage.getItem('dsh.spider.back.v1'),
  })
})()`, returnByValue: true })).result.result.value)
console.log(JSON.stringify(applied))
check('the felt repaints to the chosen colour', applied.classes.includes('sp-felt-blue') && applied.tableBg === 'rgb(47, 111, 168)', JSON.stringify(applied))
check('the card backs repaint to the chosen colour', applied.classes.includes('sp-backs-ruby'), applied.classes)
check('both choices persist', applied.storedTable === 'blue' && applied.storedBack === 'ruby', JSON.stringify({ t: applied.storedTable, b: applied.storedBack }))

// A reload keeps them.
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(2000)
const after = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const table = document.querySelector('.sp-table')
  return JSON.stringify({ classes: table.className, tableBg: getComputedStyle(table).backgroundColor, backBg: getComputedStyle(document.querySelector('.sp-back')).backgroundColor })
})()`, returnByValue: true })).result.result.value)
console.log(JSON.stringify(after))
check('a reload restores the chosen table and backs', after.classes.includes('sp-felt-blue') && after.classes.includes('sp-backs-ruby') && after.backBg !== 'rgb(31, 78, 140)', JSON.stringify(after))

// Every back still shares one recipe after the change.
const shared = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const read = el => { const s = getComputedStyle(el); return s.backgroundImage + '|' + s.backgroundColor + '|' + s.borderRadius }
  const t = document.querySelector('.sp-back')
  const st = document.querySelector('.sp-stock-back')
  return JSON.stringify({ tableau: read(t), stock: read(st), same: read(t) === read(st) })
})()`, returnByValue: true })).result.result.value)
check('tableau and stock backs stay identical under the new colour', shared.same, JSON.stringify(shared))

console.log(failures === 0 ? '\nPASS: settings change the table and the card backs' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
