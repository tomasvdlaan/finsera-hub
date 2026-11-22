---
title: Plan and run a sprint
summary: Create a sprint with a goal and dates, start it, follow its progress on the board, and finish it.
module: scrum
paths: [/board]
capability: scrum.board.manage
keywords: [sprint, plan sprint, start sprint, finish sprint, goal, iteration, close sprint, sprint bar, progress]
updated: 2026-10-23
---

A sprint is a fixed stretch of time with a goal. It is optional: "keep working as a flow board" is a fine answer, and a project does not have to have one. A project has at most one running sprint.

## Plan a sprint

1. On the board, click **Plan a sprint** (in the toolbar when the project has no sprint yet).
2. In the dialog **Plan a sprint** fill in:
   - **Name** (required), for example "Sprint 1"
   - **Goal**: one sentence, optional, but the thing most worth writing
   - **Starts** and **Ends** (dates, required). The suggestion is the next Monday (today if it is Monday) for two weeks.
3. Click **Plan it**.

The sprint is planned, not running. A bar shows its name, dates and goal, with **Start sprint**.

## Put cards in it

Open cards and set **Sprint** on each ([Open and edit a card](help:scrum/edit-a-card)). Once the sprint is running you can also use **+ sprint** from the backlog ([Backlog](help:scrum/backlog)).

## Start it

Click **Start sprint** on the bar. You get "… is running". The board now defaults to **This sprint**.

## While it runs

The sprint bar shows:

- The sprint name and goal.
- A meter and numbers: "Xh of Yh" when every card in the sprint has an estimate, otherwise "N of M cards". Blocked cards are counted ("· N blocked"). With no cards it says "Nothing in it yet".
- A day line: "Day N of M", "Starts … — M days" if it begins in the future, or "Ran to … — M days, still open" when past its end date.
- The meter turns amber and the day line is highlighted when progress is more than 20% behind the calendar, and red once the sprint is past its end date.

## Finish it

1. Click **Finish sprint**.
2. Read the confirmation: unfinished cards go back to the backlog, "Nothing is deleted — they lose their sprint and stay on the board."
3. Click **Finish sprint** to confirm.

You get "… finished — N back to the backlog". The sprint moves into [Sprint history](help:scrum/sprint-history).

## Good to know

- **Finishing is final.** A finished sprint cannot be restarted or edited into a running one ("That sprint is finished. Create the next one."). Its results are saved as a summary at that moment.
- A sprint does not close itself on its end date. It stays open and shows "still open" until you finish it.
- You cannot start a second sprint while one is running ("… is still running. Finish it before starting another.").
- While a sprint is running or planned the board does not offer **Plan a sprint** again; finish the current one first.
- If an action on the bar fails, the bar is replaced by the error message. Reload the page to get the buttons back.
- What counts as done is any card in a done column. See [Change the columns](help:scrum/columns-and-definitions).
- Sprint name, goal and dates can be corrected, and a planned sprint deleted, on [the sprint page](help:scrum/sprint-page).
- The assistant can report how the running sprint is going ("will we make it?"). It cannot plan, start or finish one.
- Starting, finishing and editing publish `sprint.started`, `sprint.completed` and `sprint.updated`.
