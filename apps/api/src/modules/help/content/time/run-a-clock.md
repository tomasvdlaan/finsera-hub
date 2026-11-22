---
title: Run a clock
summary: Start a timer on a project, client or internal work, stop it, pick up earlier work, and fix a clock someone forgot to stop.
module: time
paths: [/time]
capability: time.entries.write_own
keywords: [timer, start, stop, clock, track, continue, switch, forgot, running, stopwatch]
updated: 2026-10-23
---

The clock is the fastest way to log time: start it when you begin, stop it when you finish, and the hours are on your timesheet. It is the first tab, **Run a clock**, on **Timesheet** (`/time`).

## Start a clock

1. Open **Timesheet** in the navigation.
2. On the **Run a clock** tab, type what you are doing in **What are you working on?** (optional, but a billable hour with no description becomes a blank invoice line).
3. In the picker next to it, choose what the hour is against. The first choice is **Internal — no client**. Then come the **Projects** (shown as project — client) and **Clients — no project yet**.
4. Click **Start**.

The clock appears in the top bar on every page, so you can leave the tracker and it keeps running.

## Continue earlier work in one click

When no clock is running, a **Continue** row shows up to three recent pieces of work from your last 14 days (the same target and description), each with the time spent. Click one to start a clock on the same target with the same description.

You can also click the clock icon on an entry in **Recent activity**. It starts a new clock with that entry's target and description, and leaves the old entry untouched.

## Stop the clock

- From the tracker, click **Stop**.
- From any page, click the stop square (**■**) next to the clock in the top bar.

The entry gets its end time and duration and moves into **Recent activity**.

## Start from a card

On a card in [Scrum](help:scrum/start-a-timer-from-a-card), **Start timer** begins a clock on that card's project and records the card on the hour. That is the way to get hours that show up against the card's estimate.

## A clock left running

- After 10 hours the clock row turns to a warning style.
- After **24 hours** it cannot be saved as it stands, because one entry may not exceed a day. The tracker explains this and shows a field, **How long did you actually work? e.g. 2h30**, with a **Stop and log** button. Enter the real duration; the entry is saved starting at the original start time and lasting that long.
- The stop square in the top bar does not ask. For a clock over a day it takes you to the Time page to do this.

## Good to know

- **One clock at a time.** While one runs the **Start** form and the **Continue** chips are hidden and the clock icon on rows is disabled (its tooltip says a timer is already running).
- A clock started on a project is **billable by default**. A clock on a client-only target or on **Internal** is not. You can change this afterwards, see [correct an hour](help:time/edit-or-delete-an-hour).
- Durations you type accept `1h30`, `90m`, `7:30`, `7.5` or `7,5`. A bare number means hours.
- Starting a clock records `time_entry.created`, the same as logging an hour.
- The assistant can start and stop a clock for you too. See [the Time overview](help:time/index).
- The dashboard has a [Timer widget](help:time/dashboard-widgets) for the same thing.
- To log something you did not time, see [write down an hour](help:time/write-down-an-hour).
