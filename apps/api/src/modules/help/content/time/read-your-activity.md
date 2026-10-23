---
title: Read your recent activity
summary: What the totals, the day list and the side cards on the tracker mean, and how to jump to a particular day.
module: time
paths: [/time]
capability: time.entries.write_own
keywords: [recent activity, last 14 days, billable percentage, worth fixing, by project, fortnight, date, totals]
updated: 2026-10-23
---

Under the clock and the entry form, the tracker shows your last 14 days. It only ever shows your own hours.

## The header

Three figures sit in the page header:

- **Today**: hours so far today. Moves second by second while a clock runs.
- **Last 14 days**: everything in the list below.
- **Billable**: the percentage of those hours marked billable. It is only shown when there are hours, and is highlighted when below 60%.

## Recent activity

One block per day, newest first, labelled **Today** or by weekday and date, with the day's total. Each row shows the description, the project or client (a project name is a link to the project), the start and end times when there are any, the billing state, and the duration. Days with nothing logged do not appear. See [Correct or delete an hour](help:time/edit-or-delete-an-hour) for the row actions.

The billing state is one of **Billable** / **Not billable** (a tickbox you can change), **On a draft invoice**, or **Invoiced**.

If there is nothing in 14 days you see: "Nothing logged in the last fortnight. Start the clock above, or write down an hour you already worked."

## Open a particular day

Links from other places (the week grid, links to a time entry) arrive as `/time?date=YYYY-MM-DD`. The list then reaches back to that date, scrolls to the day and marks it.

## The side cards

- **Last 14 days**: fourteen bars, one per day, including empty days. "Logged on N of 14 days."
- **Worth fixing**: problems found in the hours on screen. It says "Every hour has a description, a target and a client." when there are none. Possible findings:
  - Billable entries with no description, with a button **Name the first** that opens the first one for editing.
  - Projects with no client, "so those hours cannot reach an invoice", with **Attach one** which opens the project.
  - Fewer than three days with time in the last 14 days.
- **By project**: hours per project or client over the fortnight, biggest first, with a bar. A project with no client carries "No client — not invoiceable".

## Good to know

- Everything here is arithmetic on the entries already loaded. Nothing is an estimate.
- An hour against **Internal — no client** is grouped under "Internal" in **By project**.
- A running clock counts in **Today** and **Last 14 days** up to the second.
- The same numbers, differently framed, are available as [dashboard widgets](help:time/dashboard-widgets).
