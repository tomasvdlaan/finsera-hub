---
title: Inbox and insights
summary: What the Inbox is for, the pages that explain it, and who can do what.
module: insights
paths: [/insights]
keywords: [inbox, insights, needs attention, notifications, alerts, decision queue, what needs me, sweep]
updated: 2026-10-23
---

The **Inbox** is the page that says what needs attention. Under it sits the *insights* feature: a set of checks that read the rest of the platform every six hours and write a sentence for anything that has gone stale, overdue or unnoticed: an overdue invoice, a quote nobody answered, a blocked card, a client waiting on a ticket.

Insights **only notice and say so**. They never send a message, chase an invoice or change a record. The Inbox also gathers things that were not found by a check but addressed to you by a person: comments that mention you and cards that someone has blocked on you.

You find it as **Inbox**, second in the **Today** section of the left menu.

## Pages in this module

- [The Inbox](help:insights/the-inbox): read, dismiss, restore and re-check items; mentions and blocked cards.
- [What the checks look for](help:insights/insight-rules): every check, its thresholds, who it is addressed to and how urgent it gets.
- [The decision queue and dashboard cards](help:insights/dashboard-cards): **Needs a decision**, **Needs you** and **Blocked on you** on your dashboard.

## Who can do what

| You can | Needs |
|---|---|
| Open the Inbox and read items addressed to you | `insights.read` |
| Dismiss and restore items | `insights.write` |
| See items addressed to other people, and items nobody owns | `insights.read_all` (administrators only) |

Colleagues have `insights.read` and `insights.write` by default. What you see is decided by who an item is addressed to, not only by your capability; see [The Inbox](help:insights/the-inbox).

## Good to know

- An item whose cause goes away disappears on its own; you do not have to close it.
- Dismissing says "I know" and keeps the item hidden for as long as it stays true.
- Items can be addressed to a person or to a [department](help:shell/departments). Putting someone in a department changes what reaches their Inbox, not what they may open.
- The assistant can list what the checks found when you ask it ("what needs my attention?"). It can only read; it cannot dismiss.
