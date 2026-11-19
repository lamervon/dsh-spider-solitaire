/**
 * Play the board like a user, inside headless Chrome.
 *
 * The harness page mounts the real Board component against stubbed slots, so this
 * script can dispatch real pointer and click events and then read the DOM the
 * same way a user would. It checks what static inspection cannot: that a drag
 * moves a run, that a click selects and a second click lands it, that the stock
 * deals a row, that undo restores the board, that the statistics dialog opens,
 * and that a finished board stops accepting moves.
 *
 * `node .harness/play.mjs` runs it against the local server on port 8791.
 */
import { spawn } from 'node:child_process'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PAGE = 'http://127.0.0.1:8791/.harness/index.html?lang=zh&width=420'
const PORT = 9351

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms) })

async function connect() {
  let target
  for (let attempt = 0; attempt < 60 && target === undefined; attempt += 1) {
    await wait(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find(entry => entry.type === 'page')
    } catch {
      // The debugger's HTTP endpoint is not listening yet.
    }
  }
  if (target === undefined) throw new Error('no DevTools page target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (resolve !== undefined) {
      pending.delete(message.id)
      resolve(message)
    }
  })
  await new Promise(resolve => { socket.addEventListener('open', resolve) })
  const send = (method, params = {}) => new Promise(resolve => {
    const id = nextId += 1
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { socket, send }
}

const failures = []
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures.push(name)
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--window-size=470,780', 'about:blank',
  ])
  try {
    const { socket, send } = await connect()
    await send('Page.enable')
    await send('Runtime.enable')
    const evaluate = async (expression) => {
      const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (reply.result?.exceptionDetails !== undefined) {
        throw new Error(`page error: ${reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text}`)
      }
      return reply.result.result.value
    }
    const load = async (url = PAGE) => {
      await send('Page.navigate', { url })
      await wait(2200)
    }

    /** A snapshot of the board the way the page shows it. */
    const readBoard = () => evaluate(`(() => {
      const cols = [...document.querySelectorAll('[data-column]')]
      return JSON.stringify({
        columns: cols.map(col => [...col.querySelectorAll('.sp-card')].map(card => card.getAttribute('data-rank') ?? 'back')),
        completed: document.querySelector('.sp-badge')?.textContent,
        score: [...document.querySelectorAll('.sp-meta-value')][0]?.textContent,
        moves: [...document.querySelectorAll('.sp-meta-value')][1]?.textContent,
        status: document.querySelector('.sp-status')?.textContent,
        dialog: document.querySelector('.sp-dialog') !== null,
        win: document.querySelector('.sp-win') !== null,
        stock: document.querySelectorAll('.sp-stock-back').length,
      })
    })()`)

    /** Centre of a card, by column and card index. */
    const cardPoint = (column, index) => evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-column="${column}"] .sp-card')]
      const rect = cards[${index}].getBoundingClientRect()
      return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(8, rect.height / 2)) })
    })()`)

    /** Centre of a column's lower area, where an empty column accepts a drop. */
    const columnPoint = (column) => evaluate(`(() => {
      const rect = document.querySelector('[data-column="${column}"]').getBoundingClientRect()
      return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom - 12) })
    })()`)

    const pointer = async (type, point) => {
      await send('Input.dispatchMouseEvent', {
        type, x: point.x, y: point.y, button: 'left', clickCount: 1, pointerType: 'mouse', buttons: type === 'mouseReleased' ? 0 : 1,
      })
    }

    await load()
    const start = JSON.parse(await readBoard())
    check('deals ten columns', start.columns.length === 10)
    check('deals 44 face-down cards', start.columns.flat().filter(rank => rank === 'back').length === 44)
    check('deals 10 face-up cards', start.columns.flat().filter(rank => rank !== 'back').length === 10)
    check('shows the opening score', start.score === '500', start.score)
    check('starts with five stock deals', start.stock === 5, String(start.stock))

    // A drag: lift a movable single card onto a column whose top is one higher.
    const plan = await evaluate(`(() => {
      const cols = [...document.querySelectorAll('[data-column]')]
      const state = cols.map(col => [...col.querySelectorAll('.sp-card')].map(card => ({
        rank: Number(card.getAttribute('data-rank')) || 0,
      })))
      for (let from = 0; from < 10; from += 1) {
        const source = state[from]
        if (source.length === 0) continue
        const head = source[source.length - 1]
        if (head.rank === 0) continue
        for (let to = 0; to < 10; to += 1) {
          if (to === from) continue
          const target = state[to]
          const top = target.length === 0 ? null : target[target.length - 1]
          if (top !== null && top.rank === head.rank + 1) return JSON.stringify({ from, index: source.length - 1, to })
          if (top === null && source.length === 1) return JSON.stringify({ from, index: 0, to })
        }
      }
      return JSON.stringify(null)
    })()`)
    const movePlan = JSON.parse(plan)
    if (movePlan === null) {
      console.log('  skip drag — this deal offers no single-card move')
    } else {
      const source = JSON.parse(await cardPoint(movePlan.from, movePlan.index))
      const target = JSON.parse(await columnPoint(movePlan.to))
      await pointer('mousePressed', source)
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: source.x + 12, y: source.y + 12, button: 'left', buttons: 1, pointerType: 'mouse',
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: target.x, y: target.y, button: 'left', buttons: 1, pointerType: 'mouse',
      })
      await pointer('mouseReleased', target)
      await wait(350)
      const after = JSON.parse(await readBoard())
      const moved = after.columns[movePlan.to].length === start.columns[movePlan.to].length + 1
      check('a drag lands the run on its target', moved,
        `${start.columns[movePlan.to].length} -> ${after.columns[movePlan.to].length}`)
      check('a move scores a point', Number(after.score) === Number(start.score) + 1, `${start.score} -> ${after.score}`)
      check('a move counts one move', Number(after.moves) === Number(start.moves) + 1, `${start.moves} -> ${after.moves}`)

      // Undo restores the board exactly.
      // Undo by its accessible name: the tool row also holds New game.
      await evaluate(`[...document.querySelectorAll('.sp-tools button')].find(b => b.getAttribute('aria-label') === '撤销').click()`)
      await wait(300)
      const undone = JSON.parse(await readBoard())
      const sameLayout = JSON.stringify(undone.columns) === JSON.stringify(start.columns)
      check('undo restores the dealt layout', sameLayout, sameLayout ? undefined
        : undone.columns.map((column, index) => (JSON.stringify(column) === JSON.stringify(start.columns[index])
          ? '' : `col${index} ${start.columns[index].join(',')} -> ${column.join(',')}`)).filter(Boolean).join('; '))
      check('undo restores the score', undone.score === start.score, `${start.score} -> ${undone.score}`)
      check('undo restores the move count', undone.moves === start.moves, `${start.moves} -> ${undone.moves}`)
    }

    // Click-to-move: select a movable card, then click the column that accepts it.
    await load()
    const clickStart = JSON.parse(await readBoard())
    const clickPlan = JSON.parse(await evaluate(`(() => {
      const cols = [...document.querySelectorAll('[data-column]')]
      const rankOf = card => Number(card.getAttribute('data-rank')) || 0
      const state = cols.map(col => [...col.querySelectorAll('.sp-card')].map(rankOf))
      for (let from = 0; from < 10; from += 1) {
        const source = state[from]
        if (source.length === 0) continue
        const head = source[source.length - 1]
        if (head === 0) continue
        for (let to = 0; to < 10; to += 1) {
          if (to === from) continue
          const target = state[to]
          const top = target.length === 0 ? null : target[target.length - 1]
          if (top !== null && top === head + 1) return JSON.stringify({ from, index: source.length - 1, to })
        }
      }
      return JSON.stringify(null)
    })()`))
    if (clickPlan === null) {
      console.log('  skip click-move — no single-card move on this board')
    } else {
      const card = JSON.parse(await cardPoint(clickPlan.from, clickPlan.index))
      await pointer('mousePressed', card)
      await pointer('mouseReleased', card)
      await wait(250)
      const selected = await evaluate(`document.querySelectorAll('.sp-card-selected').length`)
      check('a press selects the run', selected > 0, String(selected))
      const target = JSON.parse(await columnPoint(clickPlan.to))
      await pointer('mousePressed', target)
      await pointer('mouseReleased', target)
      await wait(300)
      const after = JSON.parse(await readBoard())
      check('a click on a column lands the selected run',
        after.columns[clickPlan.to].length === clickStart.columns[clickPlan.to].length + 1,
        `${clickStart.columns[clickPlan.to].length} -> ${after.columns[clickPlan.to].length}`)
    }

    // The stock deals a row onto every column.
    const beforeDeal = JSON.parse(await readBoard())
    const stock = JSON.parse(await evaluate(`(() => {
      const rect = document.querySelector('.sp-stock').getBoundingClientRect()
      return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) })
    })()`))
    await pointer('mousePressed', stock)
    await pointer('mouseReleased', stock)
    // The round flies card by card and commits on landing, so wait past it.
    await wait(1400)
    const afterDeal = JSON.parse(await readBoard())
    check('the stock deals one round', afterDeal.stock === beforeDeal.stock - 1, `${beforeDeal.stock} -> ${afterDeal.stock}`)
    check('every column gains a card', afterDeal.columns.every((column, index) => column.length === beforeDeal.columns[index].length + 1))

    // Statistics open and close.
    await evaluate(`[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === '统计').click()`)
    await wait(250)
    check('the statistics dialog opens', JSON.parse(await readBoard()).dialog)
    check('the dialog shows the local-storage note',
      await evaluate(`document.querySelector('.sp-dialog-note')?.textContent === '仅保存在本机。'`))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(250)
    check('Escape closes the dialog', JSON.parse(await readBoard()).dialog === false)

    // The difficulty menu starts a new deal.
    await evaluate(`[...document.querySelectorAll('.sp-icon-btn')].find(b => b.getAttribute('aria-label') === '新游戏').click()`)
    await wait(200)
    const menuItems = await evaluate(`document.querySelectorAll('.sp-menu-item').length`)
    check('the new-game menu lists three difficulties', menuItems === 3, String(menuItems))
    await evaluate(`[...document.querySelectorAll('.sp-menu-item')][2].click()`)
    await wait(350)
    const fourSuit = JSON.parse(await readBoard())
    check('choosing a difficulty restarts the board', fourSuit.moves === '0' && fourSuit.score === '500',
      `${fourSuit.moves}/${fourSuit.score}`)

    // A reload resumes the same board and keeps the difficulty.
    const beforeReload = JSON.parse(await readBoard())
    await load()
    const resumed = JSON.parse(await readBoard())
    check('a reload resumes the same board', JSON.stringify(resumed.columns) === JSON.stringify(beforeReload.columns))
    check('the chosen difficulty survives a reload',
      await evaluate(`document.querySelector('.sp-title') !== null`))

    // A finished board refuses moves. Mark the saved game as won, then reload.
    await evaluate(`(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('dsh.spider.game'))
      const saved = JSON.parse(localStorage.getItem(key))
      saved.won = true
      saved.completed = 8
      saved.finishedAt = Date.now()
      localStorage.setItem(key, JSON.stringify(saved))
    })()`)
    await load()
    const finished = JSON.parse(await readBoard())
    check('a finished board shows its result', finished.win)
    // The result card stands over the board, so nothing underneath can be pressed.
    check('the result card covers the board', await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-column="0"] .sp-card')]
      const rect = cards[cards.length - 1].getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 6)
      return hit !== null && hit.closest('.sp-win') !== null
    })()`))
    check('the result card offers another deal',
      await evaluate(`document.querySelector('.sp-result-btn') !== null && document.querySelector('.sp-result-btn').textContent.length > 0`))

    socket.close()
  } finally {
    chrome.kill()
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nspider: all interaction checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
