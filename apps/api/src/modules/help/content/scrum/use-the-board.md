---
title: Use the board
summary: Find your way round the board page, what each part of a card means, the toolbar, and the keyboard shortcuts.
module: scrum
paths: [/board]
capability: scrum.tasks.read
keywords: [kanban, board, columns, cards, wip limit, aging, shortcuts, keyboard, collapse column, project]
updated: 2026-10-23
---

The board (`/board`) shows one project's cards in columns, left to right in the order of the workflow. If there are no projects yet you will see "Create a project first — a board belongs to one."

## The toolbar

From left to right:

1. A **project** picker. The page remembers the project in its address (`?projectId=`), so you can bookmark a board.
2. "N open of M" for the cards currently shown.
3. The tabs **Board**, **Flow**, **Sprints**, **Columns**.
4. **Filters** (with a count when some are on), and **Group**, see [Filter and group](help:scrum/filter-and-group).
5. The sprint controls: **Plan a sprint** when there is none, otherwise see [Plan and run a sprint](help:scrum/plan-and-run-a-sprint).
6. **+ Task**, see [Add a card](help:scrum/add-a-card).
7. **?**, which shows the keyboard help.

With a sprint running or planned, a sprint bar appears under the toolbar. With a sprint running there is also a switch **This sprint / Backlog / Everything**, see [Backlog](help:scrum/backlog).

## What a card shows

- Above the title: type (**Story**, **Bug**, **Chore**, **Spike**), **Blocked** when it is, the priority unless it is normal, and labels.
- The title. Click it to open the card ([Open and edit a card](help:scrum/edit-a-card)).
- When blocked: the reason in red.
- The first picture from the description, as a thumbnail.
- A progress bar and "3/5" when it has subtasks.
- At the bottom: the assignee's avatar (a quiet outline when unassigned), how many days it has sat in this column (shown from 5 days, stronger from 14), the due date ("due …", or "overdue …"), the estimate in hours, the number of comments, and **+ sprint** when you are looking at the backlog of a running sprint.
- Done cards are dimmed and stay in the done column.

## Columns

- The header shows the column name, the number of cards, and the sum of estimates in hours.
- With a **WIP limit** the count reads "2 / 3". A thin bar fills toward the limit. Over it, the column is highlighted with "Over the limit — finish something before starting another." The limit counts every unfinished top-level card in the column even when a filter hides some ("· N shown").
- Click the **‹** in a header to collapse a column into a narrow strip with its count. Click the strip to expand. This is not remembered after you leave the page.
- An empty column says "Drop a card here".

## Keyboard

- **n**: open the new-card form and focus it.
- **f**: open the filters.
- **Esc**: close an open panel; if none is open, close the card popup and clear all filters.
- Moving a card with the keyboard: see [Move a card](help:scrum/move-a-card).
- Inside a card popup: **←** and **→** go to the previous and next card in the column.

Shortcuts do not fire while you are typing in a field.

## Good to know

- Filters, grouping and collapsed columns are view settings. They are not saved. A filtered board shows a count on **Filters** so you know it is not the whole board.
- Subtasks are not cards on the board unless you turn on the **Subtasks** filter. They live on their parent.
- WIP limits are warnings only. A card is never refused for going over one.
- Moves are optimistic: the card jumps at once and jumps back with an error message if the server refuses.
- To change which columns exist, see [Change the columns](help:scrum/columns-and-definitions).
