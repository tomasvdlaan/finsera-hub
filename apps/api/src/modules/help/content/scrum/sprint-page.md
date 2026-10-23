---
title: The sprint page
summary: One sprint with its goal, dates, progress, load per person, cards, links and timeline; correct it or delete it before it starts.
module: scrum
paths: [/board/sprints/:id]
capability: scrum.board.manage
keywords: [sprint detail, edit sprint, rename sprint, goal, dates, delete sprint, load, capacity]
updated: 2026-10-23
---

Each sprint has its own page at `/board/sprints/:id`. Links from search, a project's timeline or another record end up here. The sprint bar on the board does not link to it, and the **Sprints** tab only lists finished sprints, see [Sprint history](help:scrum/sprint-history).

## What is on the page

- The sprint name, a **Sprints** link back, and the line "start → end · state" (planned, active or completed, and when it was started).
- **Name**, **Goal**, **Starts**, **Ends**: editable fields. Dates are typed as `YYYY-MM-DD`.
- **Delete**, only while the sprint is planned.
- **Progress** (a running or planned sprint) or **Delivered** (a finished one), with a meter and "Xh of Yh" or "N of M cards".
- For a finished sprint, "N arrived after it started" / "N were pulled back out" and "N went back to the backlog when it closed".
- **Load**: for each person, hours across cards still open in the sprint, with a bar when a capacity was set for them (over capacity shows in an alert colour) or "no capacity set". Unassigned cards are listed separately.
- **Cards**: every card in the sprint with its column (or "done"), link, estimate and "blocked".
- **Links** and **Timeline**, as on any record. Link the sprint to a meeting note or a project here.

## Steps: correct a sprint

1. Open the sprint page.
2. Click **Edit** beside **Name**, **Goal**, **Starts** or **Ends**, change the text, and click **Save** (or press Enter; **Cancel** or Esc leaves it as it was).

Dates cannot be set so the end is before the start. Renaming also renames it wherever it is linked.

## Steps: delete a planned sprint

1. Click **Delete**.
2. Confirm **Delete … ?** with **Delete sprint**. "It has not started. Anything in it goes back to the backlog."

## Good to know

- **A sprint that has started cannot be deleted**, only finished: "its history is what a retrospective reads". Delete is hidden once it is active or completed.
- Name, goal and dates can still be changed on a running or finished sprint.
- Load only counts open cards, and the hours are the estimates.
- Capacity per person exists in the system but has no screen yet, so the **Load** bars appear only for capacity already set elsewhere.
- Changes publish `sprint.updated`.
