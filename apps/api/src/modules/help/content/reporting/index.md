---
title: Reporting overview
summary: What the reporting module shows, where to find the numbers, and who can see them.
module: reporting
paths: []
capability: reporting.read
keywords: [reporting, reports, numbers, revenue, outstanding, unbilled, utilisation, pipeline, dashboard]
updated: 2026-10-23
---

Reporting is read-only. It does not store anything and calculates nothing of its own: it reads the figures other modules publish (invoices, time, quotes, contracts, projects), so it cannot disagree with the invoice or timesheet behind a number.

## Where the numbers are

- [The Overview page](help:reporting/overview) (**Money → Overview**): revenue, outstanding, unbilled work, billable share, quotes, work in hand and contracts ending.
- [Dashboard widgets](help:reporting/dashboard-widgets): eight cards you can place on your dashboard.
- [How each figure is calculated](help:reporting/how-figures-are-calculated): exact definitions, so you know what a number includes.
- The two headline figures also show on the [Money hub](help:billing/money-hub).

## Who can see it

One capability, `reporting.read`. Without it the Overview page shows a red "Missing capability reporting.read" message, and the dashboard widgets are not offered in the widget library.

## The assistant

The assistant can answer with these read-only tools, each one a fixed, hand-written metric over a period you name (it never writes its own queries):

- `reporting_revenue`: invoiced revenue in a period, by month and by client.
- `reporting_outstanding`: what clients owe, current and overdue.
- `reporting_unbilled`: billable work not yet invoiced, per project.
- `reporting_utilisation`: billable share of logged time in a period.
- `reporting_project_profitability`: hours and earned value per project against budget.
- `reporting_pipeline`: quotes by status, with outstanding and won value and conversion rate.
- `reporting_renewals`: signed contracts ending within N days, with notice deadlines.

## Good to know

- There is no export, filter or date picker on the Overview page: it always shows this month and this year.
- Nothing in reporting changes data.
- Related: [Invoicing](help:billing/index), [Quotes and contracts](help:sales/index), [Insights](help:insights/index) (the rules that warn you about overdue invoices and similar).
