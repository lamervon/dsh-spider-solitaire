import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9811', '--window-size=1000,1100', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9811/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1050, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=940' })
await wait(2400)

let failures = 0
const check = (n, c, d) => { if (c) console.log('  ok   ' + n); else { failures++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')) } }
const read = async () => JSON.parse((await send('Runtime.evaluate', { expression: `(() => JSON.stringify({
  title: document.querySelector('.sp-title')?.textContent,
  newBtn: document.querySelector('.sp-new')?.getAttribute('aria-label'),
  tools: [...document.querySelectorAll('.sp-tool')].map(b => b.getAttribute('aria-label')).join('|'),
  meta: [...document.querySelectorAll('.sp-meta-label')].map(e => e.textContent).join('|'),
  runLabel: document.querySelector('.sp-run-label')?.textContent,
  stockLabel: document.querySelector('.sp-stock')?.getAttribute('aria-label'),
}))()`, returnByValue: true })).result.result.value)
const setLang = async (l) => { await send('Runtime.evaluate', { expression: `window.setLang('${l}')` }); await wait(350) }

// Open the new-game menu so its rows are part of the switch too.
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === '新游戏').click()` })
await wait(300)
let zhState = await read()
const zhMenu = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.sp-menu-item')].map(e => e.textContent))`, returnByValue: true })).result.result.value)
console.log('zh:', JSON.stringify(zhState), 'menu:', JSON.stringify(zhMenu))

await setLang('en')
let enState = await read()
const enMenu = JSON.parse((await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('.sp-menu-item')].map(e => e.textContent))`, returnByValue: true })).result.result.value)
console.log('en:', JSON.stringify(enState), 'menu:', JSON.stringify(enMenu))

check('the title follows the switch', zhState.title === '蜘蛛纸牌' && enState.title === 'Spider Solitaire', `${zhState.title} -> ${enState.title}`)
check('the toolbar labels follow', enState.tools.startsWith('Undo|Redo|Hint|'), enState.tools)
check('the new-game button follows', enState.newBtn === 'New game', enState.newBtn)
check('the meta labels follow', enState.meta === 'Score|Moves|Time', enState.meta)
check('the stock label follows', /deals left/.test(enState.stockLabel ?? ''), enState.stockLabel)
check('the open difficulty menu follows', enMenu.join('|').includes('suit'), JSON.stringify(enMenu))

await setLang('zh')
const backState = await read()
check('switching back restores Chinese', backState.title === '蜘蛛纸牌' && backState.meta === '得分|步数|用时', JSON.stringify(backState))

// A dialog opened after the switch uses the new language.
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === '新游戏').click()` })
await wait(200)
await setLang('en')
await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === 'Settings').click()` })
await wait(400)
const dlg = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
  const d = document.querySelector('.sp-dialog')
  return JSON.stringify({ label: d?.getAttribute('aria-label'), titles: [...document.querySelectorAll('.sp-set-title')].map(e => e.textContent), note: document.querySelector('.sp-dialog-note')?.textContent })
})()`, returnByValue: true })).result.result.value)
console.log('dialog:', JSON.stringify(dlg))
check('the settings dialog follows', dlg.label === 'Settings' && dlg.titles.includes('Table') && dlg.titles.includes('Card back'), JSON.stringify(dlg))

console.log(failures === 0 ? '\nPASS: copy switches language live' : `\nFAIL: ${failures}`)
ws.close(); child.kill()
