---
title: Change the columns of a board
summary: Add, rename, reorder and remove columns, say what each one means, set WIP limits, and write what done and ready mean.
module: scrum
paths: [/board/settings]
capability: scrum.board.manage
keywords: [columns, workflow, wip limit, definition of done, definition of ready, board settings, flow, done column, rename column]
updated: 2026-10-23
---

The **Columns** tab (`/board/settings`, titled **Board settings**) defines the workflow of one project's board. It is not in the navigation; reach it from the tabs on the board, or from **Flow** and **Sprints**. Pick the project at the top.

## Steps

1. Open the board and click the **Columns** tab.
2. Edit the table. For each column you can set:
   - **Name**: what the board shows. Renaming is safe: cards keep their place.
   - **Flow**: what the column *means*: **Queued**, **Being worked on**, **Waiting on someone else**, or **Finished**.
   - **Done**: tick it when entering this column completes a card.
   - **Limit**: a work-in-progress limit (a whole number, 1 or more), or empty for none.
   - The arrows **←** and **→** to change the order (left to right as on the board).
   - **✕** to remove it.
3. Click **Add a column** for a new one at the end.
4. Write **Done means** and **Ready means** if you want (see below).
5. Click **Save board**. You get "Board saved". **Discard changes** returns to what is saved.

**Save board** stays disabled until something changed and no problem is listed.

## Problems it tells you about

The page lists these in red and blocks saving:

- "A board needs at least one column."
- "Mark one column as done — without one, nothing can ever complete."
- "Every column needs a name."
- "Two columns are both called …"
- "Move the N cards out of … before removing it."
- A limit that is not a whole number of at least 1.

The **Cards** column of the table counts the cards in each column, and the ✕ is disabled on a column that still has cards in it.

## What Flow means

The names are yours; the **Flow** is what the measurements rely on:

- Cycle time runs from the first column that is **Being worked on** to the first **Finished** one.
- The warning when you move a card over a WIP limit only applies to columns that are **Being worked on**. The board header shows a limited column as over its limit whatever its flow.
- Time in a **Waiting on someone else** column is counted as waiting on the client, and is reported on **Flow** and the dashboard.

See [Read the flow figures](help:scrum/flow-metrics).

## Done means, Ready means

Two free-text boxes. They are plain notes and nothing checks them or stops a card from moving. They are copied into the notes for sprint planning and review so they get read out. The one rule the system does check is a card with an estimate moved to done with no hours logged against it (a warning, see [Move a card](help:scrum/move-a-card)).

## Good to know

- **A limit warns, it never refuses.** See [Use the board](help:scrum/use-the-board).
- Each new column gets a permanent internal key made from its name (`code_review`). Renaming later does not change the key, and the key is shown under existing column names.
- Only the **first** column receives new cards, so order matters.
- A column that still holds cards cannot be removed. The server enforces the same rule as the disabled ✕.
- New projects start with **To do**, **In progress**, **Waiting on client**, **Review**, **Done**.
