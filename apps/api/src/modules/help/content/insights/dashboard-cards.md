---
title: The decision queue and dashboard cards
summary: Needs a decision, Needs you and Blocked on you on your dashboard, and how the decision queue is ranked.
module: insights
paths: []
capability: insights.read
keywords: [dashboard, widget, decision queue, needs a decision, needs you, blocked on you, hero, later, dismiss]
updated: 2026-10-23
---

The Inbox adds three cards you can put on your dashboard (see [Arrange your dashboard](help:shell/arrange-dashboard)).

## Needs a decision

A full-width card that shows **one** item at a time: the front of the queue, with the next two behind it. Only **urgent** and **attention** items appear. It is the one card on the dashboard that asks you something.

1. Read the title and detail. The header says "1 of N · ranked by what it costs to wait" and shows a dot per item.
2. Press **Open it** to go to the thing itself (shown when the item has a link).
3. Press **Dismiss** if you know about it. It disappears at once and is hidden while it stays true, exactly as in [The Inbox](help:insights/the-inbox). Needs `insights.write`; if the request fails the card still hides it, and it returns on the next load.
4. Press **Later** (or the arrow in the header) to look at the next one without deciding. It wraps to the first when you reach the end. With a single item these are disabled.

When nothing is waiting: "Nothing is waiting on a decision from you."

**Ranking.** Urgent comes before attention, and inside a level the bigger one first (money for invoices and quotes, days for ageing items). The heading says "ranked by what it costs to wait", but the platform has no model of the cost of delay. It is a rough order, not a calculation.

## Needs you

A card of the open urgent and attention items, as rows exactly like the Inbox's, without the dismiss link. The title shows how many are open and turns red if any is urgent. A setting, **How many to show**, chooses between 3 and 20 rows (default 5). Selecting the title opens the Inbox. Empty: "Nothing needs a decision."

## Blocked on you

Cards that a colleague blocked and named you as the reason: title, the reason, and the days in the column. It is tinted red when it has anything in it. Empty: "Nobody is waiting on you." The card is only offered once the platform has at least two people, and needs permission to read the board.

## Good to know

- Items for other people never show up on your cards; they follow the same addressing rules as the Inbox.
- The cards read the same list the Inbox does, so after **check now** they update the next time the dashboard loads.
