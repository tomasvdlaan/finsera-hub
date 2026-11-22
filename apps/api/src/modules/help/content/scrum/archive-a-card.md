---
title: Archive a card
summary: Remove a card from the board, and what that does and does not undo.
module: scrum
paths: [/tasks/:id]
capability: scrum.tasks.write
keywords: [archive, delete task, remove card, delete card, clean up]
updated: 2026-10-23
---

Archiving takes a card off the board and out of every list and count. It is the only way to get rid of a card.

## Steps

1. Open the card's full page ([The full card page](help:scrum/card-page)).
2. Click the small **archive** link in the row of controls.

There is no confirmation. You are taken back to the project's board and the card is gone.

## What it does

- The card is hidden from the board, task lists and sprint progress.
- Its record is marked deleted, so links to it show as deleted.
- The action is recorded in the audit trail as `task.archive`.

## Good to know

- **There is no screen to bring an archived card back.** Treat archiving as final.
- Archiving a card does not archive its subtasks.
- Hours already logged against the card stay in Time.
- Archiving is in the full page only, not the popup. To stop work without losing the card, mark it done instead. See [Move a card](help:scrum/move-a-card).
