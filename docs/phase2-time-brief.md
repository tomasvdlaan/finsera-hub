# Phase 2 Requirement Brief — Time Registration & Assistant v1

**Companion to:** Master Document · AI Integration Plan · Build Roadmap · Decision Log · Phase 1 CRM Brief
**Status:** Draft for approval
**Date:** July 2026

---

## 1. Why this phase matters more than the others

Phase 2 is where the platform stops being a demo. Two things happen for the first time:

**Daily use.** Logging hours is the only thing in the platform someone does *every day*. CRM
gets touched when a client changes; a timesheet gets touched constantly. This is what gate G1
tests — not "does it work" but "did the spreadsheet actually stop being the source of truth".

**Cross-module dependency.** Time Registration is the first module that needs another module's
data: budget burn requires the project's budget from CRM. It must call CRM's service, never its
schema. Phase 0 asserted this discipline in a boundary rule; Phase 2 is the first time it costs
something real.

**Proposed split.** The roadmap puts Time Registration and Assistant v1 in one phase, which is
~6–9 weeks of work in one lump. I recommend splitting:

- **2a — Time Registration** (M, ~3–4 wk) → dogfood immediately, gate G1
- **2b — Assistant v1** (M–L, ~3–5 wk) → build once there is real data worth asking questions about

The assistant is far more useful against three months of real hours than against an empty
database, and 2a delivers value on its own. If time is short, 2a alone still passes G1.

**Non-goals:** tasks and task-linked timers (Phase 4), invoice generation (5c), rate cards with
effective dates (5b), utilization dashboards (6a — basic figures only here), leave/absence
(Phase 8+).

---

## 2. The design constraint that shapes everything

The master document sets it: **logging a day should take under a minute.** That is not a nice-to-have
— it is the difference between a platform that gets used and a spreadsheet that never dies. Every
decision below is subordinate to it.

Concretely, entering a normal day must be:

1. Open the week view (no navigation, it is the landing screen)
2. Type hours into a cell for the right project row
3. Done — saved on blur, no Save button, no modal, no page transition

**Implications, stated deliberately:**

- **A week grid, not a list of entries.** Rows are projects, columns are days. One screen shows
  the whole week and where the gaps are.
- **No required fields beyond hours.** Description is optional. Requiring a note per entry is the
  single most common reason time tracking gets abandoned.
- **Keyboard-first.** Tab moves across days, Enter down to the next project. Hands stay on the
  keyboard for a full week of entry.
- **Rows persist.** Projects you logged to last week appear this week, pre-listed and empty. Most
  weeks are the same handful of projects.

If a change makes the common case slower, it is the wrong change — even if it is more correct.

---

## 3. Entity: Time Entry

One entity type, owned by the `time` module.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | registry id |
| `person_id` | uuid | **required** — the core user who did the work |
| `project_id` | uuid | **required** — structural ref to CRM's project |
| `worked_on` | date | **required** — the day, not a timestamp |
| `minutes` | integer | **required** — stored as whole minutes, never decimal hours |
| `billable` | boolean | defaults from the project's billing model |
| `description` | text? | optional, deliberately |
| `submitted_at` | timestamptz? | set when the week is submitted; entries lock |
| `created_at` / `updated_at` | timestamptz | |

**On minutes rather than decimal hours.** Same reasoning as money in cents: 7.4 hours is not
representable exactly in binary floating point, and these numbers eventually multiply by a rate
to produce an invoice. Whole minutes are exact, and the UI can still accept "7,5" or "7:30" and
convert at the edge.

**On `worked_on` being a date.** Hours are logged against a day, not a moment. Timers (Phase 4,
started from a task) will still resolve to a day plus a duration.

**On the composite index.** `(person_id, worked_on)` — the week view's only query shape.

**Deliberately absent:** start/end times, a separate "activity type", per-entry rates. Rates live
on the project (Phase 1) and later in rate cards (5b); duplicating them onto entries would create
two sources of truth for invoicing to disagree about.

---

## 4. Submission, and why not approval

The master document mentions "weekly submission and (optional) approval flow". With 2–4 people
who all see everything, approval is ceremony — you would be approving your own colleague's hours
with no new information.

**Recommendation: submission without approval.** Submitting a week sets `submitted_at`, locks
those entries against casual edits, and publishes `timesheet.submitted`. Invoicing (5c) keys off
that event.

Approval remains easy to add later: a second timestamp and one more event. Building it now costs
UI, a state machine, and a permission that nobody exercises.

**Unlocking** is allowed — an admin can reopen a submitted week. Real timesheets get corrected;
a lock that cannot be undone just means people avoid submitting.

---

## 5. The first real cross-module call

Budget burn on the project page needs, per project: budgeted hours or amount (CRM) and hours
logged (Time). The rule from Master §10 is explicit — Time calls CRM's **service**, never
`crm.projects`.

```
TimeService.projectBurn(actor, projectId)
  → CrmService.getProject(actor, projectId)      // budget, rate, billing model
  → own query: SUM(minutes) for that project
  → returns { budgetedHours, loggedHours, budgetAmountCents, burnedAmountCents }
```

The widget lands on CRM's project page but is contributed *by* the Time module, through the
manifest's `widgets` section. That is the mechanism doing what it was designed for: CRM gains a
burn indicator without CRM changing.

**Note the direction.** Time depends on CRM; CRM does not depend on Time. Keeping the dependency
graph acyclic is what lets a module be replaced later.

---

## 6. Manifest (2a)

- **Entities:** `time_entry` (`/time/entries/:id`)
- **Structural refs:** `time_entry → project` (required); `time_entry → person` (required)
- **Publishes:** `timesheet.submitted`, `timesheet.reopened`, `time_entry.created`
- **Subscribes:** none
- **Permissions:** `time.entries.write_own`, `time.entries.read_all`, `time.entries.manage` (reopen a submitted week)
- **Navigation:** Timesheet
- **Widgets:** `project-burn` → CRM's project page
- **Reporting views:** `time.v_entries`, `time.v_weekly_totals`
- **Portal exposure:** none — hours are internal-only, and stay that way in Phase 7
- **AI tools:**

| Tool | Risk | Purpose |
|---|---|---|
| `time_log_hours` | `write:draft` | "log 3 hours on the dashboard project yesterday" |
| `time_get_week` | `read` | "what did I log this week?" |
| `time_project_hours` | `read` | "how many hours have gone into X?" |
| `time_unsubmitted_weeks` | `read` | feeds the Phase 6 proactive nudge |

---

## 7. Assistant v1 (2b)

The first user-facing AI, per AI plan §2–3. Four components, all on core services:

1. **Conversation store** — persisted per user, resumable, linkable to entities it touched.
2. **Orchestrator** — takes the message plus current-page context, builds the tool set (already
   working, from Phase 0), loops tool calls, streams the answer with citations. Enforces risk
   classes; it does not ask the model to behave.
3. **Chat surface** — a sidebar, context-aware to the current page (decision O5; recommendation
   stands: sidebar first, command palette later).
4. **Eval set** — a dozen representative prompts with expected behaviour, so quality is measured
   rather than assumed.

**Scope: read-heavy.** Launch with `read` tools across CRM and Time, plus `crm_create_lead` and
`time_log_hours` as the first `write:draft` tools. Everything already declared in the manifests —
no module changes needed, which is the payoff for declaring them early.

**Explicitly not in scope:** semantic search (Phase 3, with documents), proactive nudges
(Phase 6), any `write:commit` tool.

---

## 8. A blocking privacy decision

**This must be resolved before the assistant touches real data.**

The platform currently runs on a Google Gemini API key. Google's free-tier Gemini API terms allow
using submitted content to improve their products — which is incompatible with client-confidential
data. Right now that is harmless: the only AI calls are a test with fabricated input. From 2b
onward, the assistant would send real client names, project details, notes and hours.

Options:

| Option | Cost | Data position |
|---|---|---|
| Paid Gemini API (Google Cloud) | needs a card | Paid tier excludes training on your data |
| Anthropic API | needs a card | Zero-retention terms available; decision D6's default |
| Self-hosted small model | hardware/time | No third party at all; weaker tool-use |
| **Build 2a only, defer 2b** | none | No AI calls at all until this is settled |

**Recommendation: build 2a now, defer 2b until a paid API account exists.** It costs nothing —
2a is the phase that passes G1 anyway — and it avoids the one mistake that would be genuinely
hard to walk back: client data in a third party's training set. This also closes open decision O9
(currently written for Anthropic; it applies to whichever provider is used).

---

## 9. Build order and done criteria

**2a — Time Registration**

| # | Step | Done when |
|---|---|---|
| 1 | `time` schema + migration; TimeEntry service | An entry can be created via API and registers |
| 2 | Week grid screen with keyboard entry | A full week can be logged without touching the mouse |
| 3 | Submission + reopen, `timesheet.submitted` | Submitted weeks lock; admin can reopen |
| 4 | Project burn widget via CRM's service | Budget burn shows on the project page |
| 5 | Basic figures: hours per person/week, billable share | Numbers match hand-counted reality |
| 6 | Reporting views + AI tools bound | `/api/core/ai/tools` lists them |
| 7 | **Log real hours for a full week** | The spreadsheet is not opened that week |

**Gate G1** is step 7, plus honestly answering: *is entering a day still under a minute after the
novelty wears off?* If not, fix that before Phase 3 — every later module assumes hours are in here.

**Size:** 2a: M, ~3–4 wk · 2b: M–L, ~3–5 wk (deferred pending §8)

---

## 10. Questions for you

1. **Time granularity** — free-form minutes, or snap to 15-minute increments? Recommendation:
   store exact minutes, let the UI accept `1,5` / `1:30` / `90m`.
2. **Non-billable categories** — do you need to distinguish internal work, sales, and admin, or is
   a billable/non-billable flag enough for now? A category field is cheap; a taxonomy is not.
3. **Logging for others** — can one person log hours on another's behalf, or strictly your own?
   Recommendation: own only, with `read_all` so everyone can see totals.
4. **FinSera as a client** — you entered your own company as a client record. If that is for
   tracking internal work, it works well and internal hours will report properly. Confirm it was
   deliberate.
5. **Test data** — my "De Chocolaterie" fixtures are still in the dev database alongside your real
   client. Clear them?
