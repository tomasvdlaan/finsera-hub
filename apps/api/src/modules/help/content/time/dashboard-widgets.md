---
title: Time widgets on the dashboard
summary: What each Time block shows, what clicking it does, and which ones need extra rights or enough history.
module: time
capability: time.entries.write_own
keywords: [dashboard, widget, timer, my week, logged today, rhythm, load per person, waiting on you, timesheet health, working pattern]
updated: 2026-10-23
---

Time contributes ten blocks you can place on a dashboard, and one for a project page ([Budget burn](help:time/project-budget-burn)). They draw on the same entries as the tracker. Most of them look at your own last 14 days.

Blocks that need history are hidden from the picker until there is enough to draw. That is deliberate; it is not an error.

## Your own time

| Widget | Shows | Click or use |
|---|---|---|
| **Logged today** | Hours written down today, with a small 14-day trail ("nothing yet" when zero). | Click opens the tracker. |
| **Your rhythm** | Hours per day as bars, including empty days. Setting **Days to show**: 7 to 90, default 14. | Opens the tracker. |
| **Where the week went** | Hours split by project, top six, biggest first, with a legend. | Opens **This week**. |
| **Working pattern** | A grid of roughly the last quarter (63 days), Monday-aligned, so habits appear as stripes. Hidden until you have at least 20 days with hours. | Opens the tracker. |
| **Hours with nowhere to go** | Billable hours in the last 14 days that are not tied to a card, and how many entries. Warning colour when there are any. | Opens the tracker. |
| **Timer** | See below. | Buttons in the card. |
| **Timesheet health** | This week Monday to Friday as five blocks, and up to three billable hours with no card, each with an **Attach to…** picker listing that project's cards. | Picker in the card. |
| **My week** | Hours logged this week and where the week stands: "Not submitted yet.", "Submitted. Waiting on a decision.", "Approved — these hours can be invoiced." or the reason it was sent back. | **Submit the week** or **Send it again** (hidden when submitted or approved). |

### Timer

Idle it shows 0:00:00 and **Nothing running**. Click **Start a timer**, then choose a project from **Pick a project…**; the clock starts at once. Running it shows the clock, the description (or project), the project, and "against a card" or "no card". Buttons: **Stop**, and **Switch** (choose another project in **Switch to…**). If the clock has run more than a day, the button is **Stop on the Time page** instead.

## For people who may see more

| Widget | Needs | Shows |
|---|---|---|
| **Load per person** | `time.entries.read_all` (administrators); hidden until at least two people have logged time | Hours each person logged over the last fortnight. A bar appears only for people with contracted hours set. Others show "no hours contracted". Opens **This week**. |
| **Waiting on you** | `time.approve` (administrators); hidden until a week is waiting | Handed-in weeks with hours, entries and "N with no card", and **Approve** / **Send back**. See [Approve a week](help:time/approve-weeks). |

## Good to know

- Widgets need `time.entries.write_own`, which everyone has, except the two above.
- To tie an hour to a card for sure, start the clock from the card itself. See [Start a timer from a card](help:scrum/start-a-timer-from-a-card).
- **Switch** in the Timer widget starts a new clock. If a clock is already running, the server refuses a second one. Stop first, then start. The **Start timer** button in a card's popup does switch for you.
- **Send back** in **Waiting on you** asks for its reason in a browser prompt, and an empty answer is refused.
- Widgets are placed and sized from the dashboard. See [the dashboard](help:shell/index).
