---
title: Open and edit a card
summary: The card popup on the board, with all its fields, subtasks, discussion and history.
module: scrum
paths: [/board]
capability: scrum.tasks.write
keywords: [card, task, edit, popup, modal, assignee, priority, estimate, due date, description, comments, history, sprint]
updated: 2026-10-23
---

Click a card's title on the board to open it as a popup. Everything you change is saved at once.

## Steps

1. Click the card title. The popup shows the card; the board stays behind it.
2. Use the arrows **‹** and **›** at the top (or the **←** / **→** keys) to step through the other cards in the same column, as the board shows them. "3 of 7 in In progress" tells you where you are.
3. Change what you need (see below).
4. Close with **✕**, **Esc**, or by clicking outside.

**Open full page** at the top right opens the card on its own page. See [The full card page](help:scrum/card-page).

## The left side

- **Description**: a rich-text editor (Markdown). You can paste a screenshot straight in. It is saved when you click out of the field.
- **Subtasks**: see [Break a card into subtasks](help:scrum/subtasks).
- **Discussion**: threaded comments. Type in the box, use **@** to name someone, then **Comment**. On a comment you can **reply**, and on your own comments **edit** and **delete**.
- When the card is blocked, a banner at the top, see [Mark a card blocked](help:scrum/block-a-card).

## The right side

- **Start timer** / **Switch to this** / **Running**, see [Start a timer from a card](help:scrum/start-a-timer-from-a-card).
- Hours **logged** against the estimate, with a bar. When over it says how many hours over and "worth re-estimating or splitting".
- **Column**: change the card's column. Shows "Nd here".
- **Assignee**, **Priority** (low, normal, high, urgent), **Type** (story, bug, chore, spike).
- **Sprint**: only appears once the project has any sprint. **Backlog** means none.
- **Due**: a date picker.
- **Estimate**: hours, such as `1.5` or `1,5`.
- **Mark blocked**.
- **History**: every column move, with who and when.

## Good to know

- The title is not editable in the popup. Use [the full page](help:scrum/card-page).
- Estimates are plain numbers of hours. `2h` or `90m` is not understood there and reads as no estimate, which clears an existing one. Use `2` or `1.5`.
- A card in a done column that is moved out is no longer completed.
- Labels are shown but cannot be edited here. Add them in the new-card line with `#label`. See [Add a card](help:scrum/add-a-card).
- Clearing **Assignee** makes the card unassigned. Assigning someone publishes `task.assigned`.
- History only has moves recorded since the board started keeping it. Older cards say "No moves recorded."
- Putting a card in or out of a **running** sprint is remembered as scope change on that sprint. See [Sprint history](help:scrum/sprint-history).
- Whether a client can see the card is set on the full page only.
