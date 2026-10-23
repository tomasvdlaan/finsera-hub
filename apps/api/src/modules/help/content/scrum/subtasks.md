---
title: Break a card into subtasks
summary: Add and tick off subtasks on a card, and how they are shown and counted.
module: scrum
paths: [/board]
capability: scrum.tasks.write
keywords: [subtask, checklist, child task, parent, epic, break down, tick off]
updated: 2026-10-23
---

A subtask is a real card with a parent. It can be estimated, assigned, timed and blocked like any other card, but it normally lives on its parent instead of the board.

## Steps

1. Open the parent card on the board ([Open and edit a card](help:scrum/edit-a-card)).
2. In **Subtasks**, type in **Add a subtask** and click **Add**.
3. Tick a subtask when it is finished. Untick it to reopen it.
4. Click **open** beside a subtask to go to its own page.

## What ticking does

Ticking moves the subtask into the board's first done column. Unticking moves it into the first column that is not done. These are normal moves with history. Your choice of columns decides which ones: see [Change the columns](help:scrum/columns-and-definitions).

## Where subtasks show

- On the parent card on the board: a bar and "3/5".
- In the card popup: "3 of 5" next to the heading.
- On the full page: a list of links with each subtask's column.
- On the board itself only when you turn on the **Subtasks** filter. See [Filter and group](help:scrum/filter-and-group).

## Good to know

- A subtask is created in the project's first column, with no sprint, and belongs to the parent's project.
- A subtask is not counted in column WIP.
- The parent of a card must be in the same project. A card cannot be its own ancestor: the server refuses a loop.
- The assistant can set a card's parent when creating or updating a card.
- The parent does not complete when all its subtasks are done. Move it yourself.
