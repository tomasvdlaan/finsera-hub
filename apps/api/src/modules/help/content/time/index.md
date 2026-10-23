---
title: Time registration
summary: Run a clock or write down hours against a project, a client or internal work, hand in your week, and get hours ready to invoice.
module: time
keywords: [hours, timesheet, timer, clock, track, time tracking, registration, approve, week]
updated: 2026-10-23
---

Time is where everyone writes down what they worked on. Every hour is against a **project**, a **client with no project yet**, or **Internal — no client**. Billable hours on a project are what invoices are built from.

## The pages

| Where | What it is for |
|---|---|
| **Timesheet** in the navigation (`/time`) | The tracker: a clock, a form for hours you forgot, and your last 14 days. Its sub-tab is called **Tracker**. |
| **This week** tab (`/time/week`) | A read-only grid of your week by project, plus handing in the week, the approvals queue and the CSV export. |

There is also a clock in the top bar on every page. It shows **Start a timer** when nothing runs; when a clock runs it shows the elapsed time, what it is against, and a stop square.

## Tasks

- [Run a clock](help:time/run-a-clock) — start, stop, switch, and what to do with a clock left running.
- [Write down an hour](help:time/write-down-an-hour) — log time after the fact.
- [Correct or delete an hour](help:time/edit-or-delete-an-hour)
- [Read your recent activity](help:time/read-your-activity) — the header totals and the side cards on the tracker.
- [The week at a glance](help:time/week-overview)
- [Hand in your week](help:time/hand-in-your-week)
- [Approve or send back a week](help:time/approve-weeks) — approvers only.
- [Export hours to CSV](help:time/export-hours)
- [How hours reach an invoice](help:time/hours-and-invoicing)
- [Time widgets on the dashboard](help:time/dashboard-widgets)
- [Budget burn on a project](help:time/project-budget-burn)

## Who can do what

| You can… | Needs | Who holds it |
|---|---|---|
| Log, edit, delete and see your own hours, hand in your week, export your own hours | `time.entries.write_own` | Everyone |
| See everybody's hours (team export, "Load per person") | `time.entries.read_all` | Administrators only |
| Manage another person's hours through the API | `time.entries.manage` | Administrators only |
| Approve or send back somebody's week | `time.approve` | Administrators only |
| Include cost and margin in an export | `time.costs.read` | Administrators only |

`time.entries.manage` has no screen: the tracker and the week grid only ever show your own hours.

## The assistant

The assistant can read your week (`time_get_week`), read one of your days (`time_get_day`), log hours for you (`time_log_hours`), stop your running clock (`time_stop_timer`), and, if you may see everyone's hours, total the hours on a project against its budget (`time_project_hours`). It logs hours only for you. See [the assistant](help:shell/index).

## Good to know

- Weeks start on **Monday**.
- One clock at a time. Starting a second is refused.
- A single entry can be at most 24 hours (1440 minutes).
- Logging an hour records `time_entry.created`, also when you only start a clock. The entry is linked to its project or client, and to the card if there is one.
- Each month's hours are also written to a ledger file in SharePoint a few minutes after a change. There is nothing to do with it in the app.
- Hours are internal. Clients never see them in the portal.
- Colleagues' hours reach the [reporting](help:reporting/index) views as `time.v_entries` and `time.v_weekly_totals`.
