---
title: Scrum blocks on the dashboard
summary: What each Scrum block shows on the dashboard and on a project page, the settings they have, and what clicking does.
module: scrum
capability: scrum.tasks.read
keywords: [dashboard, widget, my board, in progress, overdue, waiting on client, board mix, cycle scatter, aging, open cards, delivery rhythm]
updated: 2026-10-23
---

Scrum contributes eleven blocks to the dashboard and one to every project page. Everyone can place them. They need `scrum.tasks.read`.

## Whose cards

Most blocks have a setting **Whose work**: **Mine and unassigned** (the default) or **Everyone**. "Mine" means assigned to you, plus cards nobody has taken. The flow blocks have a **Project** setting instead.

## Counters

Each is a number with a note. Clicking opens **All work** (`/work`).

| Block | Counts | Note |
|---|---|---|
| **In progress** | Cards in a "Being worked on" column | How many projects they span |
| **Waiting on a client** | Cards in a "Waiting on someone else" column | Age of the longest, warning from 7 days |
| **Overdue** | Cards with a due date in the past | Danger colour when any |

## Lists

- **Doing**: the cards in progress by name, each a link. When there are none: "Nothing in progress." with a link to the board.
- **Waiting on someone else**: cards with a client, each with days in the column and a button **→** *next column* that moves it on. "The waiting is not yours. Moving it on, once they come back, is."
- **Board mix**: a ring of cards by done, to do, in progress and waiting. Opens the board.
- **My board**: one project at a glance: a tile per column with its card count and either total estimate or, for a waiting column, the oldest wait; **Needs a move from you** (up to three blocked, waiting or seven-days-old cards), each with **Unblock** or **Move to** *next column*; and, with a running sprint, a bar "Xh of Yh · day N of M" with "behind" when behind pace. It shows the project you pick in its settings, otherwise the one where you have the most open work. Clicking opens that board.

## Flow blocks

All need a **Project** in their settings, and several hide from the picker until a project has enough history. Clicking opens that project's **Flow** tab.

| Block | Shows | Appears once |
|---|---|---|
| **How long cards actually take** | Each finished card as a dot, with a line at the slow end when there is enough data | 12 finished cards |
| **What is going stale** | Unfinished cards, oldest first, against how long finished ones took | 8 finished cards |
| **Work that came back** | Number of cards finished then reopened | 1 reopened card |
| **Delivery rhythm** | Finished cards per week as a grid | 10 finished cards |

## On a project page

**Open cards**: up to eight unfinished cards of that project, each a link with its column and an "overdue" mark. Clicking the block opens the project's board.

## Good to know

- The counters and lists leave out completed cards. **My board** includes them so it can count the done column.
- The next-column and **Unblock** buttons act at once, with no confirmation, and a move from here does not show the WIP or hours warnings.
- "Being worked on" and "Waiting on someone else" come from each column's **Flow** setting, not its name. See [Change the columns](help:scrum/columns-and-definitions).
- Place and size blocks from the dashboard. See [the dashboard](help:shell/index).
