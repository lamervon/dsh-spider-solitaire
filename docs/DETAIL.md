# Spider Solitaire

A complete Spider Solitaire for the DeepSeek Harness right Sidebar. The board docks beside the conversation, floats, or goes fullscreen with the rest of the column, so a hand can be played while an agent works.

## Playing

The deck is 104 cards dealt into ten columns: six in the first four, five in the rest, all but each column's last card face down. Five stock rounds remain. Build descending runs in one suit and clear all eight king-to-ace runs to win.

- **Drag** a run onto a column whose top card is one rank higher, in any suit, or onto an empty column.
- **Click** a run to select it, then click the destination column. This works with a trackpad and needs no drag.
- **Double click** a run to send it to its first legal home.
- **Grab** any card and the whole same-suit run below it comes with it, so a descent can be split at any card.
- **Stock** (bottom right) deals one card onto every column; every column must be occupied first.

## Scoring

Microsoft's Spider scoring: the game opens at 500, each move scores 1, and each completed king-to-ace run scores 100. One, two and four suit difficulties are offered.

## Ending a game

A game ends two ways. Clearing the eighth run wins with fireworks behind the result card. A board with no legal move and an empty stock is a dead end, reported honestly and counted as a loss. In both cases the result card offers a new deal.

## Sound and appearance

- **Sound**: deal, move, run cleared, win and refused move are synthesized at play time with Web Audio, so no audio files ship and nothing is requested from the network. The toolbar's speaker button turns them off.
- **Appearance**: the settings button offers four felt colours and four card-back colours, so the table can be read in either theme or matched to taste.

## What stays on this device

The running board, the last difficulty, the sound choice, the appearance choices and per-difficulty statistics all live in this browser's local storage under the `dsh.spider.` prefix. A reload resumes the same board.

Nothing is sent anywhere: the bundle has no working Host half, makes no network request and no model request. Clearing the site data resets the board and the statistics.

## Removing it

Disabling or removing the bundle takes away the tab type, the sidebar-foot button and the guide card. The stored game and statistics remain, so re-enabling resumes where the game left off.
