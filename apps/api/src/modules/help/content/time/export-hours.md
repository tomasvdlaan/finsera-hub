---
title: Export hours to CSV
summary: Download a week of hours as a spreadsheet file, as every line, per week, or for payroll, optionally with cost and margin.
module: time
paths: [/time/week]
capability: time.entries.write_own
keywords: [export, csv, download, spreadsheet, payroll, bookkeeper, excel, hours report, cost, margin]
updated: 2026-10-23
---

The **Export these hours** card at the bottom of **This week** (`/time/week`) downloads the hours of the week shown in the grid as a CSV file.

## Steps

1. Open **Timesheet**, then **This week**, and move to the week you want with **← Previous** / **Next →**.
2. In **Export these hours**, choose a format:
   - **Every line**: one row per entry. Columns: person, date, client, project, description, hours, billable, invoiced.
   - **Per week**: one row per person per week, with the billable and invoiced split.
   - **Payroll**: hours per person for the period. No client and no project.
3. Administrators with cost access can tick **Include cost and margin**.
4. Click **Download CSV**. The button reads **Preparing…** while the file is made.

## Who gets whose hours

- Everybody gets their **own** hours (the card says "Your hours, for this week").
- Holders of `time.entries.read_all` (administrators) get **everybody's** ("Everybody, for this week").

## Cost and margin

**Include cost and margin** only appears for people with `time.costs.read` (administrators). It adds columns cost, revenue and margin to **Every line** (revenue uses the project's default rate, and is zero for hours not marked billable), and cost to **Per week**. A cell is left empty where no rate was ever set. A blank is a missing rate, not zero.

## Good to know

- The period is always the Monday to Sunday of the week on screen. The screen offers no other date range.
- The file uses semicolons and comma decimals, so it opens as a table in a Dutch spreadsheet. Headers are in Dutch (for example Persoon, Datum, Klant, Uren, Declarabel). The file name is like `uren_entries_mijn_2026-10-19_2026-10-25.csv`.
- A running clock counts for the time elapsed so far.
- The download is made in the browser from the server's reply, so an expired session shows an error under the card instead of saving a broken file.
- Without the right capability the server refuses a request for others' hours or for costs rather than quietly dropping columns.
