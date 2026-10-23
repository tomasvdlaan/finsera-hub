---
title: The Inbox
summary: Read what needs you, jump to the thing itself, dismiss or restore an item, check again, and clear mentions.
module: insights
paths: [/insights]
capability: insights.read
keywords: [inbox, insight, dismiss, restore, check now, mention, blocked on you, urgent, attention, resolved, needs attention]
updated: 2026-10-23
---

The **Inbox** page is one list for everything waiting on you. Nothing on it has been acted on: no message was sent and no record changed.

## What you see, top to bottom

1. **Mentions.** A card "N mentions" appears only when someone named you in a comment ("Someone named you in a comment."). Each mention shows who wrote it, "on" the record it was written on, and an excerpt. Following the link marks it read; **mark read** clears one; **Mark all read** clears them all.
2. **Cards blocked on you.** A red card "N cards are blocked on you" ("Someone stopped and put your name on it.") lists each card with the reason it is blocked and how many days it has been in its column. These come first among the work items because a colleague has stopped and named you as the reason.
3. **The list of insights**, with three status buttons above it: **open**, **dismissed** and **resolved**, and a **check now** link.

## Read an insight

Each row has a title and a one-line detail. When the item is about an invoice, quote, contract, project, task, sprint or client ticket, the title is a link to it. Some insights have no link (the undecided-action-points one and the running-timer one). On the right of the row:

- a grey **department** badge when the item was addressed to a department rather than to you personally;
- a severity badge: **urgent** (red) or **attention** (amber);
- **dismiss** on an open item, **restore** on a dismissed one. Resolved items have neither.

Rows are ordered most urgent first, and within a level by size (money, days, or similar). The detail of what each row means is in [What the checks look for](help:insights/insight-rules).

## Dismiss and restore

1. On an **open** item press **dismiss**. It leaves the list and moves to **dismissed**.
2. To bring it back press **dismissed**, then **restore** on the row.

A dismissed item stays dismissed for as long as its cause stays true. It is not raised again tomorrow. If the cause goes away it becomes **resolved**; if the cause later returns, a resolved item reopens by itself. Dismissing needs `insights.write`; without it you get an error line at the top.

## Check now

The list is refreshed by itself every six hours, plus once shortly after the platform starts. **check now** runs the same sweep immediately and reloads the list; the link reads "checking…" while it runs. Use it after you fix something and want the item to go away.

## Who sees which items

- An item addressed **to you by name** (a card you hold, a timer you left running) is yours alone. It is not repeated to the rest of your department.
- An item addressed to a **department** reaches everyone in that department. Which departments you are in is set under [People](help:shell/people) and [Departments](help:shell/departments).
- An item with no owner is for administrators only.
- Administrators (`insights.read_all`) see everything. You cannot dismiss something you cannot see.

## Empty states

"Nothing needs attention." on **open**; "No dismissed insights." or "No resolved insights." on the others.

## Good to know

- The page can show a card for client requests, but nothing fills it today. Questions clients ask in their portal arrive as tickets: see [Client tickets](help:portal/client-tickets). A ticket waiting two days or more on us shows up here as an insight.
- Mentions and blocked cards are not insights: they have no dismiss. They go away when you read the mention or the card is unblocked.
- A fresh insight appears at the latest at the next six-hourly sweep, unless you press **check now**.
