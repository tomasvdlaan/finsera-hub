---
title: Move a card
summary: Move a card between columns and reorder it, by dragging, with the keyboard, or from the card; and what the warnings mean.
module: scrum
paths: [/board]
capability: scrum.tasks.write
keywords: [drag, drop, move card, change column, done, complete, wip warning, reorder, rank, keyboard]
updated: 2026-10-23
---

Moving a card is how work is reported: the column a card sits in is its status. Moving into a column marked as done completes it.

## Drag and drop

1. Press and drag anywhere on a card (a small movement of about 6 pixels starts the drag, so a click still opens it).
2. Drop it on another column to put it at the bottom of that column, or drop it on another card to place it just above that card.

## With the keyboard

1. Focus a card and press **space** to pick it up.
2. **←** and **→** change column, **↑** and **↓** reorder within the column.
3. Press **space** to drop.

## From the card

Open the card ([Open and edit a card](help:scrum/edit-a-card)) and change **Column**, or on the full page use the column picker at the top ([The full card page](help:scrum/card-page)).

## From the dashboard

The **Waiting on someone else** and **My board** blocks have a button that moves a card to the next column. See [Scrum blocks](help:scrum/dashboard-widgets).

## Warnings

A move is never blocked by these. You get a message and the card still moves.

- **WIP limit**: "… is limited to N and this makes M. Finishing something there beats starting another." Only for active columns that have a limit.
- **Done without hours**: "Nothing was logged against this, though it carries an estimate." When a card with an estimate enters a done column with no hours logged against it. See [Time](help:time/index).

## What a move does

- Moving into a done column stamps the card completed (`task.completed` is published once). Moving it out again clears that.
- Each move to another column is written to the card's history ("To do → In progress", who, when). **Flow** reads this history.
- `task.moved` is published.

## Good to know

- If the server refuses a move, the card jumps back and an error appears above the board.
- Choosing a column from the **Column** picker in a card does not give the warnings that dragging does.
- Reordering within the same column does not create a history entry.
- The assistant can move a card by name ("move the dataset task to review") and passes the warnings on.
- With filters or lanes on, dropping "between" cards refers to the cards you can see.
