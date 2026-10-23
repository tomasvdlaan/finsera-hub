---
title: The Overview page
summary: Read the finance overview: what needs attention, money in and owed, revenue by month, delivery, work in hand and contracts ending.
module: reporting
paths: [/reporting]
capability: reporting.read
keywords: [overview, reporting, revenue by month, invoiced this year, outstanding, billable share, quotes out, won, work in hand, renewals]
updated: 2026-10-23
---

**Money → Overview** is one page of figures. Everything on it is read from what the modules publish; nothing is recalculated here.

## Steps

1. Open **Money** and choose the **Overview** tab.
2. Read from the top. Click any card that has a link to go to the detail behind it.

## What each part shows

**Needs attention** (only when there are open insights). The top few insights with a count badge, and "see all N" linking to [Insights](help:insights/index).

**Money**
- **Invoiced this year**: issued and paid invoices with an issue date this year, excluding VAT. Credit notes count as negatives.
- **Invoiced this month**: the same for this month.
- **Outstanding**: issued, unpaid invoices including VAT, with how much is overdue and across how many invoices ("none overdue" otherwise). Red when anything is overdue. Links to [Invoice list](help:billing/invoice-list).
- **Not yet invoiced**: billable, un-invoiced work valued at project rates, and the hours behind it. Links to the invoice list.

**Revenue by month** (when there is any). A bar chart above a table with **Month**, an inline bar, and **Invoiced (ex VAT)** amount.

**Delivery**
- **Billable share this month**: billable minutes divided by all logged minutes this month, as a percentage; "—" and "nothing logged yet" when no time is logged. Links to Time ([Time](help:time/index)).
- **Quotes out**: total value (excluding VAT) of sent quotes and how many await a decision. Links to [Quote list](help:sales/quote-list).
- **Won**: value (excluding VAT) of accepted quotes and the conversion rate (accepted divided by accepted + rejected); "nothing decided yet" before any decision.

**Work in hand** (when any). One row per project with un-invoiced billable hours: project (links to the project), client, hours and value.

**Contracts needing attention** (when any). Signed contracts ending within 90 days: title (links to the contract), days badge, client, end date and notice deadline.

## Good to know

- The Quotes out and Won figures use all quotes ever, not just this year.
- **Contracts needing attention** includes signed contracts whose end date has already passed (shown with a negative number of days) until they are terminated.
- Money pages use euros with cents here; cards on the Money hub and dashboard round to whole euros.
- Exact definitions: [How each figure is calculated](help:reporting/how-figures-are-calculated).
