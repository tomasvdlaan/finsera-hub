# Phase 4 Requirement Brief — Task & Progress Tracking

**Companion to:** Master Document · AI Integration Plan · Build Roadmap · Decision Log
**Status:** Draft
**Date:** July 2026

---

## 1. What this module is for, and what it is not

Master §3.5 asks for per-project agile boards. The honest framing matters here more than in
earlier phases, because task trackers are a crowded market and the platform will not out-build
Jira or Linear.

**The value is not the board. It is what the board is attached to.** A task here sits next to
the client it serves, the hours logged against it, the contract governing it, and the documents
that describe it — and it appears on the client's timeline without anyone wiring that up. No
standalone tracker can do that, and that is the only reason to build one.

So the design goal is *sufficient* task tracking with excellent linkage, not feature parity
with anything.

**Non-goals:** story points and velocity forecasting as a discipline, workflow automation
rules, swimlanes, dependency graphs, multi-project portfolio views, and anything resembling
a Gantt chart. Client-visible task status is Phase 7; the Meeting Agent creating tasks from
action points is Phase 6c — this phase only leaves the seam for it.

---

## 2. Kanban first, sprints as opt-in

The master document says "not every project needs full SCRUM — the module also supports a
plain kanban mode for simple engagements". With 2–4 people and, today, one real client, that
sentence should be read as the *default* rather than the fallback.

**Recommendation: build the board first and completely; make sprints an opt-in per project.**

A board that works is immediately useful. Sprints without a team that runs ceremonies are
overhead — and a burndown chart with two people on it is decoration. Sprints stay in scope
because the master document wants them and they cost little once tasks exist, but they are
steps 5–6, not steps 1–2, and a project without them should never see them.

---

## 3. Entities

### 3.1 Task

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id — linkable, searchable, timeline-visible |
| `project_id` | uuid | **required**, structural ref to CRM |
| `title` | text | required |
| `description` | text? | |
| `status` | text | the board column it sits in; validated against the project's board |
| `assignee_id` | uuid? | core user |
| `estimate_minutes` | integer? | **minutes, not points** — see below |
| `priority` | text? | `low` / `normal` / `high` / `urgent` |
| `labels` | text[] | free tags; a taxonomy would calcify |
| `due_on` | date? | |
| `parent_id` | uuid? | an epic is a task with children, not a separate entity |
| `sprint_id` | uuid? | null when the project runs plain kanban |
| `rank` | numeric | manual ordering within a column |
| `completed_at` | timestamptz? | set when it enters a done column |
| `archived_at` | timestamptz? | |

**On minutes rather than story points.** Finsera bills time. An estimate in hours can be
compared directly against hours logged and against the project's budget — the comparison that
actually matters here. Story points are a velocity instrument for teams that need to forecast
across many sprints, which is not this. Minutes also keep one unit across the platform.

**On epics as parent tasks.** A separate "epic" entity would need its own screens, its own
permissions and its own place in every query. A self-reference gives grouping for free, and a
task with children renders as an epic without being a different kind of thing.

**On `rank` as numeric.** Fractional ranking means dragging a card writes one row, not the
whole column. Integer positions require rewriting every task below the insertion point, which
is how drag-and-drop turns into a slow endpoint.

### 3.2 Board

Per-project column configuration, owned by this module rather than by CRM — a board is a way
of working, not a property of the engagement.

| Field | Type | Notes |
|---|---|---|
| `project_id` | uuid | one board per project |
| `columns` | jsonb | ordered `{ key, label, isDone }` — `isDone` drives `completed_at` |
| `uses_sprints` | boolean | opt-in, default false |

Default columns: `to_do`, `in_progress`, `waiting_on_client`, `review`, `done`. Configurable
because a delivery project and a support engagement genuinely differ.

**On "waiting on client".** Confirmed as a default rather than an option. In consultancy it is
the state work spends most time in and the one nobody records — so it silently reads as "in
progress" and the board lies about where things stand. Making it a column also makes it
countable, which is what turns "we are blocked on them" from a feeling into evidence when a
deadline slips.

### 3.3 Sprint (only when enabled)

`id`, `project_id`, `name`, `starts_on`, `ends_on`, `goal?`, `state` (`planned` / `active` /
`completed`). One active sprint per project, enforced by a partial unique index — two active
sprints make "the current sprint" meaningless.

---

## 4. The link that justifies the module

Time entries gain an **optional** `task_id`, so hours can be logged against a task rather than
only a project.

**How the reference is stored matters.** Master §10 says references to entities owned by other
modules are stored as registry UUIDs, validated through the registry rather than as
cross-schema foreign keys. That is what we do here — which means **Time does not depend on
SCRUM at all**: it validates the id through `RegistryService` and renders the task's name from
the registry's display fields.

The dependency graph therefore stays:

```
Time  → CRM          (budget burn, unchanged)
Docs  → CRM          (filing, unchanged)
SCRUM → CRM          (tasks belong to projects)
SCRUM → Time         (start a timer from a task)
```

Acyclic, and Time gains a capability without gaining a dependency. Had we made `task_id` a
foreign key, Time would depend on SCRUM and SCRUM on Time — a cycle, and neither module
replaceable.

**Starting a timer from a task** (Master §3.5) is SCRUM calling `TimeService.createEntry`. The
running-timer model from Phase 2a needs no change: a start with no end, now carrying a task id.

---

## 5. Manifest

- **Entities:** `task` (`/scrum/tasks/:id`), `sprint` (`/scrum/sprints/:id`)
- **Structural refs:** `task → project` (required), `task → task` (optional parent), `task → sprint` (optional)
- **Publishes:** `task.created`, `task.moved`, `task.completed`, `task.assigned`, `sprint.started`, `sprint.completed`
- **Subscribes:** none yet — Phase 6c's Meeting Agent will publish `meeting.action_points_suggested`, and this module will subscribe to offer them as draft tasks
- **Permissions:** `scrum.tasks.read` / `.write`, `scrum.board.manage` (columns, sprints)
- **Navigation:** Board
- **Widgets:** `open-tasks` → CRM's project page
- **Reporting views:** `scrum.v_tasks`, `scrum.v_sprints`
- **Portal exposure:** none this phase; Phase 7 exposes task *status* in reduced form
- **AI tools:**

| Tool | Risk | Purpose |
|---|---|---|
| `scrum_list_tasks` | `read` | "what's open on Power BI?" |
| `scrum_task_detail` | `read` | one task with its hours and history |
| `scrum_create_task` | `write:draft` | capture work from a conversation |
| `scrum_move_task` | `write:draft` | "move the dataset task to review" |
| `scrum_break_down` | `write:draft` | split an epic into concrete tasks with estimates (AI plan §4) |

`scrum_break_down` is the first tool that *generates* content rather than reading or recording
it, so it ships as `write:draft` and stays there until it has a track record (O7).

---

## 6. Screens

1. **Board** — columns with cards, drag to move. The default screen.
2. **Task detail** — fields, subtasks, hours logged, plus core Links and Timeline.
3. **Backlog** — a flat, filterable list for planning; the board is for doing.
4. **Sprint bar** — only when the project enables sprints: current sprint, dates, progress.
5. **Project page widget** — open tasks, contributed through the manifest.

**On drag-and-drop.** It is the one genuinely fiddly piece of frontend in this phase. Plan is a
small dependency (`@dnd-kit`) rather than hand-rolling pointer maths, with keyboard-accessible
move controls as well — a board that only responds to dragging is unusable one-handed and
untestable without a real pointer.

---

## 7. Build order

| # | Step | Done when |
|---|---|---|
| 1 | `scrum` schema; board config with defaults | A project has a board on first visit |
| 2 | Task CRUD, ranking, status transitions | Tasks can be created and moved by API |
| 3 | Board screen with drag and keyboard moves | A week of work can be tracked on it |
| 4 | Task detail; `task_id` on time entries; timer from a task | Hours logged against a task roll up to the project |
| 5 | Sprints, opt-in per project | A sprint can be planned, started and closed |
| 6 | Simple burndown | Remaining estimate over sprint days |
| 7 | AI tools bound, incl. `scrum_break_down` | The assistant proposes a task breakdown |
| 8 | **Run one real engagement on it** | The board reflects what is actually happening |

Steps 5–6 are skippable if boards prove sufficient — that is a real outcome, not a failure.

**Size:** L · ~4–6 weeks, with step 3 the largest single piece.

---

## 8. Risks

**This is where scope creep lives.** Every task tracker grows checklists, custom fields,
automation and reports. The test for any addition: *does it make the linkage better?* Hours
against a task, tasks on a client timeline, a document attached to a task — yes. A custom
field builder — no.

**Estimates will be wrong and that is fine.** The burndown must not become a stick. It exists
to show budget burn against planned work, which the project page already does in euros.

**One active sprint per project** is enforced in the schema rather than the UI, because
"which sprint is current" becomes ambiguous the moment two are open, and every later query
inherits that ambiguity.

---

## 9. Questions for you

1. ~~**Board columns**~~ — **decided:** `waiting on client` is a default column (see §3.2).
2. **Sprints at all?** — the plan makes them opt-in and late. If you know you will not run
   sprints, say so and I will cut steps 5–6 entirely rather than build them speculatively.
3. **Estimates** — hours per task, or would you rather not estimate at all and let logged hours
   speak? Estimating is a habit, and an unused field is clutter.
4. **Who assigns work** — with 2–4 people, is an assignee field worth it now, or is everything
   implicitly yours until someone else joins?

**Proceeding on defaults for 2–4 unless you say otherwise:** sprints stay opt-in and late
(steps 5–6, skippable); estimate and assignee both exist but are optional fields — cheap to
carry, and an empty field is easier to ignore than a missing one is to add later.
