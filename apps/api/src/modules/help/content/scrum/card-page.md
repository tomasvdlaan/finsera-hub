---
title: The full card page
summary: One card on its own page, with title editing, client visibility, links, timeline and archive.
module: scrum
paths: [/tasks/:id]
capability: scrum.tasks.write
keywords: [task page, card page, rename task, links, timeline, effort, estimate vs logged, due date, assignee, sprint]
updated: 2026-10-23
---

Every card has its own page at `/tasks/:id`. Open it from **Open full page** in the card popup, from a link in a project, a search result, the dashboard, or the assistant's task card. Use it when you need what the popup does not have: renaming, client visibility, links, the timeline and archiving.

## What is on the page

- A header with the card title, a **Board** link back to the project's board, and the project name as a link.
- A row of controls: column picker, **Priority**, **Type**, **Blocked?** (or **Unblock**), **Start timer**, and a small **archive** link.
- A red notice with the blocking reason and how long it has been blocked.
- Editable fields: **Title**, **Estimate (hours)** and **Due** (typed as `YYYY-MM-DD`), each with an **Edit** button and **Save**; and **Description** (rich text, saved when you click out).
- A tickbox **Visible to the client**, see [Show a card to the client](help:scrum/client-visibility).
- **Assignee** and, once the project has a sprint, **Sprint** ("Backlog — no sprint" for none; sprints show "(active)" or "(done)").
- **Effort**: "Xh logged of Yh estimated" (red when over), who it is assigned to, and "In *column* for N days".
- **Subtasks**, listed as links, with their column. Add them from the popup, see [Break a card into subtasks](help:scrum/subtasks).
- **Discussion**: comments, with replies and **@** mentions.
- **Links**: connect the card to a project or another card, with a kind (about, discussed, originated_from, relates_to). Use **Link** to add, **remove** to delete. Links the system requires (such as the card's project) have no remove button.
- **Timeline**: what has happened to this card.

## Steps: rename a card

1. Open the card page.
2. Click **Edit** beside **Title**, change the text, and click **Save** (or press Enter; **Cancel** or Esc leaves it as it was). The new name shows everywhere the card is linked.

## Good to know

- The pickers (column, priority, type, assignee, sprint) and the tickbox save at once. The text fields save when you click **Save**.
- **Estimate (hours)** takes a plain number such as `2` or `1.5`.
- To block a card here, **Blocked?** opens a dialog **What is this blocked on?**. It cannot say who you are waiting on. Use the popup for that. See [Mark a card blocked](help:scrum/block-a-card).
- **Start timer** starts a clock, and is refused if one is already running. See [Start a timer from a card](help:scrum/start-a-timer-from-a-card).
- **archive** removes the card from the board immediately and takes you back to the board. See [Archive a card](help:scrum/archive-a-card).
