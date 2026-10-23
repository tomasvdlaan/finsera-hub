---
title: Mark a card blocked
summary: Say a card cannot move and why, who you are waiting on, and clear it again.
module: scrum
paths: [/board]
capability: scrum.tasks.write
keywords: [blocked, blocker, waiting on, impediment, unblock, stuck, blocked on you]
updated: 2026-10-23
---

Blocked is a note on a card, separate from its column. A card is usually blocked while sitting somewhere (in progress, waiting for a credential), so blocking does not move it.

## Block a card

1. Open the card popup ([Open and edit a card](help:scrum/edit-a-card)).
2. Click **Mark blocked** on the right.
3. Type **What is it waiting on?** (required) and click **Block**.

On the full page the same thing is the **Blocked?** button, which asks **What is this blocked on?** and confirms with **Mark blocked**.

## Say who you are waiting on

When a card is blocked, its banner in the popup has **Waiting on** with a picker. Choose a person or **Nobody in particular**. Changing it saves immediately and keeps the reason.

## Unblock

Click **Unblock** in the banner (popup) or on the full page. The reason, the date and the person are cleared.

## What it looks like

- On the board: a **Blocked** badge and the reason under the title. The popup banner says "Blocked for N days".
- The sprint bar and the sprint page count blocked cards ("N blocked").
- **Filters** has a **Blocked** chip to show only those cards.

## Good to know

- Blocking again while already blocked changes the reason and keeps the original start date.
- `task.blocked` is published only the first time, and `task.unblocked` on unblock.
- A card **waiting on a client** is usually better shown by moving it to a column whose flow is "Waiting on someone else". See [Change the columns](help:scrum/columns-and-definitions).
- The person you name under **Waiting on** is recorded on the card, and other screens such as the Today page can use it to show them what is waiting on them. See [Insights](help:insights/index).
- A blocked card in a done column is not counted as blocked in a sprint.
- The assistant cannot block or unblock a card.
