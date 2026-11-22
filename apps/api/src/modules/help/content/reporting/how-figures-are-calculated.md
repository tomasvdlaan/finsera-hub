---
title: How each reporting figure is calculated
summary: Exact definitions behind revenue, outstanding, unbilled work, billable share, project earnings, pipeline and renewals.
module: reporting
paths: []
capability: reporting.read
keywords: [definition, calculation, revenue, outstanding, overdue, unbilled, utilisation, billable share, earned, conversion rate, aging]
updated: 2026-10-23
---

Use this page when a number surprises you.

## Revenue (invoiced)

- Includes invoices and credit notes with status **issued** or **paid**, grouped by **issue date**. Drafts and voided drafts are excluded.
- Credit notes are negative, so a credited month reads lower.
- Shown excluding VAT (the sum of subtotals). A "by client" split is available to the assistant and the client concentration widget.
- Revenue counts the issue date, not the payment date.

## Outstanding and overdue

- Outstanding = total (including VAT) of invoices with status **issued**. A credit note that is issued counts as a negative amount until it is marked paid.
- Overdue = issued and the due date is before today. Not overdue = within terms. Marking paid removes an invoice from both.

## Receivables by age

Issued invoices bucketed by days past due date: **Not yet due**, **1–30**, **31–60**, **Over 60**.

## Who pays late

Average of (paid date minus due date) per client, over paid invoices, rounded to whole days. Early payment gives a negative figure. Paid date is the day **Mark paid** was clicked. Top eight clients.

## Unbilled work

Billable time entries that have a duration and no invoice, per project, times the project's hourly rate. A project with no rate counts as €0. It is an estimate of work in hand, not a receivable. Hours in weeks waiting for approval are still counted here, although they cannot yet be put on a draft invoice.

## Billable share (utilisation)

Billable minutes divided by all logged minutes with a duration, for the period (this month on the Overview), rounded to a whole percent. No ratio ("—") when nothing was logged.

## Project earned value and budget

Earned = billable minutes × project hourly rate. Budget used = earned divided by the project's budget. Only projects with logged time are included. Projects with no budget show no bar.

## Pipeline

- Counts quotes by status, with the value excluding VAT. **Quotes out** = sent. **Won** = accepted.
- Conversion rate = accepted divided by (accepted + rejected). No rate until at least one is decided.
- It is a snapshot of current statuses, not a funnel over time.

## Renewals

Signed contracts with an end date within the next N days (90 on screen; the assistant can choose another N), earliest first, including those already past their end date. Notice deadline = end date minus notice days.

See also: [Overview](help:reporting/overview), [Dashboard widgets](help:reporting/dashboard-widgets).
