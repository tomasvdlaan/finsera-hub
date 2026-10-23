---
title: Sprint history and velocity
summary: See finished sprints, what each delivered against what it took on, and the trend across sprints.
module: scrum
paths: [/board/sprints]
capability: scrum.tasks.read
keywords: [velocity, retrospective, finished sprints, delivered, scope change, history, trend]
updated: 2026-10-23
---

The **Sprints** tab (`/board/sprints`) is the record of sprints that have been finished. Pick the project in the picker at the top.

## Finished

Each finished sprint shows:

- Its name, dates, and "ran over" if it ended after its end date.
- Its goal, if it had one.
- A meter and "Xh of Yh" or "N of M cards": what was delivered of what it committed to. The unit is decided when the sprint closed: hours if every card had an estimate then, cards otherwise.
- A bar of what kind of work was delivered (stories, bugs, chores, spikes).
- "N of these arrived after it started" (and "N left") when cards were added to or taken out of the running sprint.
- "N cards went back to the backlog" for what was not finished.

The rows are not links. Each sprint also has its own page, see [The sprint page](help:scrum/sprint-page).

With nothing finished, you see "Nothing finished yet. A sprint appears here the moment it is closed…".

## Velocity

When at least two finished sprints in a row were measured in the same unit, a **Velocity** panel appears: one bar per sprint (oldest first), and "Averaging N hours (or cards) a sprint". If an older sprint used a different unit, the panel says which ones are "not comparable" and leaves them out.

## Good to know

- Planned and running sprints are not on this page. See them on the board, or open them from a link ([The sprint page](help:scrum/sprint-page)).
- The summary is frozen when the sprint is finished. Estimating cards later does not change it.
- Delivered counts cards in a done column when it closed.
- Velocity needs the sprints to have been closed in the same measuring unit. Estimating everything keeps it comparable.
- To close a sprint, see [Plan and run a sprint](help:scrum/plan-and-run-a-sprint).
