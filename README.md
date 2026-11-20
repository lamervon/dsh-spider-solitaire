# Spider Solitaire

[![Install with DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-plugin-4c6ef5)](https://github.com/lamervon/dsh-spider-solitaire)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Play classic Spider Solitaire inside the right Sidebar of DeepSeek Harness: deep-finish the board while an agent works, and come back to the game after a reload because the board and your statistics stay on this device.

## Install

This is a DeepSeek Harness plugin bundle. Install it from GitHub in **Plugins** → **Add plugin** by entering either spec:

```
github:lamervon/dsh-spider-solitaire
```

```
git@github.com:lamervon/dsh-spider-solitaire.git
```

It requires DeepSeek Harness 0.2.x (`>=0.2.0-rc.1 <0.3.0`); the Plugin Manager refuses the install on a host outside that range.

To track a moving branch rather than the default, pin it: `github:lamervon/dsh-spider-solitaire#main`.

To install from a checkout instead, pick the folder with **Add plugin** → local directory.

After it is enabled, open the game from the spade button at the sidebar foot.

**Note on the package name:** the plugin is `@lamervon/dsh-spider-solitaire`. It began as `@local/dsh-spider-solitaire`; an earlier local install under that name is not upgraded by the GitHub install, so remove it first (**Plugins** → the `@local/...` row → remove) and then install the GitHub spec.

## Where to find it

- **Sidebar foot**: the spade button beside Settings opens the game in the right Sidebar.
- **Sidebar guide**: a **Spider Solitaire** card in the right panel's guide page opens the same tab.

The game is a right-Sidebar page tab, so it docks beside the conversation, floats, or goes fullscreen with the rest of the column.

## How to play

104 cards are dealt into ten columns. Build descending runs in one suit and complete eight king-to-ace runs to win. The game ends either way: all eight runs cleared is a win, and a board with no legal move and an empty stock is a dead end that the result card reports and counts as a loss.

- **Drag** a card or run onto a column whose top card is one rank higher (any suit), or onto an empty column.
- **Click** a movable run to select it, then click the destination column to move it. This is the trackpad- and keyboard-friendly path.
- **Stock** in the bottom left deals one card onto every column; every column must hold a card first.
- **Undo**, **Redo** and **Hint** sit in the toolbar. A hint outlines the suggested run and column; when no card can move, it highlights the stock instead, pointing at the deal. A hint on a board with no move and no stock left ends the game.

## Languages

The interface ships in English and Chinese and follows the Harness language setting, switching live without a reload. Every string goes through the locale registry: the board's labels and dialogs, the toolbar's accessible names, the sidebar-foot button, and the guide card. The plugin's title, description and detail page resolve per language too, both in Plugin Manager and on the bundle page.

The two dictionaries live in `locale/en.json` and `locale/zh.json`. They carry one identical key set, which `src/test.mjs` and the build both enforce, so a missing translation fails the build rather than showing a raw key.

## Sound

The board voices its own events: a soft slide as a run lands, a rustle when the stock deals, a rising arpeggio when a king-to-ace run clears, a fanfare for the last one, and a short warning tone when the rules refuse a move. The cues are synthesized with Web Audio at play time, so the bundle ships no audio files and makes no network request. The ♫ button in the toolbar turns them off, and the choice is remembered on this device. Browsers keep audio asleep until you interact with the page, so the first cue you hear follows your first click or drag.

## Difficulty and scoring

One, two or four suits, chosen from the ↻ menu in the header. Scoring follows Microsoft's Spider: the game opens at **500**, each move scores **1**, and each completed king-to-ace run scores **100**.

## What is saved

Everything is stored in this browser's local storage, under the `dsh.spider.` prefix:

- the game in progress, so a reload resumes the same board;
- the last difficulty chosen;
- whether the sound is on;
- per-difficulty statistics: games played, games won, win rate, best score, best time and fewest moves.

Nothing is sent anywhere: there is no Host half beyond the empty bundle entry, no network request, and no model request. Clearing site data for the Harness page resets both the board and the statistics.

## Switching it off

Disabling or removing the bundle removes the tab type, the foot button and the guide card. The saved board and statistics stay in local storage, so re-enabling resumes where you left off.

## Development

`src/client.tpl.js` is the browser module template; `src/build.mjs` inlines the two locale dictionaries and `src/styles.css` into `client.js`, which the profile loads. `node src/test.mjs` checks the rules, scoring, serialization and copy parity; the `.harness/` pages mount the real board in a browser for layout and interaction checks.

```sh
node src/build.mjs                       # regenerate client.js after editing src/
node src/test.mjs                        # rules, scoring, storage and copy parity
node .harness/play.mjs                   # interaction checks in headless Chrome
```

The harness pages load over a local HTTP server rooted at the package directory, because the module loader needs `client.js` to resolve as a URL:

```sh
python -m http.server 8791 --bind 127.0.0.1
```

## License

[MIT](LICENSE).

