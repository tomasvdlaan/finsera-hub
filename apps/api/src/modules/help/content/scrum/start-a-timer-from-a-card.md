---
title: Start a timer from a card
summary: Start the clock on a card so the hours count against its estimate.
module: scrum
paths: [/tasks/:id]
capability: time.entries.write_own
keywords: [timer, start timer, track time on task, logged hours, estimate, switch, card hours]
updated: 2026-10-23
---

Starting the clock from a card puts the card on the hour. That is what makes "Xh logged of Yh" on the card move, and what stops an hour showing up as "billable, no card".

## From the card popup (board)

1. Open the card ([Open and edit a card](help:scrum/edit-a-card)).
2. Click **Start timer** at the top right.

If another clock is running, the button reads **Switch to this**: it stops the running clock and starts one on this card. If this card's clock is already running, it reads **Running** and is disabled.

## From the full card page

Click **Start timer** in the row of controls. See [The full card page](help:scrum/card-page).

## From an assistant answer

A task card shown in the assistant's answer has **start timer** and **open** links.

## What gets started

A running clock on the card's project, described with the card's title, linked to the card. It is the same clock as everywhere else, shown in the top bar. See [Run a clock](help:time/run-a-clock).

## Good to know

- **Full page and assistant card do not switch.** If a clock is already running, the server refuses with "A timer is already running — stop it first". The full page shows that message; the assistant card shows nothing. Stop the running clock first, or use the popup's **Switch to this**.
- The full page does not show that a clock is running on the card. Check the top bar.
- Hours logged against a card are summed on the card and in the assistant's task detail.
- A clock started this way is billable by default, like any clock on a project.
- Starting a timer needs `time.entries.write_own` (everyone), as well as being able to see the card.
- Moving the card to done with an estimate and nothing logged triggers a warning. See [Move a card](help:scrum/move-a-card).
