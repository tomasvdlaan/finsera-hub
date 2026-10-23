---
title: Reporting dashboard widgets
summary: The eight finance cards you can place on your dashboard, what each shows, and when it is hidden.
module: reporting
paths: []
capability: reporting.read
keywords: [dashboard, widgets, cards, owed, unbilled, receivables, who pays late, budget, quotes by state, client concentration, what is ending]
updated: 2026-10-23
---

Reporting contributes eight widgets to the dashboard widget library (see [the dashboard](help:shell/index) for how to add, move and remove cards). They are only offered to people with `reporting.read`.

| Widget | What it shows | Click goes to |
|---|---|---|
| **Owed to us** | Total of issued, unpaid invoices with a **Within terms** / **Overdue** split bar. Tinted when anything is overdue. | [Invoice list](help:billing/invoice-list) |
| **Unbilled work** | Value of billable hours no invoice has picked up yet. | [Overview](help:reporting/overview) |
| **Receivables, by age** | What is owed, in four buckets: **Not yet due**, **1–30 days**, **31–60**, **Over 60**. Red when anything is over 60 days. Empty text: "Nothing is owed. Drafts do not count until they are issued." | Invoice list |
| **Who pays late** | Per client, the average days past due date of paid invoices (negative is early) and how many were paid. Up to eight clients, clients who pay latest listed first. | Invoice list |
| **Every budget at once** | Earned value against budget for every project that has logged time, on one scale. A project with no budget says so instead of showing a bar. | Overview |
| **Quotes by state** | The value of **Drafted**, **Sent** and **Accepted** quotes right now, with counts. A snapshot, not a conversion rate. | [Quote list](help:sales/quote-list) |
| **How much rides on one client** | Share of this year's invoiced revenue (ex VAT) for the top six clients, with a legend. Tinted as a warning when the largest client is 50% or more. | Overview |
| **What is ending** | Signed contracts reaching their end date within 90 days, on a timeline, plus the first four with days left. | [Contract list](help:sales/contract-list) |

## Hidden until there is data

Some widgets are not offered in the library until the business has enough data for them to mean something:

- **Receivables, by age**: at least one issued invoice.
- **Who pays late**: at least two paid invoices.
- **Every budget at once**: at least one project with a budget.
- **How much rides on one client**: at least one paid invoice.
- **What is ending**: at least one contract with an end date.

## Good to know

- Cards and the Money hub round to whole euros; the Overview page shows cents.
- "Who pays late" compares the day you clicked **Mark paid** with the due date, so mark invoices paid promptly ([Mark an invoice paid](help:billing/mark-paid)).
- The earned value in **Every budget at once** is billable hours times the project's current hourly rate, not what has been invoiced.
- Definitions: [How each figure is calculated](help:reporting/how-figures-are-calculated).
