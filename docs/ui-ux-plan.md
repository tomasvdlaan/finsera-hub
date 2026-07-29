# UI/UX plan — the internal platform

**Status:** stages 0–3 built, 2026-07-29
**Scope:** `apps/web`. The client portal (`apps/portal`) is out of scope — recently designed, small.

---

## 0. Process, and the mistake that changed the answer

Seven agents audited the existing surfaces and established what a solo consultancy actually
does and how often. Four complete architectures were written from four organising principles.
Three judges scored them on separate lenses. Two critics attacked the synthesis.

**The first run silently judged only two of the four.** The digest passed to the judges was
truncated mid-sentence, so *The Loop* and *Thread-first* were never scored — and the plan
committed on 2026-07-29 was built on that half-comparison. The re-run fixed the truncation
(per-proposal compaction, and a schema that rejects a judge returning fewer than four scores)
and **the winner changed.**

| Architecture | Daily use | Coherence | Buildability | Total |
|---|---:|---:|---:|---:|
| **The Loop — hours in, euros out** | 8 | **8** | **7** | **23** |
| Day, Week, Month — jobs-first | **9** | 7 | 5 | 21 |
| Thread-first — the assistant is the application | 4 | 3 | **8** | 15 |
| Client Workspaces | 3 | 4 | 3 | 10 |

Two conclusions worth stating plainly:

- **The proposal that won was the one the first run never saw.** Had we not re-judged, the
  plan would have been built on a spine that placed second.
- **The assistant should not be the primary interface.** Thread-first scored highest on
  buildability (8) and lowest on the two lenses that matter for a tool used daily. Its own
  self-diagnosis is the reason: *"conversation is the wrong interface for repetition and for
  comparison, and this platform is mostly repetition and comparison."* Logging an hour by
  typing into a parsed field beats asking for it, every time.

---

## 1. The diagnosis

The platform is organised around **its own module list**, not around the work.

- Thirteen equal-weight sidebar entries, because thirteen manifests declare `navigation`.
  "Rate cards" — twice a year — is a visual peer of "Timesheet".
- **No front door.** `/` redirects to `nav[0]?.path` (`App.tsx:62`), which lands on the client
  list only because `CrmModule` is first in `app.module.ts`. Nobody chose that.
- **Lists are tables of contents.** `InvoiceList.tsx:63` computes that some invoices are
  overdue and renders the literal string *"— some overdue"*, with no count and no names.
  `ContractList.tsx:77` computes exactly which contracts need attention, then renders it as
  prose above a list left in server order.
- **Danger carries no signal.** `.link-button:hover` turns *edit*, *cancel*, *download PDF* and
  *delete* the same red. Meanwhile issuing an invoice — legally irreversible — gets a
  `window.confirm`, while archiving a client fires immediately.
- **You retype what the system already has.** Applying a rate card matches a project by typed
  name (`p.name === name?.trim()`). Attaching a signed contract PDF asks for a raw UUID.

### Four defects that are bugs today, independent of any redesign

| | |
|---|---|
| **Navigating during a live meeting stops the capture** | `LivePanel.tsx:139` — `useEffect(() => () => stopEverything(), …)`. Worse than it sounds: the browser capture dies while the Recall bot stays in the client's call, still costing money. |
| **A quote's hourly rate is entered in raw cents** | `QuoteDetail.tsx:213`, labelled "Hourly rate (cents)", inches below a euro-denominated line editor, copied onto the project on acceptance. A 100× typo becomes a live rate. |
| **Closing the assistant destroys the conversation** | `App.tsx:125` — `{assistantOpen && <Assistant/>}`. The panel is unmounted, taking the turns and the `conversationId` with it. |
| **A timer started Friday is invisible on Monday** | `GET /time/running` exists and nothing in `apps/web` calls it. `DayView` derives running state by scanning one day's entries, so the clock keeps accruing where you cannot see it. |

---

## 2. The two principles that shape everything else

**1. The record URL is a data structure, not a design surface.**
`entities.urlPath` is denormalised per row from **12 hardcoded templates** across the module
services, and `Timeline.tsx`, `Links.tsx` and `Assistant.tsx` all navigate straight to that
stored string, while `Insights.subjectPath()` hardcodes the same paths again. A rename is a
synchronised backfill *plus* a redirect table *plus* a rewrite — it cannot ship in slices, and
a half-done state produces dead assistant citations.

> Rules out `/clients/:id`, `/money/invoices/:id` and every pretty record route. **The sidebar
> may say "Money" above pages whose detail routes still read `/billing/invoices/:id`.**

**2. Nest before you cut.** Consolidate by grouping existing routes, not by deleting
destinations and promising a search box will find them again.

> This is what makes the whole plan cheap, and it retires the largest sequencing risk in the
> earlier draft: ⌘K stops being a precondition for the navigation work.

Five more, in brief: every list row carries the number you'd otherwise open the record to find;
consequence sets confirmation weight (hard deletes get a dialog, soft deletes get an undo
toast); anything outliving a page lives in the chrome; never make him retype what the system
has; one triage queue, and a new alert type joins it or does not exist.

**Estimates are in risk, not days.** `apps/web` has **one** test file against 8,641 lines of
TSX; `apps/api` has 40. The binding constraint is not typing speed — it is silently breaking
the invoice issue path with no test that would notice.

---

## 3. Navigation

Five groups plus Today, Find and a utility rail. **Nothing is deleted; paths are unchanged.**

| Entry | Path | Contains |
|---|---|---|
| **Today** | `/today` | + `/today/inbox` — one triage queue |
| **Time** | `/time` | day, week, month as URL-synced modes of one route |
| **Money** | group | `/billing`, `/sales`, `/sales/contracts`, `/reporting`, `/money/run` |
| **Clients** | `/crm/clients` | resident, unchanged path |
| **Work** | group | `/crm/projects`, `/scrum` |
| **Record** | group | `/docs`, `/meetings` |
| **Find** | `/find` | ⌘K overlay is the primary form |
| **Assistant** | — | panel only (⌘J), no route |
| **Setup** | group | `/platform/settings`, `/sales/rate-cards`, `/platform/modules` |

Mechanically this is `navigationSchema` gaining `group` and `order` — one field, thirteen links
reordered — rather than seven route deletions.

---

## 4. Design system

**Token layer plus ~12 primitives. Adopt no framework.** MUI/Mantine/Chakra means rewriting
8,641 lines against a new component API, and would fight TipTap (ten packages) and dnd-kit,
both of which bring their own DOM. Tailwind means touching every `className` and discarding 907
lines of working CSS. Neither pays for itself for one developer whose bottleneck is not
authoring speed.

The one dependency worth adding is **Radix** for `ConfirmDialog`/`ReasonDialog`/`Toast` —
focus trapping and `aria-live` are the parts worth not hand-rolling. Dates use native
`<input type="date">`, so the dependency budget drops rather than grows.

---

## 5. Rollout

**Stage 0 — Make the shell tell the truth.** *Small, near-zero risk, touches no route.*
Status bar over `GET /time/running` + `POST /time/stop` (both shipped, both uncalled). Assistant
state lifted out of the conditional render so closing stops destroying the conversation. The two
dead `NavLink`s moved inside `<nav>`. `document.title` per route. A real 404.

**Stage 1 — Tokens, and nothing else.** *Small, visual-only risk.*
Semantic colour that actually exists and is theme-aware; `StatTile`; button variants where
destructive and quiet are distinguishable; `focus-visible`.

**Stage 2 — Dialogs and the destructive-action rule.** *Medium, concentrated in sales/billing.*
All 13 `window.confirm`/`prompt` sites replaced. The confirmations that **don't exist today**
added: archive client, delete time entry, delete draft quote, remove rate line, void draft
invoice. Undo toasts for anything soft-deletable.

**Stage 3 — Grouped navigation, Today and the Inbox.** *Large; the riskiest, for reasons
unrelated to UI — it touches the sealed manifest schema.*
`navigationSchema` gains `group`/`order`. `/today` composed from endpoints that mostly exist.
Both new rules shipped. `quote_accepted_by_client` fires on a real acceptance — a client
agreeing to spend money and nobody noticing is the kind of quiet that gets expensive.
`setup_incomplete` reads `core.org_settings`, deliberately widening the rules' stated
"published views only" contract rather than publishing a view over a one-row settings table:
core is not another module, it is the dependency every module already has.

**`/today/inbox` was not built, deliberately.** Insights and client requests both keep their
canonical homes under "nothing is deleted", and Today already surfaces both. A third surface
over the same rows is what principle 7 forbids — the merge the plan wanted is achieved by
Today linking to each, not by a fourth address.

**Stage 4 — Find.** *Medium.* `GET /core/search` over the entities table, a trigram index, ⌘K.
No longer a gate on anything.

**Stage 5 — Time, whole.** *Medium.* Date synced to the URL both ways; day/week/month as modes;
quick-add above the fold, autofocused, remembering the last project instead of the alphabetically
first — the same defect `Board.tsx:89` has.

**Stage 6 — Money.** *Large, highest regression risk.* Closes two blocking billing defects: line
edits silently discarded into a legally immutable invoice, and trimmed quantities silently
marking every source hour invoiced. Credit notes made first-class. Real rows on the lists.

**Stage 7 — Clients and Work carrying real signal.** *Medium, plus one non-trivial aggregate
across four schemas* for per-client outstanding, unbilled, last contact and open quote.

**Stage 8 — The assistant's confirmation loop.** *Small in code, disproportionate in care.*
`tool-registry.service.ts:94` gates `write:commit` on `options.confirmed`, and `Assistant.tsx:117`
never sends it — so write tools are currently unreachable rather than merely unconfirmed.

---

## 6. What you have to decide

1. **What is your actual daily rhythm?** This spine assumes "log time, move work, chase money" —
   a queue spanning clients. If your day is really "spend a block inside one client's world",
   Clients belongs above Time and the runner-up architecture deserves another look.
2. **Does non-billable work get logged?** Proposals, learning, admin, marketing, building this
   platform. A time entry requires a `projectId`, so there is nowhere to put it. This is *The
   Loop*'s self-diagnosed blind spot: it treats every hour as an input to an invoice, and will
   quietly punish the investment that produces next year's revenue.
3. **Do invoices leave the platform, or leave Outlook?** `billing.manifest.ts:83` declares a
   `sendInvoice` handler that does not exist in the service.
4. **Should the frontend get a test floor before stage 6, or during it?** One test file against
   8,641 lines, and stage 6 rewrites the invoice issue path.
5. **Is logging an hour from a phone real?** At 375px the content column is roughly 91px. The
   plan deliberately does not include a mobile mode.
