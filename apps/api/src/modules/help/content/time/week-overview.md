---
title: The week at a glance
summary: A read-only grid of your week by project, with a way into any day.
module: time
paths: [/time/week]
capability: time.entries.write_own
keywords: [week, timesheet grid, weekly overview, this week, previous week, totals, per project]
updated: 2026-10-23
---

**This week** (`/time/week`, the second tab next to **Tracker**) answers "where did my week go and where are the gaps". It is read-only: you correct hours on the tracker, not here.

## What you see

- The title **Week of** followed by that Monday's date.
- **← Previous**, **This week** and **Next →** buttons to move between weeks.
- A grid with one row per project, per client, and **Internal**, and a column for each day from Mon to Sun plus **Total**. Weekend columns are shaded. A dot means nothing was logged. Totals are in decimal hours (7.5, not 7h 30m).
- A last row with the total per day, and a line "Xh billable of Yh logged".
- Below the grid, three cards: [Hand in this week](help:time/hand-in-your-week), **Waiting on a decision** (approvers) and **Export these hours**.

## Go to a day

Click a day heading or any figure in the grid to open the tracker at that day (`/time?date=…`). Click a project name to open the project (this works for project rows; client-only and **Internal** rows have no project to open). The link **Back to day view** returns to the tracker.

## Good to know

- Only **your** hours are shown, even if you are an administrator.
- When the week cannot load, the page header and navigation still work and an error appears in place of the grid.
- An empty week reads "Nothing logged this week."
- The week is Monday to Sunday.
- Hours added or edited on the tracker appear here on the next visit. This page does not refresh itself.
- The week shown is the one the **Hand in this week**, and **Export these hours** cards act on.
