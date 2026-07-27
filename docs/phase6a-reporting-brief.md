# Phase 6a — Reporting & Dashboards

**Status:** ✅ built and verified (2026-07-28)
**Depends on:** every prior module's reporting views (all ten exist)
**Parent:** [build-roadmap.md](build-roadmap.md) §Phase 6

---

## 1. Where Phase 6 stands, and why this part first

Phase 6 has four parts. Two are available now, one is gated, one follows:

| Part | Status |
|---|---|
| **6a Reporting** | Built here — every module already publishes a view |
| **Proactive insight service** | ✅ Built 2026-07-28 — see §8 |
| 6b Meeting Notes | No dependency on 6a; can follow either |
| 6c Meeting Agent | **Blocked by gate G3** — transcription of client-confidential audio is the most privacy-sensitive choice in the whole roadmap, and it needs deciding before any code |

Reporting goes first because the data finally justifies it and because it is the one part
that is purely additive: it reads, and nothing it does can damage a record.

---

## 2. The decision that shapes this phase

### D1 — How does natural-language querying work?

The roadmap says *"natural-language querying translated to the published views."* The
obvious implementation is to let the model write SQL against read-only views.

**Not doing that.** Generated SQL against a live database is a category of risk this
platform has not taken anywhere else: an unbounded query surface, no way to review what
will run before it runs, and error messages that leak schema. "Read-only" limits the
damage to availability and disclosure, which is not the same as safe.

**Instead: metrics are tools.** Each number the assistant can report is a named tool with
typed parameters — `reporting_revenue`, `reporting_utilisation`, `reporting_pipeline` —
backed by a hand-written query. The model picks a metric and a period; it never composes
the query. This is narrower than free-form SQL, deliberately: every number it can state is
one someone wrote and tested.

When a question genuinely needs a new number, the honest answer is to add the metric, not
to hand the model a database connection.

### D2 — One dashboard, not role-based ones

The roadmap describes role-based dashboards. There is one role. A single overview page
covering money, delivery and pipeline is the useful thing; splitting it by a role
dimension that does not vary yet is architecture for an imagined org chart.

### D3 — Power BI reads the same views

A read-only Postgres role (`platform_readonly`) with `SELECT` on the `v_*` views only —
not on the tables. That means Power BI, or any other client, sees exactly what the
platform's own reporting sees, and cannot read a raw table or write anything.

Creating the role is in scope. **Exposing the port to the network is not** — that is a
deployment decision, and the role is useless to an attacker who cannot reach it.

### D4 — Numbers come from views, not from a second implementation

Every metric reads a `v_*` view. Nothing in reporting re-derives what a module already
computes — the fastest way to make two parts of a system disagree about revenue is to
calculate it twice.

---

## 3. The numbers worth having

For a solo consultancy, the questions that actually get asked:

| Metric | Question it answers | Reads |
|---|---|---|
| Revenue | What did I invoice, per month and per client? | `billing.v_invoices` |
| Outstanding | What is owed me, and how much is overdue? | `billing.v_invoices` |
| Unbilled work | What have I done but not charged for? | `time.v_entries` |
| Utilisation | How much of my logged time is billable? | `time.v_entries` |
| Project profitability | Hours and value per project against budget | `time.v_entries`, `crm.v_projects` |
| Pipeline | Quotes out, won, lost — and the conversion rate | `sales.v_quotes` |
| Renewals | Contracts ending or needing notice soon | `sales.v_contracts` |

**Unbilled work is the one that earns its place immediately.** It is money already earned
and not yet asked for, and until now nothing showed it in one number.

---

## 4. Tests

1. **Every metric agrees with the module it reads from** — reporting revenue equals the sum
   of the invoices Billing lists. Two implementations disagreeing is the failure mode.
2. **Period boundaries are inclusive-exclusive and correct** across a month and a year end.
3. **An empty period returns zeros**, not nulls or a crash.
4. **The read-only role cannot write**, and cannot read a base table.
5. **Metric tools refuse an unknown metric** rather than guessing.

---

## 5. Build order

| Step | Deliverable |
|---|---|
| 1 | Reporting service over the existing views, with the seven metrics |
| 2 | Overview page: money, delivery, pipeline |
| 3 | Read-only role + migration |
| 4 | AI metric tools (`read` only) |

---

## 6. What was built (2026-07-28)

Seven metrics over the existing views, an overview page, the read-only role, and seven
`read`-class AI tools. 14 tests.

**Verified live.** The overview reads €402,50 of work in hand (11.5h on Power BI), 100%
billable this month, nothing outstanding. Asked *"how much billable work have I done that I
haven't invoiced yet?"*, the assistant answered **"11.5 hours of unbilled work, valued at
€402.50 … entirely for the Power BI project for DocHorse"** — composed from metric tools,
with no SQL generated anywhere.

### The finding: view grants do not survive a restart

`ensureReportingViews()` DROPs and CREATEs each view at boot, and dropping a view drops its
grants. A `GRANT` written in a migration would therefore be correct exactly once and then
silently disappear on the next restart — Power BI would work on Monday and fail on Tuesday
with no change to anything.

The migration now creates only the role. `ReportingService.onApplicationBootstrap()`
re-applies the grants after every boot, discovering `v_*` views dynamically so a new module
is covered without editing two places. Boot logs
`Reporting: granted platform_readonly SELECT on 10 views.`

(The migration also failed outright on a fresh database, because it granted on views that
did not exist yet — the same root cause, caught earlier.)

---

## 8. The proactive insight service (2026-07-28)

Six deterministic rules over the published views: overdue invoices, unanswered quotes,
contract notice windows closing, budgets nearly spent, work left uninvoiced, stalled tasks.
16 tests.

**It notices and says so. It never acts** — no message sent, no record changed, no status
altered. Everything ends in a sentence on a screen, because the value of proactivity
evaporates the moment you cannot trust what it did while you were away.

Rules are SQL, not model output. An LLM drafting a follow-up message is useful; an LLM
deciding which invoices are overdue is a worse version of a WHERE clause.

### The first background writer

This is the platform's first scheduled process that writes, so the guarantees are narrow
and deliberate:

- It writes to `insights.insights` and nowhere else. The worst a bug here can do is show a
  wrong sentence.
- `refresh()` is idempotent, matched on natural keys — running it twice a minute and once a
  day produce identical rows. That is what makes restarting it safe, and it is verified
  live as well as in tests.
- A failing rule is logged and the other five continue.
- Disabled entirely under test, where a timer firing mid-assertion is only noise.

### Insights are the one derived thing that is stored

Everything else computed from today — `overdue`, `expired`, `expiringSoon` — is derived on
read and never stored. Insights are the deliberate exception, and only because they carry
something a computation cannot: whether **you** have already dealt with them. A dismissal is
a fact about a person.

Everything else about them stays derived. One whose condition stops being true **resolves
itself** rather than waiting to be dismissed; one that was dismissed stays hidden while it
remains true, because otherwise dismissing it would be worthless.

### `contract.expiring`, reconsidered

Phase 5b deferred publishing `contract.expiring` for want of something to notice the day it
became true. Building this made the better answer clear: it is not a domain event at all.
Nothing *happened* to the contract — a threshold was crossed relative to today. So it is a
rule, and the event was never published. Insights declares no domain events.

### Verified live

Work was temporarily aged by 45 days to make a rule genuinely fire: the overview showed
**"11.5h on Power BI has not been invoiced — €402,50 of work, the oldest 45 days ago"**, a
second refresh raised nothing new, and asked *"anything I should be worrying about?"* the
assistant reported exactly that one item and offered to draft the invoice. The dates were
then restored, and the insight **resolved itself** on the next run with nothing dismissed.

---

## 9. Deliberately not in this phase

- **No LLM-generated SQL.** D1.
- **No new stored aggregates.** Views are fast enough at this size, and a materialised
  total is a total that can be stale.
- **No charting library.** Numbers and small inline bars first; a chart dependency is
  worth adding when a number proves insufficient, not before.
