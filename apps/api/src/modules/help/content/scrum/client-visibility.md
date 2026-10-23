---
title: Show a card to the client
summary: Tick a card as visible to the client in their portal, and what they would see of it.
module: scrum
paths: [/tasks/:id]
capability: scrum.tasks.write
keywords: [client visible, portal, share task, client portal, visibility, hide card]
updated: 2026-10-23
---

Cards are internal by default. A card appears in the client's portal only when someone ticks **Visible to the client** on its page.

## Steps

1. Open the card's full page ([The full card page](help:scrum/card-page)).
2. Tick **Visible to the client**. Untick to hide it again.

The change is saved at once and recorded in the audit trail.

## What the client sees

Only these fields: the **title**, **status** (column), **type**, **due date**, and whether it is **done**.

They do not see the description, the assignee, the estimate, labels or the blocking reason. The portal refuses any field not on that list.

## Good to know

- **Read the title as the client would.** A title written for colleagues reads differently on a client's screen.
- The tickbox exists only on the full page, not in the popup.
- The assistant cannot change this setting, because it reads text that clients write. Nobody can talk it into publishing cards.
- The client portal is described in [Portal](help:portal/index).
- Nothing about hours is shown to clients. See [Time](help:time/index).
