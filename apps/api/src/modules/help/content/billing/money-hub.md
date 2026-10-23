---
title: The Money hub
summary: The one-screen summary of what clients owe and what is not yet invoiced, plus the tab strip that leads to invoices, quotes, contracts and the overview.
module: billing
paths: [/money]
keywords: [money, hub, owed, outstanding, overdue, unbilled, finance, tabs]
updated: 2026-10-23
---

**Money** (in the top bar) is the front door to the finance pages. It shows two figures and a tab strip. Nothing on it needs attention every day; when something does, it surfaces on Today.

## What you see

1. **Owed to us** (large card, left). The total of issued, unpaid invoices. The note under it says either "nothing has gone past its date" or how much of it is past its due date. When something is owed, a bar splits the amount into **Within terms** and **Overdue**. Click the card to open the [invoice list](help:billing/invoice-list). The card is tinted when anything is overdue.
2. **Unbilled work** (card, right). The value of hours that are logged, billable and not yet on an invoice, valued at each project's hourly rate. Click it to open the [reporting overview](help:reporting/overview).
3. **The tab strip** at the top of the page: **Money**, **Invoices**, **Quotes**, **Contracts**, **Overview**. The same strip appears on those pages, so you can move between them without going back. **Rate cards** are not in this strip; they sit under Setup (see [Rate cards](help:sales/rate-cards)).

## Before you start

The two figures come from the reporting module. Without the `reporting.read` capability the page shows a red error message instead of numbers, but the tab strip still works.

## Good to know

- The figures are summaries, computed from the same data as the invoice list, so they cannot disagree with it.
- **Unbilled work** is an estimate of work in hand, not money owed: it uses the project's current rate, and a project with no rate counts as €0.
- Old addresses such as `/billing`, `/sales` and `/sales/contracts` still work: they redirect to the matching page under `/money`.
- Related: [Invoicing overview](help:billing/index), [Quotes and contracts](help:sales/index), [Reporting](help:reporting/index).
