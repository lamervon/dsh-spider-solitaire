import { spawn } from 'node:child_process'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9356', '--window-size=470,780', 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) { await wait(250); try { target = (await (await fetch('http://127.0.0.1:9356/json/list')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (m, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method: m, params })) })
await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=420' })
await wait(2000)
// Accessibility inventory: every interactive control needs an accessible name.
const r = await send('Runtime.evaluate', { expression: `(() => {
  const controls = [...document.querySelectorAll('.sp-root button, .sp-root [role="button"]')]
  const unnamed = controls.filter(n => !(n.getAttribute('aria-label') || n.textContent.trim())).map(n => n.className)
  const toolTitles = [...document.querySelectorAll('.sp-tool')].map(n => n.getAttribute('aria-label'))
  const small = controls.filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) })
    .map(n => n.className + ':' + Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height))
  // Token purity: colors used by the chrome must come from tokens.
  const styles = [...document.querySelectorAll('.sp-head, .sp-foot, .sp-tool, .sp-icon-btn, .sp-dialog')]
    .map(n => { const c = getComputedStyle(n); return c.backgroundColor + '|' + c.color })
  return JSON.stringify({ controls: controls.length, unnamed, toolTitles, small: small.slice(0, 8), styles: [...new Set(styles)] })
})()`, returnByValue: true })
console.log(r.result?.result?.value)
ws.close(); child.kill()
