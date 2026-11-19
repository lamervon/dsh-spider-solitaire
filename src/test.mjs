/**
 * Headless checks for the board's rules, storage and copy.
 *
 * `client.js` registers itself through the browser module loader, so this
 * harness supplies that loader, captures the factory, and drives the pure
 * functions the factory closes over by handing the factory a fake React plus
 * the plugin context `apply` expects. It checks the deal, every rule the board
 * enforces, scoring, the stock, win detection, serialization round-trips and
 * dictionary parity — the parts that a click cannot prove wrong.
 *
 * `node src/test.mjs` runs it; a failure throws with the case that failed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
/** The package name, read from the manifest so a rename never strands the check. */
const PACKAGE_NAME = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

let factory = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory: create }) {
      assert.equal(id, PACKAGE_NAME, 'the browser module registers under the package name')
      factory = create
    },
  },
}

/** A React stand-in: the factory only calls createElement and hook functions. */
function fakeReact() {
  const noop = () => undefined
  return {
    createElement: () => null,
    Fragment: 'Fragment',
    useState: () => [undefined, noop],
    useRef: () => ({ current: null }),
    useEffect: noop,
    useCallback: fn => fn,
  }
}

const module = { exports: {} }
const requireStub = name => {
  if (name === 'react') return fakeReact()
  throw new Error(`unexpected require(${name})`)
}

// The factory body ends by returning the plugin; capture what it closes over by
// evaluating a trimmed copy that also exposes the internals under test.
const source = readFileSync(join(root, 'client.js'), 'utf8')
const marked = source.replace(
  'return {\n      // Only injected services',
  'globalThis.__spiderInternals = { newGame, moveRun, dealStock, suggest, autoMoveTarget, isGameState, withResult, emptyStats, elapsedSeconds, isRunStart, fits, movableStart, SUITS, DICTS, loadStats, formatClock, RUNS_TO_WIN, START_SCORE, RUN_LENGTH }\n    return {\n      // Only injected services',
)
assert.notEqual(marked, source, 'the internals marker is missing from client.js')
new Function('window', 'require', marked)(globalThis.window, requireStub)
factory(requireStub)

const api = globalThis.__spiderInternals
assert.ok(api !== undefined, 'the factory did not expose its internals')

// ---- deal ----------------------------------------------------------------

for (const difficulty of ['one-suit', 'two-suits', 'four-suits']) {
  const game = api.newGame(difficulty, 12345)
  assert.equal(game.columns.length, 10, `${difficulty}: ten columns`)
  assert.equal(game.stock.length, 5, `${difficulty}: five stock rounds`)
  for (const [index, column] of game.columns.entries()) {
    // Standard Spider deals 54 cards: six per column for the first four, five
    // for the rest, so the 50 undealt cards form five complete stock rounds.
    const expected = index < 4 ? 6 : 5
    assert.equal(column.cards.length, expected, `${difficulty}: column ${index} holds ${expected} cards`)
    assert.equal(column.cards.filter(card => card.faceUp).length, 1, `${difficulty}: one face-up card per column`)
    assert.equal(column.cards[expected - 1].faceUp, true, `${difficulty}: the last dealt card is face up`)
  }
  const dealt = game.columns.reduce((total, column) => total + column.cards.length, 0)
  assert.equal(dealt, 54, `${difficulty}: 54 cards reach the tableau`)
  for (const [index, round] of game.stock.entries()) {
    assert.equal(round.length, 10, `${difficulty}: stock round ${index} deals ten cards`)
    assert.ok(round.every(card => card !== undefined && typeof card.rank === 'number'), `${difficulty}: stock round ${index} holds real cards`)
  }
  const cards = [...game.columns.flatMap(column => column.cards), ...game.stock.flat()]
  assert.equal(cards.length, 104, `${difficulty}: all 104 cards are dealt`)
  assert.equal(new Set(cards.map(card => card.id)).size, 104, `${difficulty}: card ids are unique`)
  assert.equal(new Set(cards.map(card => card.suit)).size, api.SUITS[difficulty], `${difficulty}: the suit count matches`)
  assert.equal(game.score, api.START_SCORE, `${difficulty}: opening score`)
  assert.equal(game.startedAt, null, `${difficulty}: the clock waits for the first move`)
}

// The same seed replays the same deal; different seeds differ.
assert.deepEqual(api.newGame('four-suits', 7), api.newGame('four-suits', 7), 'a seed replays its deal')
assert.notDeepEqual(api.newGame('four-suits', 7), api.newGame('four-suits', 8), 'different seeds deal differently')


/** Build a state from column recipes, so a rule can be exercised in isolation. */
function board(columns, { stock = [], score = 500, completed = 0 } = {}) {
  let id = 0
  return {
    version: 1,
    difficulty: 'four-suits',
    seed: 1,
    columns: columns.map(recipe => ({
      cards: recipe.map(([rank, suit, faceUp = true]) => ({ id: `t${id++}`, rank, suit, faceUp })),
    })),
    stock,
    completed,
    score,
    moves: 0,
    startedAt: null,
    finishedAt: null,
    won: false,
  }
}

// ---- run splitting -------------------------------------------------------

// Grabbing a card takes it together with every card below that continues the
// descent: the run a press lifts is the grabbed card plus its same-suit tail,
// never the card alone.
{
  const state = board([[[9, 0], [8, 0], [7, 0], [6, 0]], []])
  // Grabbing the eight lifts 8-7-6 in one run.
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state, 'the run from the grabbed card moves')
  assert.equal(outcome.state.columns[1].cards.length, 3, 'the grabbed card and its tail move together')
  assert.equal(outcome.state.columns[1].cards[0].rank, 8, 'the run starts at the grabbed card')
  assert.equal(outcome.state.columns[0].cards.length, 1, 'the cards above stay behind')
}

// Grabbing the head still lifts the whole descent.
{
  const state = board([[[9, 0], [8, 0], [7, 0], [6, 0]], []])
  const outcome = api.moveRun(state, 0, 0, 1)
  assert.ok(outcome.state)
  assert.equal(outcome.state.columns[1].cards.length, 4, 'the whole descent moves')
}

// A face-down card in the run blocks it: the grab cannot cross a card that is
// not face up, so the visible tail is the only liftable part.
{
  const state = board([[[9, 0], [8, 0, false], [7, 0, false]], []])
  assert.equal(api.isRunStart(state.columns[0], 1), false, 'the face-down eight cannot be lifted')
  assert.equal(api.moveRun(state, 0, 1, 1).reason, 'unmovable', 'a grab cannot start on a face-down card')
  assert.equal(api.isRunStart(state.columns[0], 0), false, 'the nine cannot be lifted over a face-down eight')
}

// A suit change ends the grab at the change.
{
  const state = board([[[9, 0], [8, 1], [7, 1]], []])
  assert.equal(api.isRunStart(state.columns[0], 0), false, 'the nine heads a broken descent')
  assert.equal(api.isRunStart(state.columns[0], 1), true, 'the eight starts the same-suit tail')
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state)
  assert.equal(outcome.state.columns[1].cards.length, 2, 'the eight and seven lift together')
  assert.equal(outcome.state.columns[0].cards.length, 1, 'the nine stays')
}

// ---- whole-run movement --------------------------------------------------

// The longest run still moves as a unit from its head.
{
  const state = board([[[9, 0], [8, 0], [7, 0]], [[10, 0]]])
  assert.equal(api.movableStart(state.columns[0]), 0, 'the run starts at the nine')
  const outcome = api.moveRun(state, 0, api.movableStart(state.columns[0]), 1)
  assert.ok(outcome.state)
  assert.equal(outcome.state.columns[0].cards.length, 0, 'the whole run left its column')
  assert.equal(outcome.state.columns[1].cards.length, 4, 'the whole run arrived')
}

// A run split by a suit change: the tail is the only movable run there.
{
  const state = board([[[9, 0], [8, 1], [7, 1]], [[9, 1]]])
  assert.equal(api.movableStart(state.columns[0]), 1, 'the movable run starts at the eight')
  const outcome = api.moveRun(state, 0, api.movableStart(state.columns[0]), 1)
  assert.ok(outcome.state)
  assert.equal(outcome.state.columns[0].cards.length, 1, 'the nine stayed behind')
  assert.equal(outcome.state.columns[1].cards.length, 3, 'the eight and seven moved')
}

// ---- suggest outcomes ----------------------------------------------------

// A legal move wins over everything else.
{
  const state = board([[[8, 0]], [[9, 0]], []], { stock: [[{ id: 's', rank: 1, suit: 0 }]] })
  const next = api.suggest(state)
  assert.equal(next.from, 0, 'the move is suggested')
  assert.equal(next.to, 1, 'onto the nine')
}

// With no move and a full board, the suggestion is the stock.
{
  // Two cards that cannot stack, no empty column: the stock is the only step.
  const state = board([[[9, 0]], [[5, 1]]], { stock: [[{ id: 's', rank: 1, suit: 0 }]] })
  assert.deepEqual(api.suggest(state), { deal: true }, 'the stock is the next step')
}

// With no move and no stock, nothing can happen: the game is over.
{
  // Two cards that cannot stack and no stock left.
  const state = board([[[9, 0]], [[5, 1]]], { stock: [] })
  assert.equal(api.suggest(state), null, 'no move and no stock ends the game')
}

// ---- double-click auto placement ----------------------------------------

// A same-suit neighbour wins over an empty column, so the run is extended.
{
  const state = board([[[8, 0], [7, 0]], [[9, 0]], []])
  const target = api.autoMoveTarget(state, 0, 0)
  assert.equal(target, 1, 'the nine of spades accepts the eight')
}

// With no same-suit home, an empty column takes the run.
{
  const state = board([[[8, 0]], [[6, 0]], []])
  assert.equal(api.autoMoveTarget(state, 0, 0), 2, 'the empty column takes the eight')
}

// A different-suit neighbour descending from the head still accepts the run.
{
  const state = board([[[8, 0]], [[9, 1]]])
  assert.equal(api.autoMoveTarget(state, 0, 0), 1, 'the nine of hearts takes the eight')
}

// No column accepts: nothing is suggested, and no column moves.
{
  const state = board([[[8, 0]], [[5, 0]], [[5, 0]]])
  assert.equal(api.autoMoveTarget(state, 0, 0), null, 'no column accepts the eight')
}

// A double click lifts the whole run, and the destination must still obey the
// descending rule.
{
  const state = board([[[9, 0], [8, 0], [7, 0]], [[8, 0], [7, 0]]])
  const start = api.movableStart(state.columns[0])
  const target = api.autoMoveTarget(state, 0, start)
  // The nine fits only on a ten, and the second column's top is a seven.
  assert.equal(target, null, 'the run has no home on this board')
  const outcome = api.moveRun(state, 0, start, 1)
  assert.equal(outcome.reason, 'fit', 'the rule still refuses a bad destination')
}


// A descending same-suit run moves as a unit.
{
  const state = board([[[5, 0], [4, 0], [3, 0]], [[6, 0]]])
  const outcome = api.moveRun(state, 0, 0, 1)
  assert.ok(outcome.state, 'a same-suit descending run moves')
  assert.equal(outcome.state.columns[1].cards.length, 4)
  assert.equal(outcome.state.columns[0].cards.length, 0)
  assert.equal(outcome.state.score, 501, 'a move scores one point')
  assert.equal(outcome.state.moves, 1)
  assert.ok(outcome.state.startedAt !== null, 'the first move starts the clock')
}

// A mixed-suit stack may not move as a unit, but its same-suit tail may.
{
  const state = board([[[5, 0], [4, 1], [3, 1]], [[5, 1]]])
  assert.equal(api.moveRun(state, 0, 0, 1).reason, 'unmovable', 'a mixed-suit stack is not one run')
  const tail = api.moveRun(state, 0, 1, 1)
  assert.ok(tail.state, 'the same-suit tail moves')
  assert.equal(tail.state.columns[0].cards[0].rank, 5, 'the lifted card stayed behind')
}

// Only one rank below the destination's top fits.
{
  const state = board([[[3, 0]], [[6, 0]], [[4, 0]]])
  assert.equal(api.moveRun(state, 0, 0, 1).reason, 'fit', 'rank must be one below')
  assert.ok(api.moveRun(state, 0, 0, 2).state, 'one rank below fits')
}

// Any card lands on an empty column; a face-down card never moves.
{
  const state = board([[[9, 0]], [], [[5, 0, false]]])
  assert.ok(api.moveRun(state, 0, 0, 1).state, 'any card lands on an empty column')
  assert.equal(api.moveRun(state, 2, 0, 1).reason, 'unmovable', 'a face-down card is not movable')
}

// Moving the last card of a column reveals the card beneath it.
{
  const state = board([[[2, 0, false], [3, 0]], []])
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state)
  assert.equal(outcome.state.columns[0].cards.length, 1)
  assert.equal(outcome.state.columns[0].cards[0].faceUp, true, 'the revealed card turns face up')
}

// A transition leaves its input untouched, so undo can restore it exactly.
{
  const state = board([[[2, 0, false], [3, 0]], []])
  const frozen = JSON.stringify(state)
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state)
  assert.equal(JSON.stringify(state), frozen, 'the previous board is not mutated in place')
  assert.equal(state.columns[0].cards[0].faceUp, false, 'the card beneath is still face down in the history')
}

// A clear likewise leaves the board that produced it untouched.
{
  const run = Array.from({ length: 13 }, (_, offset) => [13 - offset, 2])
  const state = board([[[7, 0, false], ...run], []])
  const frozen = JSON.stringify(state)
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state)
  assert.equal(outcome.cleared, 1)
  assert.equal(JSON.stringify(state), frozen, 'clearing does not edit the saved board')
}

// A full king-to-ace run clears, scores, and reveals what sat beneath it.
{
  const run = Array.from({ length: 13 }, (_, offset) => [13 - offset, 2])
  const state = board([[[7, 0, false], ...run], [], ...Array.from({ length: 8 }, () => [])])
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state)
  assert.equal(outcome.cleared, 1, 'the run clears')
  assert.equal(outcome.state.completed, 1)
  assert.ok(outcome.state.score >= 500 + 100, 'clearing scores 100')
  assert.equal(outcome.state.columns[0].cards.length, 1, 'the card beneath stays')
  assert.equal(outcome.state.columns[0].cards[0].faceUp, true, 'and turns face up')
}

// A mixed-suit stair does NOT clear, and only its same-suit tail may move.
{
  // King to three alternate suits, then two same-suit cards (two and ace of
  // hearts) ending the column: that pair is the only movable run.
  const stair = Array.from({ length: 11 }, (_, offset) => [13 - offset, offset % 2])
  const state = board([[[8, 0], ...stair, [2, 1], [1, 1]], []])
  assert.equal(api.moveRun(state, 0, 1, 1).reason, 'unmovable', 'an alternating-suit stair is not one run')
  const tail = api.moveRun(state, 0, 12, 1)
  assert.ok(tail.state, 'the two-of-hearts and ace-of-hearts pair moves')
  assert.equal(tail.state.columns[0].cards.length, 12, 'only the pair left its column')
  assert.equal(tail.cleared, 0, 'a partial tail never clears')
}

// ---- stock ---------------------------------------------------------------

{
  const game = api.newGame('one-suit', 3)
  const outcome = api.dealStock(game)
  assert.ok(outcome.state, 'stock deals while every column is occupied')
  assert.equal(outcome.state.stock.length, 4, 'one round leaves the stock')
  assert.equal(outcome.state.columns[3].cards.length, 7, 'every column gains a card')
  assert.equal(outcome.state.columns[3].cards[6].faceUp, true, 'a dealt card arrives face up')
  assert.equal(outcome.state.moves, 1)
}

{
  const game = api.newGame('one-suit', 3)
  game.columns[4].cards.length = 0
  assert.equal(api.dealStock(game).reason, 'column', 'an empty column blocks the deal')
}

{
  const state = board([[[1, 0]], [[1, 0]]], { stock: [] })
  assert.equal(api.dealStock(state).reason, 'stock', 'an empty stock refuses the deal')
}

// ---- win detection --------------------------------------------------------

{
  // A column holding one face-down card, then a complete king-to-ace run whose
  // last move lifts the run off that curtain: the clear reveals the card, and
  // the eighth clear ends the game.
  const game = api.newGame('one-suit', 11)
  const stair = Array.from({ length: 13 }, (_, offset) => [13 - offset, 0])
  const state = { ...game, completed: 7, columns: game.columns.map(() => ({ cards: [] })) }
  state.columns[0].cards = [
    { id: 'curtain', rank: 7, suit: 0, faceUp: false },
    ...stair.map(([rank, suit], index) => ({ id: `w${index}`, rank, suit, faceUp: true })),
  ]
  // Lift the whole stair onto an empty column; that empties its own column and
  // reveals the curtain, and the run now sits complete on the destination.
  const outcome = api.moveRun(state, 0, 1, 1)
  assert.ok(outcome.state, 'the stair lands on an empty column')
  assert.equal(outcome.state.completed, 8, 'the eighth run completes')
  assert.equal(outcome.state.won, true, 'eight runs win the game')
  assert.ok(outcome.state.finishedAt !== null, 'the win stamps the end time')
}

// ---- serialization -------------------------------------------------------

{
  const game = api.newGame('two-suits', 42)
  assert.equal(api.isGameState(game), true, 'a fresh game is a valid saved state')
  assert.equal(api.isGameState(JSON.parse(JSON.stringify(game))), true, 'it survives a JSON round-trip')
  assert.equal(api.isGameState(null), false)
  assert.equal(api.isGameState({}), false)
  assert.equal(api.isGameState({ ...game, columns: game.columns.slice(0, 9) }), false, 'column count is checked')
  assert.equal(api.isGameState({ ...game, difficulty: 'six-suits' }), false, 'the difficulty is checked')
  const broken = JSON.parse(JSON.stringify(game))
  broken.columns[0].cards[0].rank = 14
  assert.equal(api.isGameState(broken), false, 'an out-of-range rank is rejected')
  const noFlag = JSON.parse(JSON.stringify(game))
  delete noFlag.columns[0].cards[0].faceUp
  assert.equal(api.isGameState(noFlag), false, 'a card without its face flag is rejected')
}

// ---- statistics ----------------------------------------------------------

{
  let stats = api.emptyStats()
  stats = api.withResult(stats, 'one-suit', { won: false, score: 420, seconds: 100, moves: 30 })
  assert.equal(stats['one-suit'].played, 1)
  assert.equal(stats['one-suit'].won, 0)
  assert.equal(stats['one-suit'].bestScore, 420, 'a loss still counts toward the best score')
  assert.equal(stats['one-suit'].bestSeconds, null, 'a loss sets no best time')
  stats = api.withResult(stats, 'one-suit', { won: true, score: 610, seconds: 200, moves: 50 })
  stats = api.withResult(stats, 'one-suit', { won: true, score: 520, seconds: 150, moves: 70 })
  assert.equal(stats['one-suit'].played, 3)
  assert.equal(stats['one-suit'].won, 2)
  assert.equal(stats['one-suit'].bestScore, 610, 'the highest score wins')
  assert.equal(stats['one-suit'].bestSeconds, 150, 'the shortest time wins')
  assert.equal(stats['one-suit'].bestMoves, 50, 'the fewest moves win')
  assert.equal(stats['two-suits'].played, 0, 'other difficulties stay untouched')
}

// ---- copy ----------------------------------------------------------------

{
  const en = api.DICTS.en
  const zh = api.DICTS.zh
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'both dictionaries carry one key set')
  assert.ok(en['title'] && zh['title'], 'the title exists in both languages')
  assert.ok(api.formatClock(0) === '0:00' && api.formatClock(65) === '1:05', 'the clock formats m:ss')
}

console.log('spider: all headless checks passed')
