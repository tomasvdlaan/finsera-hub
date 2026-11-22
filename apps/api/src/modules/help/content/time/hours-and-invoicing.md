---
title: How hours reach an invoice
summary: Which hours can be invoiced, how an hour moves from billable to invoiced, and what locks it.
module: time
capability: time.entries.write_own
keywords: [invoice, billable, invoiced, draft invoice, locked, credit, unbilled, approval, bill hours]
updated: 2026-10-23
---

Time does not send invoices. [Billing](help:billing/index) builds invoice drafts from the billable hours that Time hands over. This page explains what decides whether an hour is handed over, and what happens to it afterwards.

## The four billing states

Every entry is in exactly one of these, shown on its row in **Recent activity** on the tracker:

| State | Meaning |
|---|---|
| **Not billable** | The billable tickbox is off. Never invoiced. |
| **Billable** | Billable and not yet on any invoice. This is what invoice drafts pick up. |
| **On a draft invoice** | Claimed by a draft. It stays on that draft until the draft is issued, or released if the draft is voided. |
| **Invoiced** | The invoice was issued. The hour is frozen. |

## Which hours are offered to an invoice

An hour is offered when **all** of these are true:

- It is against a **project** (hours against a client with no project, or against Internal, are not picked up by invoicing).
- **Billable** is on.
- It has finished: a running clock has no duration yet.
- It is not already on an invoice.
- Its week is not waiting on a decision, and has not been sent back. See [Hand in your week](help:time/hand-in-your-week).

A week you never handed in, an approved week, and hours logged before approvals existed are all offered as normal.

## What happens when an invoice changes

- Drafting an invoice claims the hours, and a hour cannot be on two invoices at once. The second invoice is refused.
- Voiding a draft or crediting an invoice releases its hours again.
- Issuing an invoice stamps the hours as invoiced.

## Good to know

- **Invoiced hours cannot be edited or deleted.** The message is "credit the invoice first". Hours on a draft can still be changed.
- **Billable is a choice, with defaults.** On a project it is on for a clock and for assistant-logged hours unless told otherwise, and off for the **Write down an hour** form unless you tick it. On a client-only target it starts off. On **Internal** it can never be on.
- On a project with no client the tracker warns "No client — not invoiceable".
- A card on the board with an estimate that is moved to done with no hours logged against it gets a warning toast. See [Move a card](help:scrum/move-a-card).
- The **Budget burn** card on a project compares hours spent with the hours sold. See [Budget burn on a project](help:time/project-budget-burn).
