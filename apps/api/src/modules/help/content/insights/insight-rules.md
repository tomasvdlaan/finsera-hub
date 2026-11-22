---
title: What the checks look for
summary: Every check behind the Inbox, with its threshold, how urgent it gets, and who it is addressed to.
module: insights
paths: []
capability: insights.read
keywords: [rules, checks, overdue invoice, unanswered quote, contract notice, budget, unbilled, aging card, blocked, sprint ending, ticket waiting, timer running, undecided action points, setup incomplete]
updated: 2026-10-23
---

Insights come from fifteen fixed checks. Each is a plain database query, not a guess: the same facts, counted the same way, every six hours. A check states a fact and stops; it never acts. When the fact stops being true the item resolves itself.

**Urgent** items are red, **attention** items amber. In each case the list shows the more urgent first and, within a level, the larger or older one first.

| Check | Raised when | Attention until | Urgent when | Addressed to |
|---|---|---|---|---|
| **Invoice overdue** | An issued invoice is past its due date | any | 30 days or more overdue | Finance |
| **Quote unanswered** | A sent quote has had no decision for 14 days | any | the quote has passed its validity date | Sales |
| **Contract notice closing** | A signed contract with an end date and notice period reaches its notice deadline within 45 days (a contract that rolls over automatically says so) | more than 14 days left | 14 days or fewer | Sales |
| **Budget nearly spent** | Earned value (billable hours times the project's rate) reaches 80% of the project budget | below 100% | 100% or more | Delivery |
| **Unbilled work ageing** | A project has billable hours not yet on an invoice, the oldest 30 or more days old | any | oldest 60 days or more | Finance |
| **Card in flight too long** | A card has been in progress for 14 days, counted from when work first started | any | 30 days or more | The card's owner, else Delivery |
| **Task overdue** | A task is past its due date and not finished | any | 7 days or more late | The task's owner, else Delivery |
| **Sprint ending with open work** | An active sprint ends within two days and more than 30% of its cards are open | any | on the last day | Delivery |
| **Work sitting with a client** | A card has been in a "waiting on client" state for 7 days | any | 21 days or more | The card's owner, else Delivery |
| **Ticket waiting on us** | A client ticket has been waiting for our answer for 2 days | any | 7 days or more | Whoever the ticket is assigned to, else Delivery |
| **Card blocked** | A card has been blocked for 3 days | any | 7 days or more | Whoever it is blocked on, else its owner, else Delivery |
| **Client accepted a quote** | A client accepted a quote and no project has been created from it yet | under 3 days | 3 days or more | Sales |
| **Setup incomplete** | The organisation's legal name, KvK number, VAT number or IBAN is missing, so invoices are not valid | n/a | always urgent | IT |
| **Action points undecided** | A meeting has proposed action points nobody accepted or dismissed, 3 days after the meeting (one already carried to a later meeting is not counted) | under 14 days | 14 days or more | Delivery |
| **Timer left running** | A clock has run for more than 12 hours | under 24 hours | 24 hours or more (it cannot be stopped without correcting it) | The person whose clock it is, only them |

## What each item links to

Invoice, quote, contract, project, task, sprint and client-ticket items link to the record. **Action points undecided** has no link (go to [Meetings](help:meetings/action-points)); **Timer left running** has none (stop it on the Time page); **Setup incomplete** has none (see organisation settings).

## Good to know

- Thresholds are fixed in the platform. They cannot be changed on screen.
- A check that fails does not stop the others.
- "Waiting on the client" comes from the board's flow state. See [Scrum](help:scrum/index).
- "Ticket waiting on us" is about tickets from [Client tickets](help:portal/client-tickets). It resolves the moment someone answers, because the ticket then waits on the client.
- Department routing is set under [Departments](help:shell/departments). An item for a department nobody is in reaches administrators only.
- You can ask the assistant "what has the platform noticed?", filtered by open, dismissed or resolved, and by check. It reads the same list and shows only what you may see.
