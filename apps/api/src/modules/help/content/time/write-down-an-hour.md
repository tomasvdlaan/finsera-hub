---
title: Write down an hour
summary: Log time you did not run a clock for, as a start and end or as a duration.
module: time
paths: [/time]
capability: time.entries.write_own
keywords: [log hours, manual entry, forgot, add time, backfill, duration, past day, timesheet entry]
updated: 2026-10-23
---

Use this when you worked but did not run a clock. It is the second tab, **Write down an hour**, next to **Run a clock** on **Timesheet** (`/time`).

## Steps

1. Open **Timesheet** and click the **Write down an hour** tab.
2. Fill in **What did you work on?** (optional).
3. Pick what it is against in the picker: **Internal — no client**, a project, or a client with no project yet.
4. Give the time in one of two ways:
   - **Started at** and **Ended at** (date and time each). Use this for any day other than today, or for a shift that runs past midnight.
   - **Duration** (placeholder "or 1h30"): `1h30`, `90m`, `7:30`, `7.5`, `7,5`. A bare number is hours.
5. Tick **Billable** if the hour may be invoiced.
6. Click **Log**.

The fields clear and the hour appears in **Recent activity**, under the day it started.

## What gets refused

- Neither a duration nor a start: "Give a start and end, or a duration".
- A duration that cannot be read: "…is not a duration".
- An end that is not after the start.
- More than 24 hours in one entry ("A day has 1440 minutes").

## Good to know

- **Duration alone files the hour under today.** To log hours on an earlier day, give **Started at** and **Ended at**.
- When both times are filled in, **Duration** is disabled ("Taken from the times above"); the times win.
- **A start with no end starts a running clock**, it does not log a finished hour. A duration together with only a start is refused. Fill in both times, or use only a duration.
- **Billable starts unticked here.** The tickbox is sent every time, so an hour on a project is not billable unless you tick it. (A clock started from the **Run a clock** tab is billable by default on a project.)
- Billable only means something when the hour has somewhere to go. An **Internal — no client** hour can never be billable; the server clears it.
- Times use your browser's time zone.
- You cannot log hours for another person from this screen. Only for yourself.
- The assistant can log hours for you in plain words ("log 90 minutes on the website project"). See [the Time overview](help:time/index).
- To tidy up afterwards, see [correct or delete an hour](help:time/edit-or-delete-an-hour).
