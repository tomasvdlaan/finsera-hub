---
title: Approve or send back a week
summary: Decide on weeks colleagues have handed in, from the queue on the week page or from the dashboard.
module: time
paths: [/time/week]
capability: time.approve
keywords: [approve timesheet, send back, return week, approvals, reject, approver, queue, waiting on a decision]
updated: 2026-10-23
---

Approvers see the weeks people have handed in and either approve them or send them back with a reason. Approving releases a week's hours to be invoiced.

## Before you start

Only administrators hold `time.approve`. For anyone else the **Waiting on a decision** card has nothing in it (no list, no buttons), and the approvals endpoint refuses them.

## Approve a week

1. Open **Timesheet**, then the **This week** tab (`/time/week`).
2. In the **Waiting on a decision** card, find the person. Each row shows their name (a link to their person page), "week of" date, the hours and number of entries, and, when relevant, "N with no card".
3. Click **Approve**.

You get "…'s week approved." and the row leaves the list.

## Send a week back

1. In the same row click **send back**.
2. In **Send …'s week back?** fill in **What needs fixing** (required), for example "Thursday has no hours against a working day".
3. Click **Send it back**.

The person sees the reason on their own card ([Hand in your week](help:time/hand-in-your-week)) and can hand it in again once fixed.

## From the dashboard

The **Waiting on you** widget lists the same weeks with **Approve** and **Send back**. Send back there asks for the reason in a plain browser prompt, and refuses if you leave it empty. See [Time widgets](help:time/dashboard-widgets).

## Good to know

- **Approving is final in the app.** There is no button to reopen an approved week, and no confirmation before approving.
- Only a week in **submitted** state can be decided. Two approvers cannot overwrite each other's decision: the second gets "No week is waiting on a decision there".
- A reason is required to send back. Without one the server refuses.
- "With no card" counts billable entries that are not tied to a card on the board. They are the most common reason to send a week back, and invoices are easier to explain when billable hours point to a card. See [Scrum](help:scrum/index).
- The hours total on the queue only counts entries that have a stored duration, so a clock still running is not in it.
- Nothing stops an administrator from approving their own week.
- Decisions are recorded in the audit trail (`time.week.approved` / `time.week.returned`).
- The same approver power is separate from editing other people's hours (`time.entries.manage`), which has no screen.
