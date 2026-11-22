---
title: Hand in your week
summary: Tell your approver a week is finished, and what to do when it is approved or sent back.
module: time
paths: [/time/week]
capability: time.entries.write_own
keywords: [submit week, timesheet approval, hand in, submit timesheet, returned, sent back, approved, resubmit]
updated: 2026-10-23
---

Handing in says "this week is finished". An approver then approves it, which releases the hours to be invoiced, or sends it back with a reason.

## Steps

1. Open **Timesheet**, then the **This week** tab (`/time/week`).
2. Use **← Previous** / **Next →** until the grid shows the week you want to hand in.
3. In the **Hand in this week** card below the grid, click **Hand in this week**.

You get the message **Week handed in.** and the card changes to "Handed in on … and waiting on a decision."

## What the card can say

| Card says | Means | What you can do |
|---|---|---|
| Text about handing in, and the button | Nothing handed in for this week | Hand it in |
| **Handed in** … and waiting on a decision | An approver has not decided | Wait |
| **Approved** … These hours can be invoiced. | Done | Nothing |
| **Sent back.** followed by a reason | The approver wants something fixed | Fix the hours on the tracker, then click **Hand it in again** |

## From the dashboard

The **My week** widget does the same for the current week (button **Submit the week**, or **Send it again** after a send-back). See [Time widgets](help:time/dashboard-widgets).

## Good to know

- **Handing in does not lock your hours.** You can still edit or delete entries, until they are invoiced. If you change a handed-in week, tell the approver.
- **An approved week cannot be handed in again.** The server says "That week has already been approved".
- Handing in a week again after a send-back clears the old reason.
- A week you never hand in is not blocked from invoicing. Only weeks that are handed in (waiting) or sent back are held back from invoice drafts. See [How hours reach an invoice](help:time/hours-and-invoicing).
- There is no check that the week looks complete (no minimum hours). Approvers are shown how many billable hours have no card, see [approve a week](help:time/approve-weeks).
- The card is about one week at a time. Earlier weeks are reached with **← Previous**.
