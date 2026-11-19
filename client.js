/**
 * Spider Solitaire for the right Sidebar.
 *
 * A page tab type (kind `spider`): the board, the stock, the toolbar and the
 * statistics all live in the tab body. The rules, scoring and persistence sit in
 * this file beside the view because the browser half loads as one module from
 * the profile; the view owns only React, pointer gestures, the stylesheet and
 * copy.
 *
 * Cards keep fixed playing-card inks because a card face is artwork, while the
 * surface around them uses `--dsw-alias-*` tokens so the board reads correctly
 * beside the host's own panels in the light and dark themes. Dragging rides
 * Pointer Events, so mouse, pen and touch share one path; a press that does not
 * travel selects a movable run, and a press on another column moves it there.
 */
window.__ModuleLoader__.load({
  id: '@lamervon/dsh-spider-solitaire',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const KIND = 'spider'
    const TAB_ID = '@lamervon/dsh-spider-solitaire'
    const NS = 'spiderSolitaire'

    // ---- rules -----------------------------------------------------------

    /** Cards a full stock round deals, one per column. */
    const STOCK_ROUND = 10
    /** Stock rounds in a game. */
    const STOCK_DEALS = 5
    /** Cards in one completed run. */
    const RUN_LENGTH = 13
    /** Runs that win the game. */
    const RUNS_TO_WIN = 8
    /** Score per card moved between columns. */
    const SCORE_PER_MOVE = 1
    /** Score per completed run. */
    const SCORE_PER_RUN = 100
    /** The opening score every Spider implementation starts from. */
    const START_SCORE = 500
    /** One deal's flight: rise, cross, land. */
    const DEAL_FLIGHT_MS = 620
    /** Each card starts this much later than the one before it. */
    const DEAL_STAGGER_MS = 34

    /** Difficulty keys to their suit counts. */
    const SUITS = { 'one-suit': 1, 'two-suits': 2, 'four-suits': 4 }
    /** The difficulty keys in menu order. */
    const DIFFICULTY_KEYS = ['one-suit', 'two-suits', 'four-suits']

    /** Suit index to its glyph, in the Windows Spider order. */
    const SUIT_GLYPHS = ['\u2660', '\u2665', '\u2666', '\u2663']
    /** Which suits print in red. */
    const SUIT_RED = [false, true, true, false]
    /** Rank to its face text. */
    const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

    /** Seeded xorshift32, so a deal replays from its seed. */
    function createRandom(seed) {
      let state = seed >>> 0
      if (state === 0) state = 0x9e3779b9
      return () => {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        return state / 0x100000000
      }
    }

    /** Fisher-Yates with the seeded generator. */
    function shuffle(items, random) {
      const out = items.slice()
      for (let index = out.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1))
        const held = out[index]
        out[index] = out[swap]
        out[swap] = held
      }
      return out
    }

    /** The 104-card pack for a suit count: each suit repeated to eight packs. */
    function buildDeck(suitCount) {
      const deck = []
      for (let suit = 0; suit < suitCount; suit += 1) {
        for (let copy = 0; copy < 8 / suitCount; copy += 1) {
          for (let rank = 1; rank <= 13; rank += 1) deck.push({ id: `c${deck.length}`, rank, suit })
        }
      }
      return deck
    }

    /** Deal a new game at a difficulty and seed. */
    function newGame(difficulty, seed) {
      const suits = SUITS[difficulty]
      if (suits === undefined) throw new Error(`unknown difficulty "${difficulty}"`)
      const deck = shuffle(buildDeck(suits), createRandom(seed))
      const columns = Array.from({ length: 10 }, () => ({ cards: [] }))
      let next = 0
      // Standard Spider deals 54 cards: the first four columns hold six, the
      // remaining six hold five, and every column turns its last card face up.
      // The 50 undealt cards are the five stock rounds of ten; dealing 60 here
      // would leave the stock short and the fifth round with four cards.
      for (let column = 0; column < 10; column += 1) {
        const count = column < 4 ? 6 : 5
        for (let index = 0; index < count; index += 1) {
          columns[column].cards.push({ ...deck[next], faceUp: index === count - 1 })
          next += 1
        }
      }
      const stock = []
      for (let round = 0; round < STOCK_DEALS; round += 1) {
        stock.push(deck.slice(next, next + 10).map(card => ({ ...card, faceUp: false })))
        next += 10
      }
      return {
        version: 1,
        difficulty,
        seed,
        columns,
        stock,
        completed: 0,
        score: START_SCORE,
        moves: 0,
        startedAt: null,
        finishedAt: null,
        won: false,
      }
    }

    /**
     * Index of the topmost card that starts a movable run in a column, or -1.
     *
     * A movable run is any suffix of the column that descends by one in a
     * single suit. That makes every card from this index to the end a legal
     * run start, so a player may lift a tail of a longer descent rather than
     * all of it; this index is the longest such run, used where the whole
     * descent is the natural unit (hints and the opening move).
     */
    function movableStart(column) {
      const cards = column.cards
      let index = cards.length - 1
      if (index < 0 || !cards[index].faceUp) return -1
      const suit = cards[index].suit
      while (index > 0) {
        const below = cards[index - 1]
        if (!below.faceUp || below.suit !== suit || below.rank !== cards[index].rank + 1) break
        index -= 1
      }
      return index
    }

    /** Whether the run starting at `index` may be lifted from its column. */
    function isRunStart(column, index) {
      const start = movableStart(column)
      return start !== -1 && index >= start
    }

    /** Whether a card of `rank` may land on a column. */
    function fits(rank, column) {
      const cards = column.cards
      if (cards.length === 0) return true
      const top = cards[cards.length - 1]
      return top.faceUp && top.rank === rank + 1
    }

    /**
     * Reveal a column's new end card and clear a full king-to-ace run.
     *
     * Every card it touches is replaced, never edited: a saved state shares its
     * card objects with the state that produced it, so an in-place `faceUp`
     * write would turn a revealed card face up in the history too, and undo
     * could not put it back.
     * @param column - the column to settle, mutated through its `cards` array.
     * @returns how many runs cleared (zero or one).
     */
    function settleColumn(column) {
      const cards = column.cards
      const end = cards.length - 1
      if (end >= 0 && !cards[end].faceUp) cards[end] = { ...cards[end], faceUp: true }
      if (cards.length < RUN_LENGTH) return 0
      const start = cards.length - RUN_LENGTH
      const first = cards[start]
      if (first.rank !== 13) return 0
      for (let offset = 0; offset < RUN_LENGTH; offset += 1) {
        const card = cards[start + offset]
        if (card.suit !== first.suit || card.rank !== 13 - offset) return 0
      }
      cards.length = start
      if (start > 0) cards[start - 1] = { ...cards[start - 1], faceUp: true }
      return 1
    }

    /** Fold a transition's effects into the next state. */
    function afterMove(state, columns, cleared, moves, scoreGain) {
      const next = {
        ...state,
        columns,
        completed: state.completed + cleared,
        score: state.score + scoreGain,
        moves: state.moves + moves,
        startedAt: state.startedAt ?? Date.now(),
      }
      next.won = next.completed >= RUNS_TO_WIN
      if (next.won) next.finishedAt = Date.now()
      return next
    }

    /** Move a run, or report the rule that refused it. */
    function moveRun(state, from, index, to) {
      if (from === to) return { reason: 'same' }
      const source = state.columns[from]
      const target = state.columns[to]
      if (source === undefined || target === undefined) return { reason: 'same' }
      if (!isRunStart(source, index)) return { reason: 'unmovable' }
      const run = source.cards.slice(index)
      if (!fits(run[0].rank, target)) return { reason: 'fit' }
      const columns = state.columns.map(column => ({ cards: column.cards.slice() }))
      columns[from].cards.length = index
      columns[to].cards.push(...run)
      const cleared = settleColumn(columns[from]) + settleColumn(columns[to])
      return { state: afterMove(state, columns, cleared, 1, SCORE_PER_MOVE + cleared * SCORE_PER_RUN), cleared }
    }

    /** Deal one stock round, or report why it is refused. */
    function dealStock(state) {
      if (state.stock.length === 0) return { reason: 'stock' }
      if (state.columns.some(column => column.cards.length === 0)) return { reason: 'column' }
      const round = state.stock[state.stock.length - 1]
      // A round must hold one card per column; a short round would deal empty
      // cards onto the last columns, so it is treated as a spent stock.
      if (round === undefined || round.length !== STOCK_ROUND) return { reason: 'stock' }
      const stock = state.stock.slice(0, -1)
      const columns = state.columns.map(column => ({ cards: column.cards.slice() }))
      columns.forEach((column, index) => {
        column.cards.push({ ...round[index], faceUp: true })
      })
      let cleared = 0
      for (const column of columns) cleared += settleColumn(column)
      return {
        state: { ...afterMove(state, columns, cleared, 1, cleared * SCORE_PER_RUN), stock },
        cleared,
      }
    }

    /**
     * One dealt card flying from the stock to its column.
     *
     * The board state is committed before the flight starts, so the card the
     * overlay animates is already in place; the overlay hides it and replays its
     * arrival. Each card carries a `delay` so the round lands one card at a
     * time, left to right, the way a hand deals.
     */
    function FlyingCard({ card, from, to, delay, duration }) {
      const [phase, setPhase] = React.useState('start')
      React.useEffect(() => {
        // The card mounts at the stock. Its move to the column needs the start
        // position painted first: React would otherwise commit both positions in
        // one paint, and the browser would jump instead of transitioning. Two
        // frames guarantee the start pose is on screen before the move begins.
        let timer = 0
        let inner = 0
        const outer = globalThis.requestAnimationFrame(() => {
          inner = globalThis.requestAnimationFrame(() => {
            timer = globalThis.setTimeout(() => { setPhase('flying') }, delay)
          })
        })
        return () => {
          globalThis.cancelAnimationFrame(outer)
          globalThis.cancelAnimationFrame(inner)
          globalThis.clearTimeout(timer)
        }
      }, [delay])
      const target = phase === 'start' ? from : to
      return h('div', {
        className: `sp-fly${phase === 'start' ? '' : ' sp-fly-arrived'}`,
        'aria-hidden': true,
        style: {
          '--sp-fly-w': `${card.width}px`,
          '--sp-fly-h': `${card.height}px`,
          transform: `translate3d(${target.x}px, ${target.y}px, 0) rotate(${target.rotate}deg)`,
          transitionDuration: `${duration}ms`,
        },
      })
    }

    /**
     * The first column that accepts a run, for a double click.
     *
     * Candidates are tried left to right, skipping the run's own column. A
     * column holding a card of the run's suit is preferred over an empty one,
     * because extending a same-suit run exposes another card later; an empty
     * column still qualifies and is chosen when nothing else fits.
     * @param state - the board.
     * @param from - the run's source column.
     * @param index - the run's first card.
     * @returns the destination column index, or null when no column accepts it.
     */
    function autoMoveTarget(state, from, index) {
      const head = state.columns[from].cards[index]
      let empty = null
      for (let to = 0; to < state.columns.length; to += 1) {
        if (to === from) continue
        const target = state.columns[to]
        if (!fits(head.rank, target)) continue
        if (target.cards.length === 0) {
          if (empty === null) empty = to
          continue
        }
        if (target.cards[target.cards.length - 1].suit === head.suit) return to
      }
      if (empty !== null) return empty
      for (let to = 0; to < state.columns.length; to += 1) {
        if (to === from) continue
        if (fits(head.rank, state.columns[to])) return to
      }
      return null
    }

    /**
     * What the player should do next: a move, the stock, or nothing.
     *
     * The three outcomes are what the hint and the end-of-game check both need:
     * - `{ from, index, to }` — the most useful legal move;
     * - `{ deal: true }` — no card can move, but a stock round is available.
     *   The stock refuses to deal onto an empty column, but an empty column
     *   always accepts a column's top card, so this branch is reached only with
     *   every column occupied;
     * - `null` — nothing moves and no stock remains, which ends the game.
     */
    function suggest(state) {
      let best = null
      let bestWeight = -Infinity
      for (let from = 0; from < state.columns.length; from += 1) {
        const source = state.columns[from]
        const start = movableStart(source)
        if (start === -1) continue
        for (let index = start; index < source.cards.length; index += 1) {
          const head = source.cards[index]
          for (let to = 0; to < state.columns.length; to += 1) {
            if (to === from) continue
            const target = state.columns[to]
            if (!fits(head.rank, target)) continue
            const top = target.cards[target.cards.length - 1]
            const exposes = index > 0 && !source.cards[index - 1].faceUp
            const weight = (top !== undefined && top.suit === head.suit ? 400 : 0)
              + (exposes ? 250 : 0)
              + (top === undefined ? -80 : 0)
              + (source.cards.length - index) * 4
              + head.rank
            if (weight > bestWeight) {
              bestWeight = weight
              best = { from, index, to }
            }
          }
        }
      }
      if (best !== null) return best
      if (state.stock.length === 0) return null
      return { deal: true }
    }

    /** Whether a saved value is still a playable board. */
    function isGameState(value) {
      if (value === null || typeof value !== 'object') return false
      if (!Array.isArray(value.columns) || value.columns.length !== 10) return false
      if (!Array.isArray(value.stock)) return false
      if (typeof value.score !== 'number' || typeof value.completed !== 'number') return false
      if (typeof value.difficulty !== 'string' || !(value.difficulty in SUITS)) return false
      if (typeof value.moves !== 'number') return false
      for (const column of value.columns) {
        if (column === null || typeof column !== 'object' || !Array.isArray(column.cards)) return false
        for (const card of column.cards) {
          if (card === null || typeof card !== 'object') return false
          if (typeof card.id !== 'string' || typeof card.faceUp !== 'boolean') return false
          if (!Number.isInteger(card.rank) || card.rank < 1 || card.rank > 13) return false
          if (!Number.isInteger(card.suit) || card.suit < 0 || card.suit > 3) return false
        }
      }
      // Every stock round must deal one real card per column: a saved round of
      // four cards (the shape the early build wrote) would deal `undefined`
      // onto six columns, so it restarts the game instead of loading it.
      for (const round of value.stock) {
        if (!Array.isArray(round) || round.length !== STOCK_ROUND) return false
        for (const card of round) {
          if (card === null || typeof card !== 'object') return false
          if (typeof card.id !== 'string') return false
          if (!Number.isInteger(card.rank) || !Number.isInteger(card.suit)) return false
        }
      }
      return true
    }

    /** Seconds from the first move to the win, or to now. */
    function elapsedSeconds(state, now) {
      if (state.startedAt === null) return 0
      return Math.max(0, Math.floor(((state.finishedAt ?? now) - state.startedAt) / 1000))
    }

    // ---- sound -----------------------------------------------------------

    /**
     * Short synthesized sounds for the board's events.
     *
     * Every cue is built from Web Audio oscillators and a noise buffer at play
     * time, so the bundle ships no audio files and makes no network request. The
     * context is created lazily on the first user gesture, because browsers
     * suspend audio until one; until then a cue is silently dropped.
     */
    function createSound(preference) {
      /** @type {AudioContext | null} */
      let context = null
      let enabled = preference

      /** Decode a short piece of white noise once, for the card rustle. */
      const noise = () => {
        const frames = Math.floor(context.sampleRate * 0.12)
        const buffer = context.createBuffer(1, frames, context.sampleRate)
        const data = buffer.getChannelData(0)
        for (let index = 0; index < frames; index += 1) {
          // A decaying burst reads as paper on a table rather than as a hiss.
          data[index] = (Math.random() * 2 - 1) * (1 - index / frames) ** 3
        }
        return buffer
      }

      /** Create the context on first use; a browser without audio stays silent. */
      const ready = () => {
        if (!enabled) return null
        if (context === null) {
          const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext
          if (Ctor === undefined) return null
          try {
            context = new Ctor()
          } catch {
            // A browser that refuses audio keeps the game silent, not broken.
            return null
          }
        }
        if (context.state === 'suspended') void context.resume()
        return context
      }

      /** One enveloped oscillator tone. */
      const tone = (frequency, { at = 0, duration = 0.09, gain = 0.05, type = 'sine', glide = 0 } = {}) => {
        const audio = ready()
        if (audio === null) return
        const start = audio.currentTime + at
        const osc = audio.createOscillator()
        const amp = audio.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(frequency, start)
        if (glide !== 0) osc.frequency.linearRampToValueAtTime(frequency + glide, start + duration)
        amp.gain.setValueAtTime(0.0001, start)
        amp.gain.exponentialRampToValueAtTime(gain, start + 0.008)
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        osc.connect(amp).connect(audio.destination)
        osc.start(start)
        osc.stop(start + duration + 0.02)
      }

      /** The card-slide rustle: filtered noise with a quick decay. */
      const rustle = ({ at = 0, gain = 0.05, frequency = 2600 } = {}) => {
        const audio = ready()
        if (audio === null) return
        const start = audio.currentTime + at
        const source = audio.createBufferSource()
        source.buffer = noise()
        const filter = audio.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.setValueAtTime(frequency, start)
        filter.Q.setValueAtTime(0.8, start)
        const amp = audio.createGain()
        amp.gain.setValueAtTime(0.0001, start)
        amp.gain.exponentialRampToValueAtTime(gain, start + 0.006)
        amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.11)
        source.connect(filter).connect(amp).connect(audio.destination)
        source.start(start)
        source.stop(start + 0.13)
      }

      return {
        /** Whether the cues are audible. */
        get enabled() {
          return enabled
        },
        /** Turn the cues on or off. */
        set(next) {
          enabled = next
        },
        /** A run lands on a column: a soft slide. */
        move() {
          rustle({ gain: 0.045 })
          tone(320, { duration: 0.06, gain: 0.02, type: 'triangle' })
        },
        /** A run is picked up: the same slide, brighter and quieter. */
        lift() {
          rustle({ gain: 0.028, frequency: 3400 })
        },
        /** A stock round lands on every column. */
        deal() {
          for (let index = 0; index < 5; index += 1) rustle({ at: index * 0.035, gain: 0.03, frequency: 2400 + index * 220 })
        },
        /** A full king-to-ace run clears: an ascending arpeggio. */
        clear() {
          const notes = [523.25, 659.25, 783.99, 1046.5]
          notes.forEach((frequency, index) => tone(frequency, { at: index * 0.07, duration: 0.16, gain: 0.045, type: 'triangle' }))
        },
        /** The eighth run clears: a longer fanfare. */
        win() {
          const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
          notes.forEach((frequency, index) => {
            tone(frequency, { at: index * 0.11, duration: 0.3, gain: 0.05, type: 'triangle' })
            tone(frequency / 2, { at: index * 0.11, duration: 0.3, gain: 0.022, type: 'sine' })
          })
        },
        /** A move the rules refuse: a short falling warning. */
        invalid() {
          tone(220, { duration: 0.1, gain: 0.04, type: 'square', glide: -60 })
        },
        /**
         * One firework bursting: a felt thump under a spray of crackle.
         *
         * The thump is a fast falling sine, which reads as a distant report; the
         * crackle is filtered noise, bright and short. `size` scales both, so a
         * big bloom sounds bigger than a small one.
         */
        burst(size = 1) {
          const loudness = 0.5 + 0.5 * Math.min(1.5, size)
          tone(96 + Math.random() * 30, { duration: 0.26, gain: 0.075 * loudness, type: 'sine', glide: -46 })
          rustle({ at: 0.005, gain: 0.05 * loudness, frequency: 1800 + Math.random() * 1600 })
          rustle({ at: 0.07, gain: 0.022 * loudness, frequency: 3200 + Math.random() * 1200 })
        },
        /** A shell climbing: a thin rising whistle. */
        launch() {
          tone(430 + Math.random() * 90, { duration: 0.34, gain: 0.018, type: 'sine', glide: 520 })
        },
      }
    }

    // ---- storage ---------------------------------------------------------

    const PREFIX = 'dsh.spider.'
    const GAME_KEY = `${PREFIX}game.v1`
    const STATS_KEY = `${PREFIX}stats.v1`
    const DIFFICULTY_KEY = `${PREFIX}difficulty.v1`
    const SOUND_KEY = `${PREFIX}sound.v1`
    /** The felt colour and the card-back pattern choices. */
    const TABLE_KEY = `${PREFIX}table.v1`
    const BACK_KEY = `${PREFIX}back.v1`

    /** Read one storage value, treating a blocked origin as absent. */
    function read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? undefined
      } catch {
        // A blocked origin plays in memory for this visit.
        return undefined
      }
    }

    /** Write one storage value, ignoring quota and blocked origins. */
    function write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        // The in-memory game stays playable without persistence.
      }
    }

    /** Parse stored JSON, or undefined when it is absent or corrupt. */
    function parse(raw) {
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw)
      } catch {
        // A corrupted record reads as absent; the next save replaces it.
        return undefined
      }
    }

    /** An empty per-difficulty record. */
    function emptyRecord() {
      return { played: 0, won: 0, bestScore: null, bestSeconds: null, bestMoves: null }
    }

    /** An empty statistics table. */
    function emptyStats() {
      return { 'one-suit': emptyRecord(), 'two-suits': emptyRecord(), 'four-suits': emptyRecord() }
    }

    /** Read the statistics table with every record normalized. */
    function loadStats() {
      const value = parse(read(STATS_KEY))
      const stats = emptyStats()
      if (value === null || typeof value !== 'object') return stats
      for (const key of DIFFICULTY_KEYS) {
        const record = value[key]
        if (record === null || typeof record !== 'object') continue
        const count = field => (typeof record[field] === 'number' && record[field] >= 0 ? record[field] : 0)
        const maybe = field => (typeof record[field] === 'number' ? record[field] : null)
        stats[key] = {
          played: count('played'),
          won: count('won'),
          bestScore: maybe('bestScore'),
          bestSeconds: maybe('bestSeconds'),
          bestMoves: maybe('bestMoves'),
        }
      }
      return stats
    }

    /** Fold one finished game into the table. */
    function withResult(stats, difficulty, result) {
      const current = stats[difficulty] ?? emptyRecord()
      /** Keep the previous value or take the next one when it beats it. */
      const replace = (previous, next, beats) => (previous === null || beats(next, previous) ? next : previous)
      return {
        ...stats,
        [difficulty]: {
          played: current.played + 1,
          won: current.won + (result.won ? 1 : 0),
          // A best score counts every game; the best time and move count are wins only.
          bestScore: replace(current.bestScore, result.score, (next, previous) => next > previous),
          bestSeconds: result.won ? replace(current.bestSeconds, result.seconds, (next, previous) => next < previous) : current.bestSeconds,
          bestMoves: result.won ? replace(current.bestMoves, result.moves, (next, previous) => next < previous) : current.bestMoves,
        },
      }
    }

    /** Read the game to resume, or null when none is saved or it is unplayable. */
    function loadGame() {
      const value = parse(read(GAME_KEY))
      return isGameState(value) ? value : null
    }

    /** Persist the game. */
    function saveGame(state) {
      write(GAME_KEY, JSON.stringify(state))
    }

    /** Read the last difficulty played. */
    function loadDifficulty() {
      const raw = read(DIFFICULTY_KEY)
      return typeof raw === 'string' && raw in SUITS ? raw : 'one-suit'
    }

    /** Start a fresh game and remember its difficulty. */
    function startGame(difficulty) {
      const state = newGame(difficulty, (Math.random() * 0xffffffff) >>> 0)
      saveGame(state)
      write(DIFFICULTY_KEY, difficulty)
      return state
    }

    /** Read the sound preference; cues are on unless the player turned them off. */
    function loadSound() {
      return read(SOUND_KEY) !== 'off'
    }

    /** Persist the sound preference. */
    function saveSound(enabled) {
      write(SOUND_KEY, enabled ? 'on' : 'off')
    }

    /** The felt colours a player can choose; the first is the default table. */
    const TABLES = [
      { id: 'green', label: 'table.green' },
      { id: 'blue', label: 'table.blue' },
      { id: 'red', label: 'table.red' },
      { id: 'charcoal', label: 'table.charcoal' },
    ]

    /** The card-back patterns a player can choose; the first is the default. */
    const BACKS = [
      { id: 'classic', label: 'back.classic' },
      { id: 'ruby', label: 'back.ruby' },
      { id: 'violet', label: 'back.violet' },
      { id: 'midnight', label: 'back.midnight' },
    ]

    /** Whether a stored id names a known option. */
    function known(options, value, fallback) {
      return typeof value === 'string' && options.some(option => option.id === value) ? value : fallback
    }

    /** Read the chosen table colour. */
    function loadTable() {
      return known(TABLES, read(TABLE_KEY), TABLES[0].id)
    }

    /** Persist the chosen table colour. */
    function saveTable(id) {
      write(TABLE_KEY, known(TABLES, id, TABLES[0].id))
    }

    /** Read the chosen card-back pattern. */
    function loadBack() {
      return known(BACKS, read(BACK_KEY), BACKS[0].id)
    }

    /** Persist the chosen card-back pattern. */
    function saveBack(id) {
      write(BACK_KEY, known(BACKS, id, BACKS[0].id))
    }

    /** Format seconds as m:ss. */
    function formatClock(seconds) {
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }

    /** A record's non-null value as text, or a dash. */
    function orDash(value, render) {
      return value === null ? '\u2014' : render(value)
    }

    // ---- game state hook -------------------------------------------------

    /**
     * One game's live state: the board, its history, the statistics, and the
     * short messages the toolbar shows. The saved state is the source the tab
     * reopens from, so every transition writes it before rendering.
     */
    function useGame() {
      const [state, setBoard] = React.useState(() => loadGame() ?? startGame(loadDifficulty()))
      const [stats, setStats] = React.useState(loadStats)
      const history = React.useRef([])
      const future = React.useRef([])
      /**
       * The board whose win the statistics already hold. A win is recorded once
       * per board, so remounting the tab, undoing back to a win, or re-rendering
       * the overlay never counts the same game twice.
       */
      const recorded = React.useRef(state.won ? `${state.seed}:${state.moves}` : null)
      const [canUndo, setCanUndo] = React.useState(false)
      const [canRedo, setCanRedo] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const noticeTimer = React.useRef(0)

      /** Publish a state, persist it, and refresh the history flags. */
      const commit = React.useCallback((next, previous) => {
        if (previous !== undefined) {
          history.current.push(previous)
          future.current = []
        }
        saveGame(next)
        setBoard(next)
        setCanUndo(history.current.length > 0)
        setCanRedo(future.current.length > 0)
      }, [])

      /** Show a message in the toolbar's status line for a moment. */
      const flash = React.useCallback((key) => {
        setNotice(key)
        globalThis.clearTimeout(noticeTimer.current)
        noticeTimer.current = globalThis.setTimeout(() => { setNotice(null) }, 2600)
      }, [])

      React.useEffect(() => () => { globalThis.clearTimeout(noticeTimer.current) }, [])

      /** Fold one result into the table and persist it. */
      const record = React.useCallback((result) => {
        setStats((current) => {
          const next = withResult(current, state.difficulty, result)
          write(STATS_KEY, JSON.stringify(next))
          return next
        })
      }, [state.difficulty])

      /** Record a win exactly once, when the board first turns won. */
      React.useEffect(() => {
        if (!state.won) return
        const key = `${state.seed}:${state.moves}`
        if (recorded.current === key) return
        recorded.current = key
        record({
          won: true,
          score: state.score,
          seconds: elapsedSeconds(state, state.finishedAt ?? Date.now()),
          moves: state.moves,
        })
      }, [state.won, state.moves, state.seed])

      /** Record an abandoned, unfinished game as a loss. */
      const recordAbandon = React.useCallback(() => {
        if (state.startedAt === null || state.won) return
        record({ won: false, score: state.score, seconds: elapsedSeconds(state, Date.now()), moves: state.moves })
      }, [record, state])

      /**
       * Apply a rules result, explaining a refusal instead.
       * @returns what happened, so the caller can voice it: `null` when the
       * rules refused, otherwise the cleared count and whether the game ended.
       */
      const apply = React.useCallback((outcome, refusalKey) => {
        if (outcome.reason !== undefined) {
          flash(refusalKey(outcome.reason))
          return null
        }
        commit(outcome.state, state)
        return { cleared: outcome.cleared ?? 0, won: outcome.state.won }
      }, [commit, flash, state])

      const move = React.useCallback((from, index, to) => apply(moveRun(state, from, index, to), reason => ({
        same: 'refuse.same', unmovable: 'refuse.unmovable', fit: 'refuse.fit',
      })[reason] ?? 'refuse.unmovable'), [apply, state])

      const deal = React.useCallback(
        () => apply(dealStock(state), reason => (reason === 'stock' ? 'refuse.stockEmpty' : 'refuse.stockColumn')),
        [apply, state],
      )

      /** Start a new game, counting an unfinished one as a loss. */
      const restart = React.useCallback((difficulty) => {
        recordAbandon()
        history.current = []
        future.current = []
        setCanUndo(false)
        setCanRedo(false)
        const next = startGame(difficulty)
        setBoard(next)
      }, [recordAbandon])

      /** Step back one move; a win already counted stays counted. */
      const undo = React.useCallback(() => {
        const previous = history.current.pop()
        if (previous === undefined) return
        future.current.push(state)
        saveGame(previous)
        setBoard(previous)
        setCanUndo(history.current.length > 0)
        setCanRedo(true)
      }, [state])

      const redo = React.useCallback(() => {
        const next = future.current.pop()
        if (next === undefined) return
        history.current.push(state)
        saveGame(next)
        setBoard(next)
        setCanUndo(true)
        setCanRedo(future.current.length > 0)
      }, [state])

      /**
       * End a game the player cannot finish: the stock is empty and no card
       * moves. The board is stamped `finishedAt` with `lost` set, so the result
       * panel reports it and the statistics count one loss — the same bookkeeping
       * `restart` does for an abandoned board, without dealing a new one.
       */
      const giveUp = React.useCallback(() => {
        if (state.won || state.lost) return
        const ended = { ...state, lost: true, finishedAt: Date.now() }
        commit(ended, state)
        record({ won: false, score: ended.score, seconds: elapsedSeconds(ended, ended.finishedAt), moves: ended.moves })
      }, [commit, record, state])

      return { state, stats, move, deal, restart, undo, redo, giveUp, canUndo, canRedo, notice, flash }
    }

    // ---- components ------------------------------------------------------

    /**
     * One card face or back.
     *
     * `lifted` cards follow the pointer during a drag; `selected` marks a run
     * the player has picked up, and `closesSelection` marks its last card so the
     * run ends with a visible outline under the covered cards above it.
     */
    function Card({ card, selected, closesSelection, lifted, style, onPointerDown, onClick, onDoubleClick, backLabel }) {
      const red = SUIT_RED[card.suit]
      const face = card.faceUp
      return h('div', {
        className: `sp-card${face ? '' : ' sp-back'}${selected ? ' sp-card-selected' : ''}${closesSelection ? ' sp-card-selected-last' : ''}${lifted ? ' sp-card-lifted' : ''}`,
        style,
        'data-rank': face ? card.rank : undefined,
        'data-suit': face ? card.suit : undefined,
        'aria-selected': selected || undefined,
        onPointerDown,
        onClick,
        onDoubleClick,
        role: 'button',
        'aria-label': face ? `${RANK_LABELS[card.rank]}${SUIT_GLYPHS[card.suit]}` : backLabel,
      },
        face
          ? h(React.Fragment, null,
            h('span', { key: 'top', className: `sp-corner${red ? ' sp-red' : ''}` },
              h('span', { className: 'sp-rank' }, RANK_LABELS[card.rank]),
              h('span', { className: 'sp-suit' }, SUIT_GLYPHS[card.suit])),
            // Every face, court cards included, carries the suit's pip in the
            // middle: the deck reads as one design from ace through king.
            h('span', { key: 'pip', className: `sp-pip${red ? ' sp-red' : ''}`, 'aria-hidden': true }, SUIT_GLYPHS[card.suit]),
            h('span', { key: 'bottom', className: `sp-corner sp-corner-br${red ? ' sp-red' : ''}`, 'aria-hidden': true },
              h('span', { className: 'sp-rank' }, RANK_LABELS[card.rank]),
              h('span', { className: 'sp-suit' }, SUIT_GLYPHS[card.suit])),
          )
          // A back needs no children: its pattern and inset ring are painted by
          // the shared card-back rule, the same one a stock card uses.
          : null,
      )
    }

    /**
     * The ten-column tableau.
     *
     * Column stacks are laid out in pixels from a measured card width, because
     * a card's travel must shrink as its column grows: a 20-card column still
     * fits the pane while each face-up card keeps enough of its corner to be
     * read. The measurement comes from the board's own width, which the docked
     * and floating panes both provide, so no resize observer is needed.
     */
    function Tableau({
      state, selection, drag, dropTarget, hint, cardWidth, step,
      onCardPointerDown, onCardClick, onCardDoubleClick, onColumnClick, backLabel, backStrip,
    }) {
      return h('div', { className: 'sp-tableau', role: 'group' },
        state.columns.map((column, columnIndex) => {
          const count = column.cards.length
          // A column is drawn as two blocks, the way a dealt hand sits on a
          // table: the face-down cards stack as one pile, each showing a
          // stripe of its own back wide enough to read as a card edge, and the
          // face-up cards fan out under it at the reading step.
          let offset = 0
          const tops = column.cards.map((card, cardIndex) => {
            const top = offset
            if (cardIndex < count - 1) offset += card.faceUp ? step : backStrip
            return top
          })
          return h('div', {
            key: columnIndex,
            className: `sp-col${dropTarget === columnIndex ? ' sp-col-drop' : ''}${count === 0 ? ' sp-col-empty' : ''}${hint !== null && hint.to === columnIndex ? ' sp-col-hint' : ''}`,
            'data-column': columnIndex,
            onClick: () => { onColumnClick(columnIndex) },
            style: { width: `${cardWidth}px` },
          },
            column.cards.map((card, cardIndex) => {
              // The grabbed run travels as one piece: the grabbed card and every
              // card below it move together, so the pile visibly comes away
              // whole rather than leaving its tail behind.
              const inGrab = drag !== null && drag.from === columnIndex && cardIndex >= drag.index
              const selected = selection !== null && selection.from === columnIndex && cardIndex >= selection.index
              // The run's last card closes the selection: its own full outline
              // is visible, while the covered cards above only show a bar.
              const closesSelection = selected && cardIndex === count - 1
              return h(Card, {
                key: card.id,
                card,
                selected,
                closesSelection,
                lifted: inGrab,
                style: inGrab && drag !== null
                  ? { top: `${tops[cardIndex]}px`, transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0)`, zIndex: 60 + cardIndex - drag.index }
                  : { top: `${tops[cardIndex]}px`, zIndex: cardIndex },
                onPointerDown: (event) => { onCardPointerDown(event, columnIndex, cardIndex) },
                onClick: (event) => { onCardClick(event, columnIndex, cardIndex) },
                onDoubleClick: (event) => { onCardDoubleClick(event, columnIndex, cardIndex) },
                backLabel,
              })
            }),
          )
        }),
      )
    }

    /**
     * The cleared-run pile and the stock at the foot of the board.
     *
     * The stock sits at the right end, where the eye returns after the last
     * column and where a mouse crossing the board naturally arrives. Both piles
     * are drawn at the tableau's own card size — same width, same 5:7 height —
     * so the stock reads as the same cards the board is played with, and a
     * cleared run reads as the real card it cleared.
     *
     * `hint` lights the pile when the hint points at it: with no card able to
     * move, the stock is the next click, and a glow on it says so.
     */
    function Stock({ state, onDeal, disabled, t, cardWidth, hint }) {
      const rounds = state.stock.length
      const completed = Math.min(state.completed, RUNS_TO_WIN)
      /** The tableau's own card size: the foot draws the same cards. */
      const cardHeight = Math.round((cardWidth * 7) / 5)
      return h('div', { className: 'sp-foot' },
        h('div', {
          className: 'sp-run-area',
          'aria-label': t('runs'),
          style: { '--sp-run-w': `${cardWidth}px`, '--sp-run-h': `${cardHeight}px` },
        },
          h('div', { className: 'sp-foundation' },
            Array.from({ length: RUNS_TO_WIN }, (_, index) => {
              // A cleared run keeps the suit it cleared, cycling through all
              // four twice across the eight slots: the pile reads as a set of
              // real cleared runs rather than eight copies of one mark.
              const suit = index % SUIT_GLYPHS.length
              const done = index < completed
              return h('span', {
                key: index,
                className: `sp-run${done ? ' sp-run-done' : ''}${done && SUIT_RED[suit] ? ' sp-red-run' : ''}`,
                'aria-hidden': true,
              }, done ? SUIT_GLYPHS[suit] : '')
            }),
          ),
          h('span', { className: 'sp-run-label' }, `${completed}/${RUNS_TO_WIN}`),
        ),
        h('button', {
          type: 'button',
          className: `sp-stock${rounds === 0 ? ' sp-stock-empty' : ''}${hint === true && rounds > 0 ? ' sp-stock-hint' : ''}`,
          onClick: onDeal,
          disabled: disabled || rounds === 0,
          'aria-label': t('dealCount', { n: rounds }),
          title: t('dealCount', { n: rounds }),
          style: { '--sp-stock-w': `${cardWidth}px`, '--sp-stock-h': `${cardHeight}px` },
        },
          rounds === 0
            ? h('span', { className: 'sp-stock-recycle', 'aria-hidden': true }, '\u21ba')
            : Array.from({ length: rounds }, (_, index) => h('span', {
              key: index,
              // Each round peeks out a little, so the pile's depth reads at a glance.
              className: 'sp-stock-back',
              style: {
                left: `${index * Math.max(3, Math.round(cardWidth * 0.08))}px`,
                top: `${index * Math.max(1, Math.round(cardHeight * 0.02))}px`,
              },
            })),
        ),
      )
    }

    /**
     * Toolbar glyphs, drawn as stroke paths on one 16-unit grid.
     *
     * A shared grid and stroke weight keep the row optically even: the text
     * glyphs they replace (`↴`, `↵`, `✳`, `♫`) came from three different fonts
     * and sat at different sizes and weights in the same row.
     */
    const ICONS = {
      /** A curved arrow turning back to the left. */
      undo: 'M6.5 4.5 3 8l3.5 3.5M3 8h6.2a3.3 3.3 0 0 1 0 6.6H7.4',
      /** The same arrow mirrored. */
      redo: 'M9.5 4.5 13 8l-3.5 3.5M13 8H6.8a3.3 3.3 0 0 0 0 6.6h1.8',
      /** A bulb with a short base: the hint. */
      hint: 'M8 2.2a4.1 4.1 0 0 1 2.3 7.5c-.4.3-.6.8-.6 1.3H6.3c0-.5-.2-1-.6-1.3A4.1 4.1 0 0 1 8 2.2ZM6.4 12.9h3.2M7 14.5h2',
      /** A speaker with sound waves. */
      sound: 'M3 6.2h2.3L8.6 3.4v9.2L5.3 9.8H3ZM10.4 6.1a2.7 2.7 0 0 1 0 3.8M12.3 4.3a5.2 5.2 0 0 1 0 7.4',
      /** The same speaker, muted. */
      muted: 'M3 6.2h2.3L8.6 3.4v9.2L5.3 9.8H3ZM10.6 6.2l3.2 3.6M13.8 6.2l-3.2 3.6',
      /** Two cards with a plus: start a new deal. */
      deal: 'M5.2 2.6h5.2l2.4 2.4v5.4M5.2 2.6v5.4h7.6M3.4 6.1h6.4v7.3H3.4zM6.6 8.3v3M5.1 9.8h3',
      /** A gear: the board's own preferences. */
      settings: 'M8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM8 1.9v1.4M8 12.7v1.4M2.4 8H3.8M12.2 8h1.4M4 4l1 1M11 11l1 1M4 12l1-1M11 5l1-1',
    }

    /** One toolbar glyph on the shared grid. */
    function ToolIcon({ name }) {
      return h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: ICONS[name] }))
    }

    /**
     * One toolbar button.
     *
     * `pressed` marks a toggle's current state for assistive tech and paints the
     * button as active; `disabled` dims it without changing its layout.
     */
    function ToolButton({ label, onClick, disabled, icon, primary, pressed }) {
      return h('button', {
        type: 'button',
        className: `sp-tool${primary ? ' sp-tool-primary' : ''}${pressed === true ? ' sp-tool-on' : ''}`,
        onClick,
        disabled,
        'aria-label': label,
        title: label,
        ...(pressed === undefined ? {} : { 'aria-pressed': pressed }),
      }, h(ToolIcon, { name: icon }))
    }

    /**
     * The settings dialog: the table's felt and the card-back pattern.
     *
     * Each choice is a swatch button showing what it would look like, so the
     * player picks by eye. The felt swatches paint the same gradient the table
     * uses, and the back swatches paint the shared card-back recipe, so neither
     * can promise a look the board does not deliver.
     */
    function SettingsDialog({ table, back, t, onTable, onBack, onClose }) {
      /** One labelled group of swatches. */
      const group = (title, options, current, pick, className) => h('div', { className: 'sp-set-group' },
        h('div', { className: 'sp-set-title' }, t(title)),
        h('div', { className: 'sp-set-row' },
          options.map(option => h('button', {
            key: option.id,
            type: 'button',
            className: `sp-swatch ${className}-${option.id}${option.id === current ? ' sp-swatch-on' : ''}`,
            'aria-pressed': option.id === current,
            title: t(option.label),
            onClick: () => { pick(option.id) },
          }, h('span', { className: 'sp-swatch-label' }, t(option.label)))),
        ),
      )
      return h('div', { className: 'sp-modal', onClick: onClose },
        h('div', {
          className: 'sp-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('settings'),
          onClick: (event) => { event.stopPropagation() },
        },
          h('div', { className: 'sp-dialog-head' },
            h('span', { className: 'sp-dialog-title' }, t('settings')),
            h('button', { type: 'button', className: 'sp-dialog-close', onClick: onClose, 'aria-label': t('close') }, '\u00d7'),
          ),
          group('settings.table', TABLES, table, onTable, 'sp-table-swatch'),
          group('settings.back', BACKS, back, onBack, 'sp-back-swatch'),
          h('p', { className: 'sp-dialog-note' }, t('settings.local')),
        ),
      )
    }

    /** The statistics dialog. */
    function StatsDialog({ stats, difficulty, t, onClose }) {
      const record = stats[difficulty] ?? emptyRecord()
      const rate = record.played === 0 ? 0 : Math.round((record.won / record.played) * 100)
      const rows = [
        ['stats.played', String(record.played)],
        ['stats.won', String(record.won)],
        ['stats.rate', `${rate}%`],
        ['stats.bestScore', orDash(record.bestScore, String)],
        ['stats.bestTime', orDash(record.bestSeconds, formatClock)],
        ['stats.bestMoves', orDash(record.bestMoves, String)],
      ]
      return h('div', { className: 'sp-modal', onClick: onClose },
        h('div', {
          className: 'sp-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('stats'),
          onClick: (event) => { event.stopPropagation() },
        },
          h('div', { className: 'sp-dialog-head' },
            h('span', { className: 'sp-dialog-title' }, t('stats')),
            h('button', { type: 'button', className: 'sp-dialog-close', onClick: onClose, 'aria-label': t('close') }, '\u00d7'),
          ),
          h('div', { className: 'sp-dialog-sub' }, t(`difficulty.${difficulty}`)),
          h('div', { className: 'sp-stats' },
            rows.map(([key, value]) => h('div', { key, className: 'sp-stats-row' },
              h('span', { className: 'sp-stats-name' }, t(key)),
              h('span', { className: 'sp-stats-value' }, value),
            )),
          ),
          h('p', { className: 'sp-dialog-note' }, t('stats.local')),
        ),
      )
    }

    /**
     * A fireworks display for the win.
     *
     * Particles live on a canvas rather than as DOM nodes: a burst is a few
     * hundred short-lived dots, and one canvas paints them all in a single
     * compositing step. Each shell rises to its own height, blooms in its own
     * colour, and its sparks fall under gravity while their trail fades; the
     * display repeats for as long as the result card is up, so the celebration
     * does not stop while the player reads their score.
     *
     * The animation is decorative, so it is hidden from assistive technology and
     * abandoned entirely when the user asks for reduced motion.
     */
    function Fireworks({ active, sound }) {
      const canvasRef = React.useRef(null)
      React.useEffect(() => {
        const canvas = canvasRef.current
        if (canvas === null || !active) return undefined
        const context = canvas.getContext('2d')
        if (context === null) return undefined
        const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
        if (reduced) return undefined

        /** Shell colours, warm and cool so bursts never read as one hue. */
        const PALETTE = [
          [255, 214, 102], [255, 138, 128], [130, 214, 255],
          [178, 255, 172], [255, 160, 224], [255, 255, 255],
        ]
        /** @type {{ x: number, y: number, vx: number, vy: number, life: number, ttl: number, rgb: number[], size: number }[]} */
        let sparks = []
        /** Shells still climbing toward their burst height. */
        let shells = []
        let width = 0
        let height = 0
        let frame = 0
        let lastSpawn = 0
        /** When the first shell left, so the opening volley knows it is opening. */
        let startedAt = 0

        /** Match the canvas to the element's own box and the device pixel ratio. */
        const resize = () => {
          const rect = canvas.getBoundingClientRect()
          const ratio = globalThis.devicePixelRatio ?? 1
          width = Math.max(1, Math.round(rect.width))
          height = Math.max(1, Math.round(rect.height))
          canvas.width = Math.round(width * ratio)
          canvas.height = Math.round(height * ratio)
          context.setTransform(ratio, 0, 0, ratio, 0, 0)
        }
        resize()

        /** Launch one shell from a random point along the foot of the pane. */
        const launch = () => {
          const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]
          shells.push({
            x: width * (0.1 + Math.random() * 0.8),
            y: height + 10,
            targetY: height * (0.08 + Math.random() * 0.45),
            vy: -(height * 0.018 + Math.random() * height * 0.012),
            rgb: color,
            trail: [],
          })
        }

        /**
         * Bloom a shell into sparks.
         *
         * A big burst throws several hundred dots in a ring, then a second,
         * wider wave for the outer skirt, so the display has real volume rather
         * than a thin circle. A fraction of shells also carry a secondary colour
         * that appears in the outer ring, which is what makes a sky look rich.
         */
        const burst = (shell) => {
          const primary = shell.rgb
          const secondary = Math.random() < 0.45
            ? PALETTE[Math.floor(Math.random() * PALETTE.length)]
            : primary
          const core = height * 0.55
          const rings = [
            { count: 70, speed: core * 0.0105, rgb: primary, size: 2.4 },
            { count: 90, speed: core * 0.0145, rgb: secondary, size: 2.0 },
            { count: 70, speed: core * 0.0185, rgb: primary, size: 1.7 },
          ]
          for (const ring of rings) {
            const spin = Math.random() * Math.PI * 2
            for (let index = 0; index < ring.count; index += 1) {
              const angle = (index / ring.count) * Math.PI * 2 + spin
              const velocity = ring.speed * (0.55 + Math.random() * 0.7)
              const ttl = 90 + Math.random() * 70
              sparks.push({
                x: shell.x,
                y: shell.y,
                vx: Math.cos(angle) * velocity,
                vy: Math.sin(angle) * velocity,
                life: ttl,
                ttl,
                rgb: ring.rgb,
                size: ring.size * (0.75 + Math.random() * 0.6),
              })
            }
          }
          // A white flash at the heart of each burst sells the explosion.
          sparks.push({
            x: shell.x, y: shell.y, vx: 0, vy: 0, life: 26, ttl: 26,
            rgb: [255, 255, 255], size: 16,
          })
        }

        /** Advance one frame; keep the sky busy while the card is up. */
        const tick = (now) => {
          // A trail instead of a full clear: the last frame is dimmed, so every
          // spark leaves a fading smear behind it.
          context.globalCompositeOperation = 'destination-out'
          context.fillStyle = 'rgba(0, 0, 0, 0.22)'
          context.fillRect(0, 0, width, height)
          // Glowing dots: overlapping sparks add up to a bloom at their centre.
          context.globalCompositeOperation = 'lighter'
          if (now - lastSpawn > 260 && shells.length < 6) {
            launch()
            // A volley opens the show: two shells at once for the first seconds.
            if (startedAt === 0) startedAt = now
            if (now - startedAt < 1500) launch()
            lastSpawn = now
          }
          for (const shell of shells) {
            shell.trail.push({ x: shell.x, y: shell.y })
            if (shell.trail.length > 6) shell.trail.shift()
            // The rising tail: a short comet behind the shell.
            shell.trail.forEach((point, index) => {
              const shade = (index + 1) / shell.trail.length
              context.beginPath()
              context.arc(point.x, point.y, 3.2 * shade + 0.6, 0, Math.PI * 2)
              context.fillStyle = `rgba(${shell.rgb.join(',')}, ${(shade * 0.55).toFixed(3)})`
              context.fill()
            })
            shell.y += shell.vy
            shell.vy += height * 0.00028
            context.beginPath()
            context.arc(shell.x, shell.y, 2.6, 0, Math.PI * 2)
            context.fillStyle = `rgba(${shell.rgb.join(',')}, 0.95)`
            context.fill()
          }
          const climbing = []
          for (const shell of shells) {
            if (shell.y <= shell.targetY || shell.vy >= 0) {
              burst(shell)
              // Each bloom is heard as it happens, scaled by a random size so
              // the volley never sounds like one repeated sample.
              sound?.burst(0.8 + Math.random() * 0.6)
            } else climbing.push(shell)
          }
          shells = climbing

          const alive = []
          for (const spark of sparks) {
            spark.life -= 1
            if (spark.life <= 0) continue
            spark.x += spark.vx
            spark.y += spark.vy
            spark.vy += height * 0.00036
            spark.vx *= 0.988
            spark.vy *= 0.988
            // A spark fades as its life runs out; the flash point shrinks fastest.
            const alpha = (spark.life / spark.ttl) ** 1.2
            const radius = spark.size * (spark.ttl === 26 ? alpha : Math.min(1, alpha * 1.6)) + 0.4
            context.beginPath()
            context.arc(spark.x, spark.y, radius, 0, Math.PI * 2)
            context.fillStyle = `rgba(${spark.rgb.join(',')}, ${alpha.toFixed(3)})`
            context.fill()
            alive.push(spark)
          }
          sparks = alive
          frame = globalThis.requestAnimationFrame(tick)
        }
        frame = globalThis.requestAnimationFrame(tick)

        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
        observer?.observe(canvas)
        if (observer === null) globalThis.addEventListener('resize', resize)
        return () => {
          globalThis.cancelAnimationFrame(frame)
          observer?.disconnect()
          if (observer === null) globalThis.removeEventListener('resize', resize)
          context.clearRect(0, 0, width, height)
        }
      }, [active])

      return h('canvas', { className: 'sp-fireworks', ref: canvasRef, 'aria-hidden': true })
    }

    /**
     * Plan the ten flights of one stock round.
     *
     * Each card starts at the stock's pile and ends at the slot it will occupy
     * at the foot of its column, both read from the live DOM before the board
     * changes. Coordinates are relative to the felt, not the tableau: the stock
     * lives in the table's foot, below the board, and the flight layer covers
     * the felt. The start rotation is per-card so the round reads as a fan
     * rather than ten identical slides.
     * @param board - the measured tableau element, or null before its first render.
     * @param state - the board before the deal, whose stock pile is the origin.
     * @param cardW - the tableau's card width in px.
     * @param cardH - the tableau's card height in px.
     * @param step - the face-up step, the landing offset of a covered card.
     * @param backStrip - the face-down strip, the landing offset of a back.
     * @returns one flight per column, or an empty list when the table cannot be measured.
     */
    function measureDeal(board, state, cardW, cardH, step, backStrip) {
      if (board === null) return []
      // The felt is the flight layer's own containing block, so every coordinate
      // is expressed against it and the overlay can position cards directly.
      const table = board.closest('.sp-table')
      if (table === null) return []
      // The stock sits in the foot, a sibling of the board.
      const stock = table.querySelector('.sp-stock')
      if (stock === null) return []
      const stockRect = stock.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const columns = board.querySelectorAll('[data-column]')
      const flights = []
      for (let index = 0; index < columns.length; index += 1) {
        const columnRect = columns[index].getBoundingClientRect()
        // The landing spot is the card's top once it is appended: the column's
        // own stack offset, computed the same way the tableau draws it.
        const cards = state.columns[index]?.cards ?? []
        let offset = 0
        for (let card = 0; card < cards.length - 1; card += 1) {
          offset += cards[card].faceUp ? step : backStrip
        }
        flights.push({
          width: cardW,
          height: cardH,
          from: {
            x: stockRect.left - tableRect.left + Math.min(4, index),
            y: stockRect.top - tableRect.top + Math.min(2, index * 0.4),
            rotate: -8 + index * 1.2,
          },
          to: {
            x: columnRect.left - tableRect.left,
            y: columnRect.top - tableRect.top + offset,
            rotate: 0,
          },
        })
      }
      return flights
    }

    /** The column under a viewport point, or null outside the board. */
    function columnUnderPoint(root, clientX, clientY) {
      if (root === null) return null
      for (const node of root.querySelectorAll('[data-column]')) {
        const rect = node.getBoundingClientRect()
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return Number(node.getAttribute('data-column'))
        }
      }
      return null
    }

    /** The tab body. */
    function Board({ t }) {
      const game = useGame()
      const { state } = game
      const [selection, setSelection] = React.useState(null)
      const [drag, setDrag] = React.useState(null)
      const [dropTarget, setDropTarget] = React.useState(null)
      const [hint, setHint] = React.useState(null)
      const [showStats, setShowStats] = React.useState(false)
      const [showSettings, setShowSettings] = React.useState(false)
      /** The felt colour and card-back pattern, persisted as the player chooses. */
      const [table, setTable] = React.useState(loadTable)
      const [back, setBack] = React.useState(loadBack)
      const [stockHint, setStockHint] = React.useState(false)
      /** Cards in flight from a stock deal; empty once the round has landed. */
      const [flying, setFlying] = React.useState([])
      const flyingTimer = React.useRef(0)
      const [now, setNow] = React.useState(() => Date.now())
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [cardWidth, setCardWidth] = React.useState(48)
      const [boardHeight, setBoardHeight] = React.useState(0)
      const [soundOn, setSoundOn] = React.useState(loadSound)
      const gesture = React.useRef(null)
      const swallow = React.useRef(false)
      const boardRef = React.useRef(null)
      // The sound engine outlives renders and stays silent until a gesture has
      // unlocked audio; the preference travels with it so a toggle applies at once.
      const sound = React.useRef(null)
      if (sound.current === null) sound.current = createSound(soundOn)
      React.useEffect(() => { sound.current.set(soundOn) }, [soundOn])

      const won = state.won
      /** A game the player can no longer finish: no stock and no legal move. */
      const lost = state.lost === true
      /** Either end of a game freezes the board until a new one is dealt. */
      const over = won || lost

      // One card's width follows the board's own width: ten columns and the gaps
      // between them, so a narrow docked pane and a wide float both fit. The
      // board's height sets how far faces travel inside a column.
      React.useEffect(() => {
        const board = boardRef.current
        if (board === null) return undefined
        const measure = () => {
          const width = board.clientWidth
          if (width > 0) setCardWidth(Math.floor((width - 9 * 6) / 10))
          setBoardHeight(board.clientHeight)
        }
        measure()
        if (typeof ResizeObserver !== 'function') {
          globalThis.addEventListener('resize', measure)
          return () => { globalThis.removeEventListener('resize', measure) }
        }
        const observer = new ResizeObserver(measure)
        observer.observe(board)
        return () => { observer.disconnect() }
      }, [])

      // The step is the travel between two face-up cards: enough to show the
      // corner row (rank and suit side by side) that a covered card leaves
      // visible. The corner is one line of ~40% card width, so the step keeps a
      // margin over that. Only the face-up cards consume the board's height,
      // so a tall column compresses the step rather than overflowing.
      const faceUpInTallest = Math.max(
        ...state.columns.map(column => column.cards.filter(card => card.faceUp).length),
        1,
      )
      const hiddenInTallest = Math.max(
        ...state.columns.map(column => column.cards.filter(card => !card.faceUp).length),
        0,
      )
      const cardHeight = (cardWidth * 7) / 5
      const backStrip = Math.max(9, Math.round(cardWidth * 0.2))
      const room = Math.max(boardHeight - cardHeight - hiddenInTallest * backStrip, 0)
      // The widest a face may travel: just past the corner's single line.
      const widest = Math.max(Math.round(cardWidth * 0.5), 12)
      const step = faceUpInTallest > 1
        ? Math.max(11, Math.min(widest, Math.floor(room / (faceUpInTallest - 1))))
        : widest

      // The clock ticks only while a game runs.
      React.useEffect(() => {
        if (state.won || state.startedAt === null) return undefined
        const timer = globalThis.setInterval(() => { setNow(Date.now()) }, 1000)
        return () => { globalThis.clearInterval(timer) }
      }, [state.won, state.startedAt])

      // A new board invalidates both transients.
      React.useEffect(() => { setSelection(null); setHint(null) }, [state])

      // The flight overlay outlives no board: leaving it (or unmounting) must
      // clear its timer so a late callback cannot touch an unmounted board.
      React.useEffect(() => () => { globalThis.clearTimeout(flyingTimer.current) }, [])

      /** A move or deal refused because the board is finished. */
      const refuseFinished = React.useCallback(() => { if (over) game.flash(lost ? 'refuse.lost' : 'refuse.finished') }, [game, lost, over])

      /**
       * Voice the outcome of one accepted change: a slide for the move, the
       * run arpeggio for a clear, and the fanfare when the last run clears.
       */
      const voice = React.useCallback((result) => {
        if (result === null) {
          sound.current.invalid()
          return false
        }
        if (result.won) sound.current.win()
        else if (result.cleared > 0) sound.current.clear()
        else sound.current.move()
        return true
      }, [])

      const safeMove = React.useCallback((from, index, to) => {
        if (over) {
          refuseFinished()
          return false
        }
        const moved = voice(game.move(from, index, to))
        if (moved) {
          setSelection(null)
          setHint(null)
        }
        return moved
      }, [game, refuseFinished, voice, won])

      const safeDeal = React.useCallback(() => {
        if (over) {
          refuseFinished()
          return false
        }
        setSelection(null)
        setHint(null)
        // The board has not changed yet, so the flight can be measured against
        // what the player sees: the stock's pile and each column's foot.
        const flights = measureDeal(boardRef.current, state, cardWidth, cardHeight, step, backStrip)
        if (flights.length === 0) {
          // Unmeasurable (no layout yet): deal at once rather than stall the click.
          const dealt = game.deal()
          if (dealt === false) {
            sound.current.invalid()
            return false
          }
          if (dealt.cleared > 0) sound.current.clear()
          else sound.current.deal()
          return true
        }
        // Hold the stock and its cards back while the round is in the air: each
        // card flies to the foot of its column, and the board only commits when
        // the last one lands. Otherwise the dealt cards appear before they move.
        flyingTimer.current = globalThis.setTimeout(() => {
          setFlying([])
          const dealt = game.deal()
          if (dealt === false) return
          if (dealt.cleared > 0) sound.current.clear()
          else sound.current.deal()
        }, DEAL_FLIGHT_MS + DEAL_STAGGER_MS * (flights.length - 1) + 30)
        sound.current.deal()
        setFlying(flights)
        return true
      }, [backStrip, cardWidth, game, over, refuseFinished, state, step])

      /**
       * A press on a liftable card grabs it together with every card below it
       * that continues the same-suit descent.
       *
       * That is what a hand does with real cards: a card is liftable exactly
       * when the cards beneath it form an unbroken same-suit run, and grabbing
       * it takes the whole run, never the card alone. A stack that changes suit
       * or turns face down ends the run, so only the part above that break
       * comes away.
       */
      const onCardPointerDown = React.useCallback((event, column, index) => {
        if (event.button !== undefined && event.button !== 0) return
        if (over) {
          refuseFinished()
          return
        }
        const source = state.columns[column]
        // An unmovable card cannot be lifted; the press is left to the click
        // handler, which moves a pending selection onto this column.
        if (!isRunStart(source, index)) return
        // Every press is a gesture start, including the one that only unlocks
        // audio in a fresh tab; the cue is quiet enough not to nag.
        sound.current.lift()
        gesture.current = {
          from: column,
          index,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        }
      }, [refuseFinished, state, won])

      /** Travel past a small threshold turns the press into a drag. */
      const onPointerMove = React.useCallback((event) => {
        const current = gesture.current
        if (current === null) return
        const dx = event.clientX - current.startX
        const dy = event.clientY - current.startY
        if (!current.moved) {
          if (Math.hypot(dx, dy) <= 4) return
          current.moved = true
        }
        event.preventDefault()
        setDrag({ from: current.from, index: current.index, dx, dy })
        const target = columnUnderPoint(boardRef.current, event.clientX, event.clientY)
        setDropTarget(target !== null && target !== current.from ? target : null)
      }, [])

      /**
       * Release ends a drag.
       *
       * A drag that travelled lands the run on the column under the pointer. A
       * press that did not travel is left to the browser's click, which selects
       * the run or completes a pending selection; `swallowClick` marks the one
       * click a completed drag must not also treat as a tap.
       */
      const onPointerUp = React.useCallback((event) => {
        const current = gesture.current
        gesture.current = null
        if (current === null) return
        const target = columnUnderPoint(boardRef.current, event.clientX, event.clientY)
        setDropTarget(null)
        setDrag(null)
        if (!current.moved) return
        swallow.current = true
        if (target !== null && target !== current.from) safeMove(current.from, current.index, target)
      }, [safeMove])

      /**
       * Pointer listeners stay attached for the whole session.
       *
       * They are cheap no-ops without a pending press, and attaching them on the
       * first movement would lose that very movement: the press, the threshold
       * crossing, and the release can all arrive before a re-render installs a
       * listener for the drag it just created.
       */
      React.useEffect(() => {
        globalThis.addEventListener('pointermove', onPointerMove)
        globalThis.addEventListener('pointerup', onPointerUp)
        globalThis.addEventListener('pointercancel', onPointerUp)
        return () => {
          globalThis.removeEventListener('pointermove', onPointerMove)
          globalThis.removeEventListener('pointerup', onPointerUp)
          globalThis.removeEventListener('pointercancel', onPointerUp)
        }
      }, [onPointerMove, onPointerUp])

      /**
       * A click on a card selects it together with the run below it.
       *
       * The browser supplies the click after a press that did not travel, so the
       * pointer gesture and this handler never both act on one press. The
       * selection runs from the clicked card to the column's end, matching what
       * a drag of that card would lift.
       */
      const onCardClick = React.useCallback((event, column, index) => {
        event.stopPropagation()
        if (swallow.current) {
          swallow.current = false
          return
        }
        if (over) {
          refuseFinished()
          return
        }
        const source = state.columns[column]
        if (!isRunStart(source, index)) {
          // Not a liftable run: the column's own click completes a pending move.
          return
        }
        // The run runs from the clicked card to the column's end, so a player
        // can select a tail of a longer descent instead of all of it.
        if (selection === null) {
          setSelection({ from: column, index })
          return
        }
        if (selection.from === column) {
          setSelection(null)
          return
        }
        safeMove(selection.from, selection.index, column)
      }, [refuseFinished, safeMove, selection, state, won])

      /**
       * A double click on a card sends its whole run to the first column that
       * accepts it.
       *
       * The move is the same one a drag makes, so it obeys the same rules: the
       * run must be liftable, and a destination must descend from its head.
       */
      const onCardDoubleClick = React.useCallback((event, column, index) => {
        event.stopPropagation()
        if (over) {
          refuseFinished()
          return
        }
        // The first click of the pair already selected the run; the double
        // click replaces that gesture, so no selection survives the move.
        setSelection(null)
        setHint(null)
        const source = state.columns[column]
        if (!isRunStart(source, index)) return
        // The double click lifts the run from the clicked card down, never the
        // cards above it: a player pointing at the eight means the eight.
        const target = autoMoveTarget(state, column, index)
        if (target === null) {
          game.flash('refuse.noTarget')
          return
        }
        safeMove(column, index, target)
      }, [game, refuseFinished, safeMove, state, won])

      /** A click on a column's own background completes a pending selection. */
      const onColumnClick = React.useCallback((column) => {
        if (swallow.current) {
          swallow.current = false
          return
        }
        if (selection === null) return
        if (selection.from === column) {
          setSelection(null)
          return
        }
        safeMove(selection.from, selection.index, column)
      }, [safeMove, selection])

      const onUndo = React.useCallback(() => {
        if (over) {
          refuseFinished()
          return
        }
        setSelection(null)
        setHint(null)
        game.undo()
      }, [game, refuseFinished, won])

      const onRedo = React.useCallback(() => {
        if (over) {
          refuseFinished()
          return
        }
        setSelection(null)
        setHint(null)
        game.redo()
      }, [game, refuseFinished, won])

      /**
       * Point at what the player should do next.
       *
       * A card move outlines its run and target column; the stock glows when no
       * card can move but a round is available, so the hint points at the exact
       * thing to click. A stock that cannot be dealt while a column stands empty
       * is explained, and a board with no move and no stock ends the game.
       */
      const onHint = React.useCallback(() => {
        if (over) {
          refuseFinished()
          return
        }
        const next = suggest(state)
        if (next === null) {
          // Nothing moves and nothing is left to deal: the game is over.
          game.giveUp()
          return
        }
        if (next.deal === true) {
          setSelection(null)
          setHint(null)
          setStockHint(true)
          game.flash('hint.deal')
          globalThis.setTimeout(() => { setStockHint(false) }, 2400)
          return
        }
        setSelection(null)
        setStockHint(false)
        setHint(next)
        globalThis.setTimeout(() => { setHint(null) }, 2400)
      }, [game, refuseFinished, state, won])

      /** Start a game at a difficulty; choosing the running one starts over. */
      const onNew = React.useCallback((difficulty) => {
        setMenuOpen(false)
        setSelection(null)
        setHint(null)
        game.restart(difficulty)
      }, [game])

      // Escape clears the selection, then the menu, then the dialog.
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (showStats) setShowStats(false)
          else if (menuOpen) setMenuOpen(false)
          else if (selection !== null) setSelection(null)
        }
        globalThis.addEventListener('keydown', onKey)
        return () => { globalThis.removeEventListener('keydown', onKey) }
      }, [showStats, menuOpen, selection])

      const seconds = elapsedSeconds(state, won ? state.finishedAt ?? now : now)
      const selectable = selection ?? (hint === null ? null : { from: hint.from, index: hint.index })

      return h('div', { className: 'sp-root' },
        h('div', { className: 'sp-head' },
          h('div', { className: 'sp-title-row' },
            h('div', { className: 'sp-title-group' },
              h('span', { className: 'sp-title' }, t('title')),
              h('span', { className: 'sp-badge' }, `${state.completed}/${RUNS_TO_WIN}`),
            ),
            h('div', { className: 'sp-head-actions' },
              h('button', {
                type: 'button',
                className: `sp-icon-btn${showStats ? ' sp-icon-on' : ''}`,
                onClick: () => { setShowStats(value => !value) },
                'aria-pressed': showStats,
                'aria-label': t('stats'),
                title: t('stats'),
              }, '\u25a4'),
              h('button', {
                type: 'button',
                className: `sp-icon-btn${showSettings ? ' sp-icon-on' : ''}`,
                onClick: () => { setShowSettings(value => !value) },
                'aria-pressed': showSettings,
                'aria-label': t('settings'),
                title: t('settings'),
              }, h(ToolIcon, { name: 'settings' })),
              h('button', {
                type: 'button',
                className: 'sp-icon-btn',
                onClick: () => { setMenuOpen(value => !value) },
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen,
                'aria-label': t('newGame'),
                title: t('newGame'),
              }, '\u21bb'),
            ),
          ),
          menuOpen && h('div', { className: 'sp-menu', role: 'menu' },
            h('div', { className: 'sp-menu-head' }, t('newGame')),
            DIFFICULTY_KEYS.map(key => h('button', {
              key,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': key === state.difficulty,
              className: `sp-menu-item${key === state.difficulty ? ' sp-menu-on' : ''}`,
              onClick: () => { onNew(key) },
            },
              h('span', null, t(`difficulty.${key}`)),
              h('span', { className: 'sp-menu-suits' }, `${SUITS[key]}\u2660`),
            )),
          ),
          h('div', { className: 'sp-meta' },
            h('span', { className: 'sp-meta-item' },
              h('span', { className: 'sp-meta-label' }, t('score')),
              h('span', { className: 'sp-meta-value' }, String(state.score)),
            ),
            h('span', { className: 'sp-meta-item' },
              h('span', { className: 'sp-meta-label' }, t('moves')),
              h('span', { className: 'sp-meta-value' }, String(state.moves)),
            ),
            h('span', { className: 'sp-meta-item' },
              h('span', { className: 'sp-meta-label' }, t('time')),
              h('span', { className: 'sp-meta-value' }, formatClock(seconds)),
            ),
          ),
          h('div', { className: 'sp-tools' },
            // The deal is the row's main action: an accented square of the same
            // size as the icon tools, named by its tooltip and accessible label.
            h('button', {
              type: 'button',
              className: 'sp-new',
              onClick: () => { onNew(state.difficulty) },
              title: t('newGame'),
              'aria-label': t('newGame'),
            },
              h(ToolIcon, { name: 'deal' }),
            ),
            h('span', { className: 'sp-tools-sep', 'aria-hidden': true }),
            h(ToolButton, { label: t('undo'), onClick: onUndo, disabled: !game.canUndo || over, icon: 'undo' }),
            h(ToolButton, { label: t('redo'), onClick: onRedo, disabled: !game.canRedo || over, icon: 'redo' }),
            h(ToolButton, { label: t('hint'), onClick: onHint, disabled: over, icon: 'hint' }),
            h(ToolButton, {
              label: soundOn ? t('sound.off') : t('sound.on'),
              onClick: () => {
                const next = !soundOn
                setSoundOn(next)
                saveSound(next)
                // The toggle itself confirms the choice the moment it is made.
                if (next) sound.current.move()
              },
              // `aria-pressed` names the state; the icon shows what a click does.
              pressed: !soundOn,
              icon: soundOn ? 'sound' : 'muted',
            }),
            h('span', { className: 'sp-tools-gap' }),
            h('span', { className: 'sp-status', role: 'status', 'aria-live': 'polite' },
              game.notice === null ? '' : t(game.notice),
            ),
          ),
        ),
        // The felt wraps the tableau, the stock and the cleared runs, so the
        // whole game sits on one table while the header keeps the pane's own
        // surface above it.
        // The felt's class carries the chosen colour and the card-back class the
        // chosen pattern; both are single words on the same element so a change
        // repaints without touching any card.
        h('div', { className: `sp-table sp-felt-${table} sp-backs-${back}` },
          h('div', { className: 'sp-board', ref: boardRef },
            h(Tableau, {
              state,
              selection: selectable,
              drag,
              dropTarget,
              hint,
              cardWidth,
              step,
              backStrip,
              onCardPointerDown,
              onCardClick,
              onCardDoubleClick,
              onColumnClick,
              backLabel: t('card.back'),
            }),
          ),
          h(Stock, { state, onDeal: safeDeal, disabled: over, t, cardWidth, hint: stockHint }),
          // The dealt cards fly across the felt, one per column, and the round
          // commits only when the last one lands. The layer is the felt's own
          // child so its coordinates are the ones the flight was measured in.
          flying.length > 0 && h('div', { className: 'sp-fly-layer', 'aria-hidden': true },
            flying.map((flight, index) => h(FlyingCard, {
              key: index,
              card: flight,
              from: flight.from,
              to: flight.to,
              delay: index * DEAL_STAGGER_MS,
              duration: DEAL_FLIGHT_MS,
            })),
          ),
        ),
        // The result card covers the board at either end: a win reports the
        // cleared runs over a fireworks display, a dead end explains that no
        // move or deal remains.
        over && h('div', { className: `sp-win${lost ? ' sp-win-lost' : ''}` },
          !lost && h(Fireworks, { active: true, sound: sound.current }),
          h('div', { className: 'sp-result-card', role: 'status' },
            h('span', { className: 'sp-result-mark', 'aria-hidden': true }, lost ? '\u2715' : '\u2660'),
            h('div', { className: 'sp-result-title' }, lost ? t('lose.title') : t('win.title')),
            lost && h('p', { className: 'sp-result-note' }, t('lose.note')),
            h('div', { className: 'sp-result-body' },
              h('span', null, `${t('runs')} ${state.completed}/${RUNS_TO_WIN}`),
              h('span', null, `${t('score')} ${state.score}`),
              h('span', null, `${t('time')} ${formatClock(seconds)}`),
              h('span', null, `${t('moves')} ${state.moves}`),
            ),
            h('button', { type: 'button', className: 'sp-result-btn', onClick: () => { onNew(state.difficulty) } },
              lost ? t('lose.again') : t('win.again')),
          ),
        ),
        showStats && h(StatsDialog, { stats: game.stats, difficulty: state.difficulty, t, onClose: () => { setShowStats(false) } }),
        showSettings && h(SettingsDialog, {
          table,
          back,
          t,
          onTable: (id) => { setTable(id); saveTable(id) },
          onBack: (id) => { setBack(id); saveBack(id) },
          onClose: () => { setShowSettings(false) },
        }),
      )
    }

    // ---- sidebar foot entry ----------------------------------------------

    /** The sidebar-foot glyph: one spade card. */
    function FootMark({ size }) {
      const edge = size ?? 16
      return h('svg', {
        viewBox: '0 0 16 16', width: edge, height: edge, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
        h('rect', { x: 2.5, y: 1.5, width: 11, height: 13, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: 'M8 4.1c-1.8 1.9-3.3 3-3.3 4.5 0 1.2.9 2 1.9 2 .6 0 1.1-.3 1.4-.7-.1.8-.4 1.5-.9 2h1.8c-.5-.5-.8-1.2-.9-2 .3.4.8.7 1.4.7 1 0 1.9-.8 1.9-2 0-1.5-1.5-2.6-3.3-4.5Z',
          fill: 'currentColor',
        }),
      )
    }

    let pluginCtx = null
    const translateRef = { current: key => key }

    /* Build output: the dictionaries and the stylesheet are inlined above so the
     * bundle ships one browser module with no runtime asset reads. */
    const DICTS = {"zh":{"meta.title":"蜘蛛纸牌","meta.description":"在右侧边栏里玩经典蜘蛛纸牌：单色、双色、四色三档难度，五次发牌，撤销与重做，提示，音效，以及微软式计分。进行中的牌局、外观选择和每档难度的成绩都保存在本机浏览器中。点侧栏底部的黑桃按钮或侧栏引导页即可打开。","title":"蜘蛛纸牌","button.label":"纸牌","button.tooltip":"玩蜘蛛纸牌","guide.title":"蜘蛛纸牌","guide.description":"发 104 张牌，收齐八组顺序牌","difficulty":"难度","difficulty.one-suit":"单色","difficulty.two-suits":"双色","difficulty.four-suits":"四色","score":"得分","moves":"步数","time":"用时","runs":"已收","newGame":"新游戏","undo":"撤销","redo":"重做","hint":"提示","sound.on":"打开音效","sound.off":"关闭音效","deal":"发牌","dealCount":"剩余 {n} 次发牌","stats":"统计","close":"关闭","card.back":"背面朝上的牌","stats.played":"已玩局数","stats.won":"胜局","stats.rate":"胜率","stats.bestScore":"最高分","stats.bestTime":"最快用时","stats.bestMoves":"最少步数","stats.local":"仅保存在本机。","refuse.same":"这列已经放着了","refuse.unmovable":"只有同花色连续递减的牌才能移动","refuse.fit":"这张牌不能放在那里","refuse.faceDown":"背面朝上的牌不能移动","refuse.stockEmpty":"已经没有牌可发了","refuse.stockColumn":"有空列时不能发牌","refuse.finished":"本局已结束，请开新局","refuse.lost":"没有可走的牌也没有牌可发，请开新局","refuse.noTarget":"没有可以放下的列","hint.none":"没有可走的牌，也没有牌可发了","hint.deal":"没有可移动的牌了，发一轮牌吧","win.title":"八组牌全部收齐","win.again":"再来一局","lose.title":"没有可走的棋了","lose.note":"牌堆已发完，也没有可以移动的牌。","lose.again":"开新局","settings":"设置","settings.table":"桌面","settings.back":"牌背","settings.local":"仅保存在本机。","table.green":"绿色","table.blue":"蓝色","table.red":"红色","table.charcoal":"炭黑","back.classic":"经典蓝","back.ruby":"宝石红","back.violet":"紫罗兰","back.midnight":"午夜蓝","meta.detail":"docs/DETAIL.zh.md"},"en":{"meta.title":"Spider Solitaire","meta.description":"Plays classic Spider Solitaire in the right Sidebar: one, two or four suits, five stock deals, undo and redo, hints, sound, and Microsoft-style scoring. The running game, your appearance choices and each difficulty record stay in this browser. Open it from the spade button at the sidebar foot, or from the Sidebar guide.","title":"Spider Solitaire","button.label":"Spider","button.tooltip":"Play Spider Solitaire","guide.title":"Spider Solitaire","guide.description":"Deal out 104 cards and clear all eight runs","difficulty":"Deal","difficulty.one-suit":"1 suit","difficulty.two-suits":"2 suits","difficulty.four-suits":"4 suits","score":"Score","moves":"Moves","time":"Time","runs":"Runs","newGame":"New game","undo":"Undo","redo":"Redo","hint":"Hint","sound.on":"Turn sound on","sound.off":"Turn sound off","deal":"Deal a row","dealCount":"{n} deals left","stats":"Statistics","close":"Close","card.back":"Face-down card","stats.played":"Games played","stats.won":"Games won","stats.rate":"Win rate","stats.bestScore":"Best score","stats.bestTime":"Best time","stats.bestMoves":"Fewest moves","stats.local":"Saved on this device only.","refuse.same":"That column already holds the run","refuse.unmovable":"Only a descending same-suit run can move","refuse.fit":"That card does not fit there","refuse.faceDown":"Face-down cards cannot move","refuse.stockEmpty":"No deals left","refuse.stockColumn":"Fill every empty column before dealing","refuse.finished":"The game is over — start a new one","refuse.lost":"No move and no deals left — start a new game","refuse.noTarget":"No column accepts this run","hint.none":"No move and no deals left","hint.deal":"No card can move — deal a row","win.title":"All eight runs cleared","win.again":"Play again","lose.title":"No moves left","lose.note":"The stock is empty and no card can move.","lose.again":"New game","settings":"Settings","settings.table":"Table","settings.back":"Card back","settings.local":"Saved on this device only.","table.green":"Green","table.blue":"Blue","table.red":"Red","table.charcoal":"Charcoal","back.classic":"Classic","back.ruby":"Ruby","back.violet":"Violet","back.midnight":"Midnight","meta.detail":"docs/DETAIL.md"}}
    const CSS = "/* Spider Solitaire board.\n *\n * Surface, ink and borders come from the host's `--dsw-alias-*` tokens so the\n * pane reads correctly in both themes. A card face is artwork: it keeps one\n * white sheet and fixed black/red pips in either theme, the way a physical card\n * does on a dark table.\n *\n * Card width and every card's `top` are computed by the board from its own\n * measured size, so the ten columns fit a narrow docked pane and a wide float\n * alike and a tall column compresses its faces instead of overflowing.\n */\n\n.sp-root {\n  --sp-gap: 6px;\n  --sp-radius: 7px;\n  /* The felt's own palette, so the table reads as a card table rather than as a\n   * panel: a deep green cloth, a darker rim where the cloth meets the rail, and\n   * the woven texture laid over both. */\n  --sp-felt: #2e8b63;\n  --sp-felt-deep: #237552;\n  --sp-felt-rim: #1a5c40;\n  --sp-felt-ink: rgba(255, 255, 255, 0.82);\n  --sp-felt-ink-dim: rgba(255, 255, 255, 0.55);\n  position: relative;\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  box-sizing: border-box;\n  min-width: 0;\n  min-height: 0;\n  height: 100%;\n  padding: 10px 12px 12px;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: 13px;\n  background: var(--dsw-alias-bg-base);\n}\n\n/* ---- table ------------------------------------------------------------ */\n\n/* The table is the cloth itself: a deep green that vignettes toward the rail,\n * with a fine weave over it and a hairline highlight where the cloth is stitched\n * in. It wraps the felt, the stock and the cleared-run row, so everything the\n * player touches sits on one surface. */\n.sp-table {\n  position: relative;\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  box-sizing: border-box;\n  min-width: 0;\n  min-height: 0;\n  padding: 10px 10px 8px;\n  overflow: hidden;\n  background-color: var(--sp-felt);\n  /* Two woven passes at a hairline scale give felt's grain without a texture\n   * image, and the radial vignette darkens the rail end where the eye rests. */\n  background-image:\n    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 3px),\n    repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px 3px),\n    radial-gradient(120% 90% at 50% 0%, rgba(255, 255, 255, 0.07) 0%, transparent 55%),\n    radial-gradient(140% 120% at 50% 115%, var(--sp-felt-rim) 0%, transparent 62%);\n  border: 1px solid var(--sp-felt-rim);\n  border-radius: 14px;\n  box-shadow:\n    inset 0 1px 0 rgba(255, 255, 255, 0.1),\n    inset 0 -18px 30px -18px rgba(0, 0, 0, 0.55),\n    0 2px 10px rgba(0, 0, 0, 0.22);\n}\n\n/* A stitched hairline just inside the rail, on the light-and-dark pair the\n * host's own surfaces use so the seam reads in both themes. */\n.sp-table::before {\n  content: '';\n  position: absolute;\n  inset: 6px;\n  border: 1px solid rgba(255, 255, 255, 0.09);\n  border-radius: 9px;\n  pointer-events: none;\n}\n\n/* The table's contents sit above the weave. */\n.sp-table > * {\n  position: relative;\n}\n\n/* ---- felt colours ----------------------------------------------------- */\n\n/* The felt is four variables, so a colour choice replaces the cloth without\n * touching the weave, the vignette, or anything drawn on it. Each palette keeps\n * the same relationship the default green has: a lit cloth, a deeper body a\n * step down, and a dark rail where it meets the table's edge. */\n.sp-table.sp-felt-blue {\n  --sp-felt: #2f6fa8;\n  --sp-felt-deep: #245a8a;\n  --sp-felt-rim: #1a4670;\n}\n\n.sp-table.sp-felt-red {\n  --sp-felt: #a63a50;\n  --sp-felt-deep: #8a2c3f;\n  --sp-felt-rim: #6b2233;\n}\n\n.sp-table.sp-felt-charcoal {\n  --sp-felt: #5a5d63;\n  --sp-felt-deep: #474a50;\n  --sp-felt-rim: #3a3d43;\n}\n\n/* ---- card-back colours ------------------------------------------------ */\n\n/* The back choice sets the ink and weave scale the shared card-back recipe\n * reads, so every back — tableau, stock, flight, cleared pile — repaints at\n * once and no two can drift apart. */\n.sp-table.sp-backs-classic {\n  --sp-back-ink: #2f68b0;\n  --sp-back-scale: 7px;\n}\n\n.sp-table.sp-backs-ruby {\n  --sp-back-ink: #b03050;\n  --sp-back-scale: 7px;\n}\n\n.sp-table.sp-backs-violet {\n  --sp-back-ink: #6444a0;\n  --sp-back-scale: 8px;\n}\n\n.sp-table.sp-backs-midnight {\n  --sp-back-ink: #33415c;\n  --sp-back-scale: 6px;\n}\n\n/* ---- head ------------------------------------------------------------- */\n\n.sp-head {\n  position: relative;\n  z-index: 20;\n  display: flex;\n  flex: 0 0 auto;\n  flex-direction: column;\n  gap: 8px;\n  padding-bottom: 10px;\n  border-bottom: 0.5px solid var(--dsw-alias-border-l1);\n  margin-bottom: 10px;\n}\n\n.sp-title-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.sp-title-group {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  min-width: 0;\n}\n\n.sp-title {\n  overflow: hidden;\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 1.3;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.sp-badge {\n  flex: none;\n  padding: 1px 7px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  line-height: 1.6;\n  background: var(--dsw-alias-bg-layer-2);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: 999px;\n}\n\n.sp-head-actions {\n  display: flex;\n  flex: none;\n  gap: 4px;\n  align-items: center;\n}\n\n.sp-icon-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 26px;\n  height: 26px;\n  padding: 0;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 14px;\n  line-height: 1;\n  background: transparent;\n  border: 0.5px solid transparent;\n  border-radius: var(--dsw-radius-xs);\n  cursor: pointer;\n}\n\n@media (hover: hover) {\n  .sp-icon-btn:hover {\n    color: var(--dsw-alias-label-primary);\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n\n.sp-icon-btn:focus-visible,\n.sp-tool:focus-visible,\n.sp-stock:focus-visible,\n.sp-menu-item:focus-visible,\n.sp-result-btn:focus-visible,\n.sp-dialog-close:focus-visible,\n.sp-foot-action:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n  outline-offset: 1px;\n}\n\n.sp-icon-on {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.sp-meta {\n  display: flex;\n  gap: 14px;\n  align-items: baseline;\n}\n\n.sp-meta-item {\n  display: flex;\n  gap: 4px;\n  align-items: baseline;\n  min-width: 0;\n}\n\n.sp-meta-label {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n}\n\n.sp-meta-value {\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n  font-weight: 500;\n}\n\n/* The tool row: four square buttons on one baseline, then the status line. The\n * buttons share a 30px box, a 1px inset highlight and a soft shadow, so the row\n * reads as a set of controls rather than as loosely spaced glyphs. */\n.sp-tools {\n  display: flex;\n  gap: 6px;\n  align-items: center;\n}\n\n.sp-tool {\n  display: inline-flex;\n  flex: none;\n  align-items: center;\n  justify-content: center;\n  box-sizing: border-box;\n  width: 30px;\n  height: 30px;\n  padding: 0;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  background: var(--dsw-alias-bg-layer-1);\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-sm);\n  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2), inset 0 1px 0 rgba(255, 255, 255, 0.5);\n  cursor: pointer;\n  transition: color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease, transform 0.08s ease;\n}\n\n@media (hover: hover) {\n  .sp-tool:not(:disabled):hover {\n    color: var(--dsw-alias-label-primary);\n    background: var(--dsw-alias-interactive-bg-hover-solid);\n    border-color: var(--dsw-alias-border-l4);\n  }\n}\n\n/* A press sinks the button a fraction, so the click has physical feedback. */\n.sp-tool:not(:disabled):active {\n  background: var(--dsw-alias-interactive-bg-active);\n  box-shadow: inset 0 1px 2px var(--dsw-alias-bg-mask-2);\n  transform: translateY(0.5px);\n}\n\n.sp-tool:disabled {\n  color: var(--dsw-alias-label-dimmed);\n  background: transparent;\n  border-color: var(--dsw-alias-border-l1);\n  box-shadow: none;\n  cursor: default;\n}\n\n/* A toggle in its on state: the accent border and ink say \"this is active\". */\n.sp-tool-on,\n.sp-tool-on:not(:disabled):hover {\n  color: var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n  background: var(--dsw-alias-interactive-bg-active);\n  border-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n}\n\n.sp-tool svg {\n  display: block;\n}\n\n/* The New game button is the row's primary action: the same square as the icon\n * tools beside it, filled with the primary ink so it is found at a glance. Its\n * name lives in the accessible label and the tooltip. */\n.sp-new {\n  display: inline-flex;\n  flex: none;\n  align-items: center;\n  justify-content: center;\n  box-sizing: border-box;\n  width: 30px;\n  height: 30px;\n  padding: 0;\n  color: var(--dsw-alias-label-primary-foreground);\n  font: inherit;\n  background: var(--dsw-alias-button-primary-fill);\n  border: 0.5px solid transparent;\n  border-radius: var(--dsw-radius-sm);\n  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-2);\n  cursor: pointer;\n  transition: background-color 0.12s ease, transform 0.08s ease;\n}\n\n@media (hover: hover) {\n  .sp-new:hover {\n    background: var(--dsw-alias-button-primary-hover);\n  }\n}\n\n.sp-new:active {\n  transform: translateY(0.5px);\n}\n\n.sp-new:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n  outline-offset: 1px;\n}\n\n.sp-new svg {\n  display: block;\n}\n\n/* A hairline separates the primary action from the icon tools beside it. */\n.sp-tools-sep {\n  flex: none;\n  width: 1px;\n  height: 18px;\n  margin: 0 2px;\n  background: var(--dsw-alias-border-l2);\n}\n\n/* The status line takes the row's remaining width and never pushes the buttons. */\n.sp-tools-gap {\n  flex: 1;\n  min-width: 0;\n}\n\n.sp-status {\n  overflow: hidden;\n  color: var(--dsw-alias-state-warn-label);\n  font-size: 11px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* The new-game menu drops under the header's actions. */\n.sp-menu {\n  position: absolute;\n  top: 28px;\n  right: 0;\n  z-index: 40;\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 180px;\n  padding: 6px;\n  background: var(--dsw-alias-bg-overlay);\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  box-shadow: 0 8px 24px var(--dsw-alias-bg-mask-2);\n}\n\n.sp-menu-head {\n  padding: 4px 8px 6px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n}\n\n.sp-menu-item {\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 6px 8px;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 13px;\n  text-align: left;\n  background: transparent;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  cursor: pointer;\n}\n\n@media (hover: hover) {\n  .sp-menu-item:hover {\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n\n.sp-menu-on {\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.sp-menu-suits {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n}\n\n/* ---- board ------------------------------------------------------------ */\n\n/* The tableau takes the remaining height; each column is a positioned box whose\n * cards carry explicit tops, and the columns sit flush with the pane's edges. */\n.sp-board {\n  position: relative;\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow: hidden;\n  touch-action: none;\n}\n\n.sp-tableau {\n  display: grid;\n  grid-template-columns: repeat(10, minmax(0, 1fr));\n  gap: var(--sp-gap);\n  height: 100%;\n}\n\n.sp-col {\n  position: relative;\n  min-width: 0;\n  height: 100%;\n  border-radius: var(--sp-radius);\n}\n\n/* An empty column is a slot printed on the cloth: a shaded well rather than a\n * theme border, so it reads as part of the table at every theme. */\n.sp-col-empty::before {\n  content: '';\n  position: absolute;\n  top: 0;\n  left: 0;\n  box-sizing: border-box;\n  width: 100%;\n  aspect-ratio: 5 / 7;\n  background: rgba(0, 0, 0, 0.1);\n  border: 1px dashed rgba(255, 255, 255, 0.2);\n  border-radius: var(--sp-radius);\n}\n\n/* The drop target lifts out of the cloth: a lighter well with a bright rim. */\n.sp-col-drop::before {\n  content: '';\n  position: absolute;\n  top: -2px;\n  left: -2px;\n  z-index: 0;\n  box-sizing: border-box;\n  width: calc(100% + 4px);\n  aspect-ratio: 5 / 7;\n  background: rgba(255, 255, 255, 0.16);\n  border: 1.5px solid rgba(255, 255, 255, 0.75);\n  border-radius: calc(var(--sp-radius) + 2px);\n  box-shadow: 0 0 12px rgba(255, 255, 255, 0.18);\n}\n\n.sp-col-hint::after {\n  content: '';\n  position: absolute;\n  top: -3px;\n  left: -3px;\n  width: calc(100% + 6px);\n  height: calc(100% + 6px);\n  border: 1.5px solid #ffd75e;\n  border-radius: calc(var(--sp-radius) + 3px);\n  box-shadow: 0 0 10px rgba(255, 215, 94, 0.35);\n  pointer-events: none;\n  animation: sp-pulse 1s ease-in-out infinite;\n}\n\n@keyframes sp-pulse {\n  0%, 100% { opacity: 0.2; }\n  50% { opacity: 0.85; }\n}\n\n/* ---- deal flight ------------------------------------------------------ */\n\n/* The flying cards sit above the tableau on their own layer, which takes no\n * clicks: a stray press mid-flight must reach the real cards underneath. The\n * layer is the felt's child, so the coordinates measured for each flight are\n * the ones used to place it. */\n.sp-fly-layer {\n  position: absolute;\n  inset: 0;\n  z-index: 55;\n  pointer-events: none;\n}\n\n.sp-fly {\n  position: absolute;\n  top: 0;\n  left: 0;\n  width: var(--sp-fly-w);\n  height: var(--sp-fly-h);\n  /* In flight the card is lifted off the table, so it carries the one shadow a\n   * back does not: the shared recipe supplies the rest. */\n  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);\n  transform-origin: top left;\n  transition-property: transform;\n  transition-timing-function: cubic-bezier(0.32, 0.72, 0.24, 1);\n  will-change: transform;\n}\n\n/* A landed card is a touch flatter, so the eye reads it as settled rather than\n * still hovering over the pile. */\n.sp-fly-arrived {\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);\n}\n\n/* ---- cards ------------------------------------------------------------ */\n\n/* Every size on a face is a share of the card itself, in `cq` units of the\n * card's own container: a 24px card in a narrow dock and a 56px card in a wide\n * float both keep a legible corner and a centred pip instead of spilling the\n * same fixed 10px glyph over a small face. */\n.sp-card {\n  position: absolute;\n  left: 0;\n  container-type: size;\n  box-sizing: border-box;\n  width: 100%;\n  aspect-ratio: 5 / 7;\n  margin: 0;\n  overflow: hidden;\n  color: #1b1b1f;\n  font-family: var(--dsw-font-family);\n  background: #fdfdfb;\n  border: 0.5px solid rgba(0, 0, 0, 0.24);\n  border-radius: var(--sp-radius);\n  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.16);\n  user-select: none;\n  -webkit-user-select: none;\n}\n\n.sp-red {\n  color: #c8102e;\n}\n\n/* The corner reads rank and suit side by side, not stacked: a covered card may\n * show only its top strip, and one row of large lettering fits in that strip\n * where a stacked rank-over-suit would push the suit out of sight. */\n.sp-corner {\n  position: absolute;\n  top: 2px;\n  left: 3px;\n  display: flex;\n  flex-direction: row;\n  gap: 1px;\n  align-items: baseline;\n  font-size: clamp(11px, 40cqw, 19px);\n  font-weight: 650;\n  letter-spacing: -0.02em;\n  line-height: 1;\n}\n\n/* The bottom index mirrors the top one: the same rank and suit, rotated to face\n * the other way. It is anchored to the bottom-right corner by right/bottom, and\n * its width is its content, so the corner it measures from is stable on every\n * card width — a shrinking flex box would drag its `left` back toward the top\n * index on the narrowest faces. */\n.sp-corner-br {\n  top: auto;\n  right: 3px;\n  bottom: 2px;\n  left: auto;\n  width: max-content;\n  flex-direction: row-reverse;\n  transform: rotate(180deg);\n}\n\n.sp-suit {\n  font-size: clamp(9px, 34cqw, 16px);\n  line-height: 1;\n}\n\n/* The centre pip sits in the middle of the face, clear of both corner indexes:\n * without its own positioning it would fall into the top-left corner and read\n * as a second suit glyph beside the rank. */\n.sp-pip {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  font-size: clamp(9px, 44cqw, 28px);\n  line-height: 1;\n  opacity: 0.9;\n  transform: translate(-50%, -50%);\n}\n\n/* On the narrowest docked panes a card is about 19px wide and the two index\n * rows plus a centre pip cannot all fit. The pip steps aside there, and the\n * mirrored bottom index follows on faces too small to hold it at its corner:\n * the top index alone still names the card, and a squeezed second glyph only\n * muddles the face. */\n@container (max-width: 26px) {\n  .sp-pip {\n    display: none;\n  }\n}\n\n@container (max-width: 22px) {\n  .sp-corner-br {\n    display: none;\n  }\n}\n\n/* A selected run reads on the strip each card leaves uncovered, not on its\n * outline: the cards stack, so an outline sits under the next card and only the\n * bottom of the pile would show it. Each selected card therefore gains a tinted\n * face and a bar along its top edge, which is exactly the part the player sees. */\n.sp-card-selected {\n  background: #f2fbf4;\n}\n\n.sp-card-selected::after {\n  content: '';\n  position: absolute;\n  top: 0;\n  right: 0;\n  left: 0;\n  height: 3px;\n  background: var(--dsw-alias-state-success-primary);\n  border-radius: 2px 2px 0 0;\n  pointer-events: none;\n}\n\n/* A dark theme keeps the same signal: the tint goes deeper instead of lighter. */\nbody[data-ds-dark-theme] .sp-card-selected {\n  background: #e8f6ec;\n}\n\n/* The pile's last card owns its full outline, so the selection also reads as a\n * closed shape at the end of the run. */\n.sp-card-selected.sp-card-selected-last {\n  box-shadow: 0 0 0 2px var(--dsw-alias-state-success-primary), 0 2px 6px rgba(0, 0, 0, 0.22);\n}\n\n.sp-card-lifted {\n  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.34);\n  cursor: grabbing;\n  will-change: transform;\n}\n\n.sp-card:not(.sp-back) {\n  cursor: grab;\n}\n\n/* A back is a blue sheet with a hairline inset, drawn from the same corner\n * radius as a face so a dealt stack reads as one pile. */\n/* ---- card backs ------------------------------------------------------- */\n\n/* One card-back recipe for every place a back is drawn: a face-down card in a\n * column, a card in the stock, a card in flight, and a cleared run's slot. The\n * pattern, radius, rim and shadow are declared once here so no pile looks like a\n * different deck from the row beside it. Only elevation differs, and the layer\n * that needs it adds a shadow of its own. */\n.sp-back,\n.sp-stock-back,\n.sp-fly {\n  box-sizing: border-box;\n  /* The colour and the weave's scale are variables so a card-back choice\n   * repaints every back at once; the two gradients keep the cloth's weave. */\n  background:\n    linear-gradient(135deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%) 0 0 / var(--sp-back-scale, 7px) var(--sp-back-scale, 7px),\n    linear-gradient(315deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%) 0 0 / var(--sp-back-scale, 7px) var(--sp-back-scale, 7px),\n    var(--sp-back-ink, #2f68b0);\n  border: 0.5px solid rgba(0, 0, 0, 0.35);\n  border-radius: var(--sp-radius);\n  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.16);\n}\n\n/* The hairline inset every back carries, drawn with a pseudo-element so a stock\n * card and a tableau card cannot drift apart: all get the same ring at the same\n * inset. */\n.sp-back::before,\n.sp-stock-back::before,\n.sp-fly::before,\n.sp-run-done::before {\n  content: '';\n  position: absolute;\n  inset: 2px;\n  border: 1px solid rgba(255, 255, 255, 0.28);\n  border-radius: calc(var(--sp-radius) - 2px);\n  pointer-events: none;\n}\n\n/* A narrow docked pane leaves a 24px card, so the strip a covered card shows is\n * the card's own top edge: a soft shadow above each face-up card separates the\n * piles and marks where one card ends and the next begins. */\n.sp-card[data-rank] {\n  box-shadow: 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 1px rgba(0, 0, 0, 0.16);\n}\n\n/* ---- cleared runs and the stock -------------------------------------- */\n\n/* The foot is one row: the eight cleared-run slots at the left, the stock a\n * short step in from the right edge, so the row reads as one table rather than\n * a pile stranded in the corner. Both piles draw at the tableau's card size;\n * on a pane too narrow to fit eight cards plus the stock, the slots give way\n * first so the stock keeps its full card width. */\n.sp-foot {\n  display: flex;\n  flex: 0 0 auto;\n  gap: 10px;\n  align-items: flex-end;\n  justify-content: space-between;\n  min-width: 0;\n  padding-top: 8px;\n  padding-right: 4px;\n}\n\n/* The cleared runs stack their progress label under the eight slots, so the\n * slots use the row's full width and all eight sit at card width. */\n.sp-run-area {\n  display: flex;\n  flex: 1 1 auto;\n  flex-direction: column;\n  gap: 4px;\n  align-items: flex-start;\n  min-width: 0;\n}\n\n.sp-run-label {\n  flex: none;\n  color: var(--sp-felt-ink-dim);\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n  line-height: 1;\n}\n\n/* Eight slots at one card's width each, so a cleared run draws as the card it\n * cleared. Each column takes an equal share of the row, capped at a card's\n * width: the slots sit at card size whenever the pane holds them, and shrink\n * together — never into the stock — when it does not. The cap subtracts the\n * row's own gaps, so all eight land on card width at once. */\n.sp-foundation {\n  display: grid;\n  flex: 1 1 auto;\n  align-self: stretch;\n  width: 100%;\n  grid-template-columns: repeat(8, minmax(0, 1fr));\n  gap: 4px;\n  min-width: 0;\n  max-width: calc(8 * var(--sp-run-w) + 7 * 4px);\n}\n\n/* An untouched slot is printed on the cloth, like an empty column. */\n.sp-run {\n  display: flex;\n  box-sizing: border-box;\n  width: 100%;\n  height: var(--sp-run-h);\n  align-items: center;\n  justify-content: center;\n  color: var(--sp-felt-ink-dim);\n  font-size: 13px;\n  background: rgba(0, 0, 0, 0.08);\n  border: 1px dashed rgba(255, 255, 255, 0.18);\n  border-radius: var(--sp-radius);\n}\n\n/* A cleared run's slot holds one cleared card, so it wears the same back as the\n * rest of the deck. `.sp-run` paints the empty-slot well at the same\n * specificity and comes later in the sheet, so the pile restates the back here;\n * the two must stay in step, and that is the reason this one selector repeats\n * the recipe rather than joining the shared list above. */\n.sp-run.sp-run-done {\n  position: relative;\n  background:\n    linear-gradient(135deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%) 0 0 / var(--sp-back-scale, 7px) var(--sp-back-scale, 7px),\n    linear-gradient(315deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%) 0 0 / var(--sp-back-scale, 7px) var(--sp-back-scale, 7px),\n    var(--sp-back-ink, #2f68b0);\n  border: 0.5px solid rgba(0, 0, 0, 0.35);\n  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.16);\n  color: #fdfdfb;\n  font-size: clamp(12px, 46cqw, 22px);\n}\n\n/* Hearts and diamonds keep their red on the back, as a cleared run of that suit\n * would on a real table. The tone is the card face's red, lightened enough to\n * read against the blue back. */\n.sp-run.sp-run-done.sp-red-run {\n  color: #ff8a8a;\n}\n\n/* The completed-run glyph is a share of its own card, so it stays centred and\n * proportional at every pane width. */\n.sp-run {\n  container-type: inline-size;\n}\n\n/* The stock: a real card's footprint at the board's right edge. Rounds stack\n * with a small offset, so the remaining deals read as a pile's depth. */\n.sp-stock {\n  position: relative;\n  flex: none;\n  box-sizing: border-box;\n  width: calc(var(--sp-stock-w) + 4 * max(3px, calc(var(--sp-stock-w) * 0.08)));\n  height: calc(var(--sp-stock-h) + 4 * max(1px, calc(var(--sp-stock-h) * 0.02)));\n  padding: 0;\n  background: transparent;\n  border: 0;\n  border-radius: var(--sp-radius);\n  cursor: pointer;\n}\n\n.sp-stock:disabled {\n  cursor: default;\n}\n\n.sp-stock-back {\n  position: absolute;\n  width: var(--sp-stock-w);\n  height: var(--sp-stock-h);\n}\n\n@media (hover: hover) {\n  .sp-stock:not(:disabled):hover .sp-stock-back:last-of-type {\n    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3);\n  }\n}\n\n.sp-stock-empty {\n  width: var(--sp-stock-w);\n  height: var(--sp-stock-h);\n  border: 1px dashed rgba(255, 255, 255, 0.2);\n}\n\n/* The hint points at the stock when no card can move: the pile lifts off the\n * cloth with a gold ring, the same ink the hint uses on a column. */\n.sp-stock-hint .sp-stock-back:last-of-type,\n.sp-stock-hint .sp-stock-recycle {\n  box-shadow: 0 0 0 2px #ffd75e, 0 0 14px rgba(255, 215, 94, 0.55);\n}\n\n.sp-stock-hint {\n  animation: sp-pulse 1s ease-in-out infinite;\n}\n\n.sp-stock-recycle {\n  position: absolute;\n  inset: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 18px;\n  border: 1px dashed var(--dsw-alias-border-l3);\n  border-radius: var(--sp-radius);\n}\n\n/* ---- statistics dialog ------------------------------------------------ */\n\n.sp-modal {\n  position: absolute;\n  inset: 0;\n  z-index: 80;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n  background: var(--dsw-alias-bg-mask-1);\n}\n\n.sp-dialog {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  box-sizing: border-box;\n  width: min(280px, 100%);\n  padding: 14px;\n  background: var(--dsw-alias-bg-layer-1);\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-md);\n  box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);\n}\n\n.sp-dialog-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n\n.sp-dialog-title {\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.sp-dialog-close {\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 15px;\n  line-height: 1;\n  background: transparent;\n  border: 0;\n  border-radius: var(--dsw-radius-xs);\n  cursor: pointer;\n}\n\n@media (hover: hover) {\n  .sp-dialog-close:hover {\n    color: var(--dsw-alias-label-primary);\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n\n.sp-dialog-sub {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n}\n\n.sp-stats {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n}\n\n.sp-stats-row {\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  justify-content: space-between;\n  padding: 5px 0;\n  border-bottom: 0.5px solid var(--dsw-alias-border-l1);\n}\n\n.sp-stats-name {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n}\n\n.sp-stats-value {\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n  font-weight: 500;\n}\n\n.sp-dialog-note {\n  margin: 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  line-height: 1.5;\n}\n\n/* ---- settings --------------------------------------------------------- */\n\n.sp-set-group {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.sp-set-title {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  font-weight: 500;\n}\n\n/* A row of swatches, each a small sample of what it selects: the felt swatches\n * paint the table's own gradient, the back swatches the card-back recipe, so a\n * choice is made by eye rather than by name. */\n.sp-set-row {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.sp-swatch {\n  position: relative;\n  display: flex;\n  align-items: flex-end;\n  justify-content: center;\n  box-sizing: border-box;\n  aspect-ratio: 3 / 4;\n  padding: 3px;\n  overflow: hidden;\n  font: inherit;\n  border: 1.5px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-xs);\n  cursor: pointer;\n}\n\n.sp-swatch:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n  outline-offset: 1px;\n}\n\n/* The pick carries a ring and lifts a step, so the current choice is unmistakable\n * against three unselected neighbours. */\n.sp-swatch-on {\n  border-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary-new-colorprimary-new-color);\n}\n\n.sp-swatch-label {\n  overflow: hidden;\n  max-width: 100%;\n  padding: 0 2px;\n  color: #fff;\n  font-size: 9px;\n  line-height: 1.3;\n  text-align: center;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);\n}\n\n/* Felt samples: the same four colour pairs the table defines. */\n.sp-table-swatch-green { background: linear-gradient(160deg, #2e8b63, #237552); }\n.sp-table-swatch-blue { background: linear-gradient(160deg, #2f6fa8, #245a8a); }\n.sp-table-swatch-red { background: linear-gradient(160deg, #a63a50, #8a2c3f); }\n.sp-table-swatch-charcoal { background: linear-gradient(160deg, #5a5d63, #474a50); }\n\n/* Back samples: the shared card-back recipe in each colour. */\n.sp-back-swatch-classic,\n.sp-back-swatch-ruby,\n.sp-back-swatch-violet,\n.sp-back-swatch-midnight {\n  background-image:\n    linear-gradient(135deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%),\n    linear-gradient(315deg, rgba(255, 255, 255, 0.16) 25%, transparent 25%);\n  background-size: 7px 7px, 7px 7px;\n}\n\n.sp-back-swatch-classic { background-color: #2f68b0; }\n.sp-back-swatch-ruby { background-color: #b03050; }\n.sp-back-swatch-violet { background-color: #6444a0; }\n.sp-back-swatch-midnight { background-color: #33415c; }\n\n/* ---- result overlay --------------------------------------------------- */\n\n/* One card stands over the board at either end of a game: the win's spade on\n * accent ink, or the dead end's cross on the warning ink. */\n.sp-win {\n  position: absolute;\n  inset: 0;\n  z-index: 70;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 16px;\n  background: var(--dsw-alias-bg-mask-1);\n}\n\n/* The fireworks canvas fills the overlay under the result card: the display\n * plays behind the card rather than over it, so scores stay readable. */\n.sp-fireworks {\n  position: absolute;\n  inset: 0;\n  z-index: 0;\n  display: block;\n  width: 100%;\n  height: 100%;\n  pointer-events: none;\n}\n\n.sp-result-card {\n  position: relative;\n  z-index: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  align-items: center;\n  box-sizing: border-box;\n  width: min(260px, 100%);\n  padding: 20px 16px;\n  text-align: center;\n  background: var(--dsw-alias-bg-layer-1);\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-lg);\n  box-shadow: 0 12px 32px var(--dsw-alias-bg-mask-2);\n}\n\n.sp-result-mark {\n  color: var(--dsw-alias-state-success-primary);\n  font-size: 30px;\n  line-height: 1;\n}\n\n.sp-result-title {\n  font-size: 15px;\n  font-weight: 600;\n}\n\n.sp-result-note {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 1.5;\n}\n\n.sp-result-body {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  font-variant-numeric: tabular-nums;\n}\n\n.sp-result-btn {\n  margin-top: 4px;\n  padding: 6px 16px;\n  color: var(--dsw-alias-label-primary-foreground);\n  font: inherit;\n  font-size: 12px;\n  background: var(--dsw-alias-button-primary-fill);\n  border: 0;\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n}\n\n/* A dead end reads in the warning ink, so it never looks like a win. */\n.sp-win-lost .sp-result-mark {\n  color: var(--dsw-alias-state-warn-primary);\n}\n\n/* ---- sidebar foot ----------------------------------------------------- */\n\n.sp-foot-action {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  box-sizing: border-box;\n  width: 100%;\n  padding: 6px 8px;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 13px;\n  text-align: left;\n  background: transparent;\n  border: 0.5px solid transparent;\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n}\n\n@media (hover: hover) {\n  .sp-foot-action:hover {\n    color: var(--dsw-alias-label-primary);\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n\n.sp-foot-text {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n"

    /** Copy lookup outside a slot component, against the live locale. */
    function translate(key, params) {
      return translateRef.current(key, params)
    }

    /** Open the game tab, reporting a refusal instead of throwing into the shell. */
    function openGame() {
      try {
        pluginCtx?.get('sidebarRight')?.openTab(KIND)
      } catch (error) {
        console.error('[spider] failed to open the game tab', error?.message ?? String(error))
      }
    }

    /** The sidebar-foot action that opens the game. */
    function FooterButton(props) {
      const wide = props?.wide !== false
      return h('button', {
        type: 'button',
        className: 'sp-foot-action',
        title: translate('button.tooltip'),
        'aria-label': translate('button.tooltip'),
        onClick: () => { openGame() },
      },
        h(FootMark, { size: 16 }),
        wide ? h('span', { className: 'sp-foot-text' }, translate('button.label')) : null,
      )
    }

    return {
      // Only injected services are reachable through this Client's `ctx.get`;
      // naming them keeps the plugin parked, not crashing, without the Sidebar.
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        pluginCtx = ctx
        const locale = ctx.get('locale')
        if (locale !== undefined) {
          ctx.effect(() => locale.register(NS, 'zh', DICTS.zh), 'spider: zh dictionary')
          ctx.effect(() => locale.register(NS, 'en', DICTS.en), 'spider: en dictionary')
          ctx.effect(() => {
            translateRef.current = locale.bind(NS)
            return () => { translateRef.current = key => key }
          }, 'spider: translator')
        }
        // One owned style element: inserting and removing it is the whole lifecycle.
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = TAB_ID
          tag.textContent = CSS
          document.head.append(tag)
          return () => { tag.remove() }
        }, 'spider: stylesheet')

        const tabs = ctx.get('sidebarRightTabs')
        if (tabs?.register !== undefined) {
          // A page type: no address patterns, opened by kind from the foot action
          // and from its guide card.
          ctx.effect(() => tabs.register({
            id: TAB_ID,
            kind: KIND,
            multiple: false,
            title: () => translate('title'),
            guide: [{
              id: 'spider',
              order: 40,
              title: () => translate('guide.title'),
              description: () => translate('guide.description'),
              icon: FootMark,
            }],
          }), 'spider: tab type')
        }
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
          Board,
        )), 'spider: tab body')
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'spider', order: 5, label: () => translate('button.label') },
          FooterButton,
        )), 'spider: footer action')
      },
    }
  },
})
