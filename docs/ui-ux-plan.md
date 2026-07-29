# UI/UX plan — the internal platform

**Status:** proposed, 2026-07-29
**Scope:** `apps/web` (the internal app). The client portal (`apps/portal`) is out of scope;
it was designed recently and is small.

---

## 0. How this was produced, and what is weak about it

Six agents audited the existing surfaces; a seventh established what a solo consultancy
actually does and how often. Four complete information architectures were then written from
four organising principles — jobs-first, client-centric, money-and-time, assistant-first —
each committed fully rather than hedged. Three judges scored them on distinct lenses.

**Two flaws worth knowing before trusting the conclusion:**

1. **Only two of the four architectures reached the judges.** The digest passed to them was
   truncated, so *money-and-time* and *assistant-first* were never scored. The spine below
   won 9–4 and 8–5 against *client-centric* alone. The comparison is real but incomplete.
2. **The final revision pass died** on a session limit, so the critiques were merged by hand
   rather than by the agent that was supposed to do it.

The critiques themselves survived intact, and they are the most valuable output — the
feasibility critic cut roughly half the plan, and every cut below is one of its.

---

## 1. The diagnosis

The platform is organised around **its own module list**, not around the work.

- The sidebar is thirteen equal-weight entries because thirteen manifests declare
  `navigation`. "Rate cards" — touched a few times a year — is a visual peer of "Timesheet",
  touched several times a day.
- **There is no front door.** `/` redirects to `nav[0]?.path` (`App.tsx:62`), and `nav` is the
  manifests in registration order with CRM first. Every session opens on a list of client
  records, and nobody chose that. `Overview`, the one page built to orient, is 10th of 13.
- **Lists don't carry the fact you'd open the record to learn.** `ClientList` renders one link
  per client under a caption calling it "the pipeline" — no value, no overdue, no last
  contact. `ContractList` computes `needsAttention` and then renders the prose "N contracts
  need attention — see the badges below" above an unsorted list. There is no `sort(` call
  anywhere in crm or sales.
- **Feedback is absent.** No toast, no `aria-live`, nowhere in the app. Issuing an invoice —
  the one irreversible act — is confirmed by a badge quietly flipping.
- **Danger is invisible.** `.link-button:hover { color: var(--error) }` turns *edit*, *cancel*,
  *download PDF* and *delete* the same red, so the signal carries no information. "Archive
  client" fires a DELETE with no confirmation from the same row as the status dropdown.

### Two defects found on the way, which are bugs today

| | |
|---|---|
| **Navigating during a live meeting stops the recording** | `LivePanel.tsx:139` — `useEffect(() => () => stopEverything(), [stopEverything])`. The cleanup runs on unmount, and the panel lives inside a note page you can navigate away from. |
| **A quote's hourly rate is entered in raw cents** | `QuoteDetail.tsx:213` is labelled "Hourly rate (cents)" and takes `Number(v)`, two inches below a line editor denominated in euros. `sales.service.ts` copies it onto the project created on acceptance, so a 100× typo becomes a live billing rate. |

Neither depends on this plan. Both should be fixed regardless.

---

## 2. Principles

Each states what it **rules out**, because a principle that forbids nothing decides nothing.

1. **The front door answers "what now", never "what exists."**
   Rules out a landing page that is a record list; rules out the `nav[0]` redirect; rules out
   a KPI wall with no actions on it. A number on the front door that doesn't link to the
   record behind it or start a job does not belong there.

2. **State that outlives a page belongs to the chrome, not to a route.**
   A running timer is a time entry with a start and no end. `GET /time/running` and
   `POST /time/stop` exist and are called from nowhere in `apps/web`, and `DayView` queries by
   `workedOn` — so a timer started Friday is invisible on Monday while minutes keep accruing.
   Rules out navigating to a page to discover whether a clock is running.

3. **Frequency sets residency; everything rare gets one door.**
   Rules out thirteen equal-weight entries; rules out a new nav slot per module; rules out
   configuration beside daily work. Touched monthly or less ⇒ behind Setup.

4. **Every list row carries the fact you would otherwise open the record to learn.**
   Rules out `<li><Link>{name}</Link></li>`; rules out run-on muted sentences as rows; rules
   out computing the answer and then asking the user to go and find it.

5. **Irreversibility is visible before the click and confirmed after it.**
   Rules out one button style for edit and delete; rules out destructive actions adjacent to
   routine controls; rules out silence as feedback.

6. **Money and dates get typed controls; never free text, never a browser dialog.**
   Rules out any cents-denominated input; rules out `placeholder="YYYY-MM-DD"`; rules out
   `window.prompt` as an input method — six files still use it.

7. **One canonical home per thing.** Every other appearance is contextual, scoped to a parent,
   and labelled differently.

8. **Recognition first, ⌘K second, browse third — and never delete a rail entry before search
   exists.** `core.entities` already stores `entityType`, `displayName` and `urlPath` per row
   with an index, and nothing queries it.

---

## 3. Navigation

Seven entries, in two tiers, replacing thirteen flat ones.

| | Entry | Path | Frequency | Absorbs |
|---|---|---|---|---|
| **1** | Today | `/today` | every session | Overview, Insights |
| **1** | Hours | `/time` | daily | Timesheet, `/time/week` |
| **1** | Work | `/scrum` | daily | Board, Meetings, Client requests |
| **1** | Clients | `/crm/clients` | daily lookup | Clients, Projects |
| **1** | Money | `/billing` | weekly, monthly peak | Invoices, Quotes, Contracts |
| **2** | Library | `/docs` | occasional | Documents |
| **2** | Setup | `/setup` | rarely | Rate cards, Organisation, Platform modules |

**Paths are the existing ones.** The synthesis proposed renaming everything (`/billing` →
`/money`, `/scrum` → `/work`, …) with 23 permanent redirects. The feasibility critic called
that the single biggest cut available and it is right: `urlPath` is denormalised into
`core.entities` by twelve hardcoded template literals across module services, so a rename
needs a data migration, edits to six manifests, and `Insights.subjectPath()`. **All of that
buys prettier URLs and nothing else.** The rail labels do the work; the addresses can stay ugly.

**Who owns the rail.** Honestly: the shell does. The groupings cross module boundaries
(Work = scrum + meetings + portal; Money = billing + sales + reporting) and no per-module
`section` declaration can express that. Manifests keep declaring navigation so a new module
still self-registers — the shell decides which section it lands in.

---

## 4. Pages

34 pages: 8 new, 19 reworked, 5 merged away, 2 kept. The full inventory lives in the workflow
transcript; the ones that matter:

**New**
- `/today` — the front door. What needs attention, today's hours with an autofocused quick log,
  today's meetings, the timer. Every number links to the record behind it.
- `/today/attention` — the full insight queue, sorted by severity.
- `/setup` — one page, three sections (business details, rate cards, platform modules).
- `/billing/run` — a period-scoped, resumable billing run.

**Reworked, highest value first**
- `/billing` — ageing buckets, sortable columns, drafts visually distinct from issued.
- `/billing/invoices/:id` — the draft expands the underlying time entries; excluding one
  deselects it rather than silently unbilling it.
- `/crm/clients` — decision-carrying sortable columns; `?view=projects` absorbs the Projects entry.
- `/crm/clients/:id` — a 314-line twelve-section scroll becomes an overview that answers
  "what is the state of this relationship" above the fold, plus a Record tab for the fields.
- `/time` — the week grid becomes the default; the day view becomes a drill-in.

**Merged away**
`/crm/projects` → `/crm/clients?view=projects` · `/sales` + `/sales/contracts` → one pipeline ·
`/reporting` → Today plus a numbers page · `/insights` → Today plus the attention queue ·
`/time/week` → the default mode of `/time`.

---

## 5. Design system

**Build a token layer plus about twelve primitives in plain CSS and React. Adopt nothing.**

MUI, Mantine or Chakra means rewriting 8,641 lines of TSX against a new component API, or
running two visual systems side by side for months — and it would fight TipTap (ten packages)
and dnd-kit, both of which bring their own DOM and styling. Tailwind means touching every
`className`, discarding 907 lines of working CSS, and buying nothing functional. Neither pays
for itself for one developer whose bottleneck is not authoring speed.

The existing CSS is not the problem. It caps prose at 72ch while leaving layout free; it has
real reasoning in it. It needs a vocabulary, not a replacement.

**Tokens:** semantic colour in *both* `:root` and the dark block (`--danger`, `--warning`,
`--ok` are used at five sites today with hardcoded hex fallbacks and are defined nowhere),
spacing, radii, type scale.

**Primitives:** `Page` (title, actions, `useDocumentTitle` — every tab currently reads
"Finsera Platform"), `Button` with a real `destructive` variant, `Dialog`/`ConfirmButton`,
`DataTable` (sortable), `MoneyInput`, `DateField`, `Toast` + one `aria-live` region,
`Skeleton`, `Breadcrumb`, `Tabs`, `EntityPicker`, `useDirtyGuard`.

---

## 6. Rollout

Reordered from the synthesis: **safety first, not the front door.** The critic was right that
the highest value per unit of work is the primitives layer, because it fixes money-losing
defects and gives every later stage its vocabulary.

### Stage 1 — Safety and vocabulary · 2–3 days · no API work
Token layer in both themes. `Button` variants with a genuine destructive style, retiring
`.link-button`. `Dialog`/`ConfirmButton` replacing all `window.confirm`/`window.prompt` sites
across six files. Confirmation on archive-client, delete-draft, delete-entry. `MoneyInput`
(deleting the cents input) and `DateField`. Toast plus one `aria-live` region. `focus-visible`.

*Fixes two real defects and makes the app stop being able to lose work silently.*

### Stage 2 — A front door · 2–3 days · one small API addition
`/today` composed from the existing Overview and Insights content plus today's entries and an
autofocused quick log. Timer bar in the shell against the two endpoints that already exist
with zero callers. `home` becomes `/today`, and `/today` gets a manifest entry so it is
actually in the rail. A real 404 and a degraded shell when `GET /core/navigation` fails.

*Needs `GET /meetings?date=` — currently only `clientId` and `projectId` are accepted. Drop
"meetings today" from v1 if you'd rather not touch the API yet.*

### Stage 3 — The money loop · ~1 week · real bug fixes
`draftFromHours` gains a period argument — today invoicing on the 3rd sweeps in the new month,
because `entriesForBilling` has no date predicate. Reconcile `sourceEntryIds` so trimming a
line's quantity stops permanently unbilling the hours it dropped. Invoice draft expands the
underlying entries. Dirty-state guard on Issue, and a success state naming the allocated
number with the PDF. Ageing buckets and sortable columns. A single-page billing run.

*This is the stage that repairs correctness rather than relocating pages.*

### Stage 4 — Collapse the rail · 3–4 days
Seven shell-owned entries pointing at existing paths. One `/setup` page with three sections.
Delete the two bare `NavLink`s that sit outside `<nav>` (their active-state className has
never matched anything).

### Stage 5 — ⌘K · 3–4 days
`GET /core/search` over `core.entities` only — core is forbidden from importing modules, so
folding in the docs and meetings search endpoints is not available. Empty query lists by
entity type, so browsing survives. **No command verbs** — that is a second write surface and a
second parser for a single user who already has an assistant.

### Stage 6 — Pages that answer questions · 1–2 weeks
`DataTable` everywhere. Client index and client detail restructured. Project page stating
commercials once instead of twice. Board defaulting to all projects.

### Stage 7 — Later
Live meeting as a hoisted session that survives navigation (fixes the recording bug properly).
Assistant history. Pipeline merge. Project profitability.

**Cut from the synthesis, deliberately:** all route renames and the 23 redirects; `/go/:id`;
⌘K verbs; the per-client roll-up columns (they need a new cross-module reporting endpoint —
worth doing, but not as a precondition); the four-tab client split reduced to two; the hours
month roll-up; `/ask`; the `/library` rename; the first-run checklist.

---

## 7. What you have to decide

1. **How often do you actually quote?** The whole tier assignment rests on an inference from
   the code — time daily, invoicing monthly, quoting weekly-ish. If you quote twice a week,
   the pipeline deserves tier 1 and Money splits.
2. **Should the platform send invoices, or stay at "download the PDF and send it yourself"?**
   `billing.manifest.ts` declares `billing_send_invoice` with a handler that does not exist.
   Several pages in this plan say "chase the oldest overdue invoice" — but there is no concept
   of an invoice having been *sent*, so either add `sentAt`/`lastChasedAt`, or drop the word.
3. **Is logging time from a phone a real job?** One breakpoint is cheap; a genuinely
   mobile-first `/today` is a different project.
4. **Will anyone else ever log hours here?** Everything above assumes one person. The timer bar
   is singular and `/time` has no person dimension, though the endpoints already accept `personId`.
5. **Is the assistant meant to be the primary interface?** The assistant-first architecture was
   written and never judged. If you use the assistant heavily, that proposal deserves a fair
   hearing before this plan is committed to.
