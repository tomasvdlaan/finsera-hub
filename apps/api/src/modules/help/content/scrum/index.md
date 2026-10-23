---
title: Scrum board
summary: A kanban board per project, with optional sprints, a backlog, and flow measurements, plus the cards (tasks) that hold the work.
module: scrum
keywords: [board, tasks, cards, kanban, sprint, backlog, scrum, columns, work, tickets]
updated: 2026-10-23
---

Every project has a board. The work on it is a set of **cards** (tasks) that move through columns from left to right until they reach a done column. A project can run as a plain **flow board**, or can also plan **sprints**. Sprints are optional, and a project does not have to have one.

## The pages

| Where | What it is for |
|---|---|
| **Board** in the navigation (`/board`) | The board itself: cards, columns, filters, sprint bar. Start here. |
| **Flow** tab (`/board/flow`) | How long work really takes, what is going stale, how much waits on the client. |
| **Sprints** tab (`/board/sprints`) | Finished sprints and your velocity. |
| **Columns** tab (`/board/settings`) | Change the columns of a board. Not in the navigation; reached from the tabs. |
| A card (`/tasks/:id`) | One card in full: fields, subtasks, discussion, links, timeline. |
| A sprint (`/board/sprints/:id`) | One sprint: goal, dates, load per person, cards. |

All four tabs share one project. Switching tabs keeps the project you chose.

## Tasks

- [Use the board](help:scrum/use-the-board)
- [Add a card](help:scrum/add-a-card)
- [Move a card](help:scrum/move-a-card)
- [Filter and group the board](help:scrum/filter-and-group)
- [Open and edit a card](help:scrum/edit-a-card), and [the full card page](help:scrum/card-page)
- [Break a card into subtasks](help:scrum/subtasks)
- [Mark a card blocked](help:scrum/block-a-card)
- [Start a timer from a card](help:scrum/start-a-timer-from-a-card)
- [Show a card to the client](help:scrum/client-visibility)
- [Archive a card](help:scrum/archive-a-card)
- [Plan and run a sprint](help:scrum/plan-and-run-a-sprint) and the [backlog](help:scrum/backlog)
- [The sprint page](help:scrum/sprint-page) and [sprint history and velocity](help:scrum/sprint-history)
- [Change the columns](help:scrum/columns-and-definitions)
- [Read the flow figures](help:scrum/flow-metrics)
- [Scrum blocks on the dashboard](help:scrum/dashboard-widgets)

## Who can do what

| You can… | Needs | Who holds it |
|---|---|---|
| See boards, cards, sprints and flow | `scrum.tasks.read` | Everyone |
| Create, edit, move, block, archive cards | `scrum.tasks.write` | Everyone |
| Change columns, create, start, finish, edit and delete sprints | `scrum.board.manage` | Everyone |

None of the three is restricted to administrators. The screens do not hide a button from someone who lacks a capability; the server refuses the action and the message "Missing capability '…'" appears.

## The assistant

The assistant can list cards, show one with its subtasks and logged hours, create a card, change a card's fields (title, description, estimate, priority, due date, type, assignee, sprint, parent, column), and move a card. It can also report how the running sprint is going and give flow figures for a project. It cannot make a card visible to the client. That choice stays with you. See [the assistant](help:shell/index).

## Good to know

- **Default columns** for a new board: **To do**, **In progress**, **Waiting on client**, **Review**, **Done**.
- The board loads up to 500 cards per request.
- Events published: `task.created`, `task.moved`, `task.completed`, `task.assigned`, `task.blocked`, `task.unblocked`, `sprint.started`, `sprint.updated`, `sprint.completed`.
- Hours logged on a card (see [Time](help:time/index)) show on the card as "logged" against its estimate.
- Clients can see only the cards you marked visible, and only a few fields. See [Show a card to the client](help:scrum/client-visibility).
- Each project page also gets an **Open cards** block. See [Scrum blocks](help:scrum/dashboard-widgets).
