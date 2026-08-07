<!--
  Produced 2026-08-07 by an eight-agent pass: a visual audit, an IA map, and the two operator
  journeys (finance/engagement manager, developer) in parallel; then a dashboard spec, a
  design-system spec and an IA spec; then one synthesis that resolves the disagreements.

  Companion to ui-ux-plan.md, which shipped stages 0-3 on 2026-07-29. That plan was about
  information architecture and behaviour — a front door, grouped navigation, lists that carry
  numbers, confirmation weight. Visual craft was never its subject, which is why the app
  behaves better than it looks and why "stale" survived it.
-->

# Finsera Platform — UI/UX Elevation Plan

*Reconciled from four inputs: visual audit, dashboard spec, design-system spec, IA spec, plus the two operator journeys. All facts re-verified against the repo on 2026-08-07.*

---

## 1. Diagnosis — why it reads as stale

Five mechanisms, all verifiable:

**1. A layout class that does not exist.** `.stat-row` is used on `/today`, `/money` and `/platform/modules`. `grep -c stat-row apps/web/src/styles.css` → **0**. `.stat` has no `display` rule, so the four tiles fall back to block layout and stack full-width. The complaint "a single stacked vertical column, half the screen empty" is not a design decision — it is a missing rule. The correct grid (`.stats`) exists and is applied to the wrong page.

**2. Every surface is at the same height.** `box-shadow: var(--shadow-1)` sits on `section`, `.panel`, `.task-card`, `.sprint-bar`, `.editor-sheet`, `.tracker-clock`. When one shadow is on all **108** `<section>`s, elevation encodes nothing and nothing is foreground.

**3. Every container is the same box.** The global `section` rule and `.panel` are byte-identical — same padding, border, radius, shadow, and a constant `margin-top: var(--space-4)`. There is no mechanism by which one block can outrank another.

**4. Tables are unstyled HTML.** `<table>` appears in **15 files** with no `td`/`th` styling anywhere, padded by inline `style={{width:'1%'}}` hacks. Three of five blocks on `/today` are browser-default tables. That is the single strongest "unfinished" signal an interface can send.

**5. The layout never gains a column.** Two `max-width` breakpoints exist in 4,495 lines and **zero** upward ones. At 1440px and at 2560px the page is the same one-column flow of full-width blocks holding 300–500px of ink.

Underneath all five: the app is mid-migration between two design systems (`section` vs `Panel` — 108 vs **3** uses; `button.primary` vs `.btn-primary`; two incompatible `Stat` components). The newer one is better everywhere, and ~85% of screens still render the older one.

---

## 2. Design thesis

**An instrument, not a brochure.** Finsera sells the ability to turn a client's messy operational data into a screen someone acts on before their first coffee. The platform should be the proof: dense where density is earned, quiet where it is not, and never showing a number you cannot act on. That means three commitments. *Numbers get bigger and headings get smaller* — block titles become 11px uppercase wayfinding, data becomes 28–44px; that inversion alone is most of the perceived elevation and costs no new markup. *Exactly one surface per page is lifted* — everything else is a flat panel on the page background, so elevation means "this is the thing." *Width is spent on columns, not on stretching one column.* Aesthetically: warm neutrals, petrol green as the only saturated ink outside of alarm states, hairlines and negative space doing the structural work that shadows currently fail to do, and a data-visualisation palette that survives both themes at ≥3:1. It should read like a Bloomberg terminal designed by someone who also cares about paper — which is exactly the pitch Finsera makes to clients.

The honest second half of the thesis: **the fastest route to "dense and alive" is not decoration, it is connection.** The developer journey found four capabilities that are built, tested and have no control in the web app — `assigneeId` filtering, `taskId` on time entries, `blockedOnUserId`, `projectId` on the docs list. Wiring those up produces screens with genuinely more to show — a card that knows its own hours, a `/today` that is actually yours, a blocker with a face on it. Styling an empty page just makes the emptiness more legible.

---

## 3. Stages

Each stage is independently shippable, leaves the app coherent, and gates on `pnpm verify` green plus a light+dark screenshot of every route it touches.

### Stage 0 — Fix the defects (½ day)
**Not design. Bugs.**

| Change | Where |
|---|---|
| Add an interim `.stat-row` grid rule (deleted again in Stage 3) | `styles.css` |
| Define `--font-mono` (consumed at `:1760`, `:2105`, never declared) | `styles.css :root` + dark block |
| Strip the seven `var(--token, #hex)` fallbacks | `:925, 958, 1058, 1061, 1138, 1145, 1173` |
| Delete ~180 lines of dead CSS (`.nav-section*`, `.statusbar-*`, the first-gen conversation list at `3795-3904`, `.definitions`, `.meter-label`, `.room-answer/-asked`) | `styles.css` |
| Merge the 22 duplicated selector blocks, `.task-card` (1665 + 1838) first | `styles.css` |
| `.priority-high` `#d97706` → `var(--warning)` | `:2462` |

**After:** `/today`, `/money` and `/platform/modules` show tiles in a row instead of a column. Nothing else changes. Reviewable in fifteen minutes and it removes the loudest symptom.

---

### Stage 1 — The token layer, and flatten everything (1–2 days)
Whole-file, single commit. This is the stage most likely to surprise, so screenshot both themes before and after.

**Changes** (all in `styles.css`, both `:root` and the `prefers-color-scheme` block):
- **Type ramp with a job per step.** Adds `--text-2xs` (11px, the uppercase micro-label, currently re-typed by hand at twelve sites) and `--text-md` (17px). Retargets the top: `h1` = 36px, `h2` = 22px, `--text-2xl` = 28px becomes a *usable* heading and the small metric size. The hole between 15px and 24px is what makes every section shout equally.
- **Elevation as four named planes.** `--plane-1-*` (panel: border, no shadow), `--plane-2-*` (the one lifted thing), `--plane-3-*` (overlays only), `--plane-sunk-bg` (wells). **Remove `box-shadow` from `section` and `.panel`.** Dark mode raises with a lighter surface rather than a shadow — which the dark block's own comment already argues for and only 12 sites honour.
- **Density scale** as a cascading mode: `--row-h`, `--row-pad-y/x`, `--control-h`, switched by `[data-density="compact"]`. Layout spacing (`--space-*`) and in-component spacing stop being the same scale.
- **`--edge: 3px`** plus a `[data-edge]` utility using `::before` — replaces ~14 literal `border-left: 3px` sites and removes the `overflow: hidden` on `.task-card` that currently clips its own focus ring.
- **Focus ring** as `box-shadow` (follows `border-radius`, survives `overflow: hidden`), **z-index scale**, **motion tokens** (`--dur-1..4`, `--ease-out`, `--ease-in-out`), **weight scale**.
- **The `--viz-1..6` categorical palette**, plus sequential and diverging ramps, contrast-checked in both themes. Unused this stage — it exists so the charts in Stage 8 have colours to draw with.
- **`.label`** consolidated: one uppercase micro-label rule replacing twelve declarations.
- **One global `prefers-reduced-motion` block** replacing the five local ones.

**After:** every card in the app flattens at once. The dialog, the command palette and the board's drag ghost become the only floating things — and immediately read as floating. Nothing has moved; everything has stopped competing.

---

### Stage 2 — `PageHeader` + the page grid (1 day)
New file `shell/ui/layout.tsx`. `shell/` never imports from `src/modules` — every primitive lives under `shell/ui/` and is consumed downward only.

- `PageHeader({ title, subtitle, back, meta, actions, tabs, sticky })`. Applied to **all 20 routes in one commit** — half-migrated headers are the most visible possible inconsistency, and it is a three-line change per page.
- `.page` — a 12-column grid on `main`, with `container-type: inline-size` so the board preview and the assistant rail (which change `main`'s width without changing the viewport) get the right answer. Three declared widths: `.page` 90rem default, `data-width="wide"` 120rem for table pages, `data-width="read"` 46rem for documents and forms. `main { max-width: 1600px }` and `main > p { max-width: 72ch }` are deleted; the cap moves onto the page, which declares its own kind.

**After:** every page has a place for its primary action — which is why every page's actions are currently a naked row of `<select>` elements. Breadcrumbs stop being hand-written `<p><Link>← Clients</Link></p>`.

---

### Stage 3 — `DataTable`, `StatTile`, `MetricRow` (2 days)
New file `shell/ui/data.tsx`. The largest single visual gain in the plan.

- `DataTable` — a real `<table>` (screen readers, and the app already emits them everywhere) with sticky head, `align="num"` right-alignment + tabular-nums, `align="action"` replacing every `style={{width:'1%'}}`, `hideBelow` for responsive column dropping, sortable headers with `aria-sort`, keyboard-reachable rows, and skeleton loading rows. **Applied to all 15 table files in one commit** — one styled table beside fourteen browser-default ones looks worse than fifteen default ones.
- `StatTile` + `MetricRow` — replaces the interim `.stat-row`, the shared `Stat`, and `Overview.tsx`'s second incompatible local `Stat`. Carries `unit`, `hint`, `delta`, `trend` (an inline `Sparkline`), `emphasis="hero"`. Delta colour is by *direction*, not sign: "overdue up 12%" is bad, "hours logged up 12%" is good.
- `Skeleton`. Loading stops being `<p className="muted">Loading…</p>` hand-written in every module.

**After:** the app stops looking like a wireframe. This is the stage where a client screenshot becomes shareable.

---

### Stage 4 — `/today`, rebuilt (2 days)
`modules/today/Today.tsx`, on the Stage 2 grid.

- **Masthead** (span 12, no chrome): the real date at 32px, a one-sentence state line assembled from at most two clauses in priority order (urgent decisions → unaccounted hours → blocked cards → "Nothing is on fire"), and a **Me / Everyone** segmented control persisted to `localStorage`. No greeting.
- **Needs a decision** (span 5) · **In flight** (span 4) · **Ledger** (span 3): three narrow reporting calls (`/reporting/unbilled`, `/outstanding`, `/pipeline`) — *not* `/reporting/overview`, whose seven-aggregate fan-out the existing code comment correctly refuses.
- **Waiting on others** (span 6) · **Next 7 days** (span 6).
- **The scope toggle passes `assigneeId`** to `/scrum/tasks`. The controller has accepted it since day one and **no screen has ever passed it**. Until now, a page titled *Today* showed the whole company's WIP under a heading that says "Doing", and the empty-state copy "Nothing in progress — pick something up" was literally unreachable.
- Every block: real skeletons, independent load and independent failure (preserve the existing per-call error design — do not regress to `Promise.all`), and honest empty states that name why they're empty.

**After:** three columns of real content at 1440px, all of it filtered to you, with a one-click escape to everyone.

---

### Stage 5 — "The Day", and binding the clock to the work (2–3 days)
The focal point, and the fix for the developer journey's worst hour.

- **The Day** (span 12, the page's only `--plane-2` surface): an SVG ribbon over a 07:00–21:00 window with three lanes — meetings booked, time logged (billable solid, non-billable hatched — same substance, worth less), and **gaps ≥25 min drawn behind**. A now-marker; the running entry drawn open-ended to it. Right rail: hours logged at 44px mono, a billable meter, unplaced-entry count, and one always-present primary button.
- Entries without start/end (manual entries are real) are **not invented onto the axis** — they surface in the rail as "2 unplaced entries · 1h30". Fabricating positions is the one thing that makes a data product untrustworthy.
- **`taskId` through the timer**: add tasks to `TargetPicker`, carry `taskId` through `useRunningTimer.start()` and the `Running` interface, add a start-clock control to `TaskCard` and `TaskPreview`. Today the *fastest* way to start a clock produces the *least* useful entry — no task, so the card's "0h of 8h" never moves.
- **"Stop that & start this."** `time.service.ts` correctly refuses a second timer; the UI answers with red text. Replace with a two-button inline strip everywhere a start can be refused.

**After:** you can see the shape of your day from across the room, and starting the right clock is one click from wherever you are.

---

### Stage 6 — Navigation and routes (2 days)
Deliberately after the pages are worth navigating to. One atomic commit, redirects for one release.

- **Six anchors** — Today · Inbox | Work · Clients · Money · Record — with an inline sub-nav that expands under the active anchor. Default state is 6 rows; today it is 11 always, plus four pages hidden entirely.
- **Delete `hidden` from the manifest contract.** It currently means "removed from every index", and it is why four commercial pages (quotes, contracts, invoices, rate cards) are unreachable from ⌘K. Demotion becomes `sub: true`, which stays fully searchable.
- **URLs stop naming modules**: `/crm/clients` → `/clients`, `/scrum` → `/board/:projectId` (deep-linkable, replacing the project `<select>`), `/sales` + `/billing` → `/money/*`, `/scrum/tasks/:id` → `/tasks/:id`, `/platform/*` → `/settings`.
- **Add the guard test** that asserts every manifest `navigation.path` and `entities[].urlPattern` matches a declared route. It fails on seven existing paths on day one — five declared deep-link targets and two hardcoded links currently resolve to `NotFound` and nothing tells you.
- Delete `/time/day` (a 300-line orphan with zero inbound links) and `/scrum/flow` (becomes a view toggle on the board).
- ⌘K gains the create actions it lacks: New client · New project · New quote · New invoice · New task · Start timer on… · Go to board…

---

### Stage 7 — `/inbox` (2 days)
Merges `/insights` and `/portal/requests` into the only surface in the product with a per-person addressee. Four lanes: **blocked on you** (computed live, not on the 6-hourly scheduler, not gated behind 3 days) · client asks · decisions · undecided action points. One badge in the rail, one `subjectPath()`.

Ships with the block dialog finally collecting **`blockedOnUserId`** — the endpoint accepts it, the service writes it, the spec tests it, and the UI asks only for `reason`, so the column has been null forever. A blocker with a face on it is what makes the row worth its space.

---

### Stage 8 — The two charts, and one `Meter` (2 days)
Hand-rolled SVG, ~200 lines total, zero dependencies.

- **Rhythm, 14 days** (span 5): stacked billable/non-billable day bars from two `/time/week` calls. A weekday with zero logged gets a 2px `--danger` baseline tick — otherwise "nothing to log" and "forgot to log" render identically, in an hourly-billing business.
- **Burn vs elapsed** (span 7): one dot per active project, x = % schedule elapsed, y = % budget consumed, against a diagonal with a ±10pp tolerance band. *Anything up and to the left is the problem.* Renders `/reporting/project-profitability`, which is **built, tested, and called by no page in the app**. Includes the `budgetHours` fallback that fixes `ProjectBurn.tsx:38`, where the meter silently vanishes on fixed-fee projects — the model where burn matters most.
  - Chosen as a scatter *specifically for n=2*: two labelled dots against a diagonal is a legible chart; two bars in a ranking is a stub.
- **`Meter`** — one component with three heights, replacing **nine** independent "rectangle whose width is a ratio" implementations.

---

### Stage 9 — `SplitView` on detail pages (1–2 days)
`ClientDetail.tsx` is twelve consecutive bare `<section>`s in one column on a 1144px canvas. Becomes a `SplitView`: identity, contacts and health in a sticky aside; work, money and documents in the main column. Same for `ProjectDetail`. `Panel` gains `emphasis="quiet" | "feature"` and `padding="flush"`, which lets `.assistant-history section` and `.room-block` — two rules that exist purely to *undo* the global section styling — be deleted.

---

### Stage 10 — Cleanup (1 day)
`Button` consolidation (ten button appearances → one `.btn` plus `.chip` and `.nav-row`; resolve the `button.primary` weight-600-vs-500 self-contradiction). `personHue()` → `personTone()` inside the viz palette. Second dead-CSS pass — another ~400 lines will be unreachable by now. A 40-line `scripts/css-orphans.mjs` wired into `pnpm verify` so the file cannot rot back.

**Total: roughly three weeks of focused work. Stages 0–4 are the first week and they answer the complaint.**

---

## 4. Conflicts between the inputs, resolved

| Conflict | Decision | Why |
|---|---|---|
| Dashboard spec wants a local `.dash` 12-col grid on `/today`; design-system spec wants a global `.page` grid | **Global `.page`.** `/today` is its first consumer, not its owner. | A grid that exists on one page is how we got three bespoke two-pane layouts and no shared one. |
| `main { max-width: 1480px }` (dashboard) vs three page widths on `.page` (design system) | **Three page widths.** | A table page and a document page want different widths; a single global cap can only be wrong for one of them. |
| h1 at 32px (dashboard) vs 44px (design system) | **36px**, one ramp, everywhere. | 44px above a 22px h2 re-opens the gap we are closing. 36px keeps h1 dominant without a second ramp for dashboards. |
| Two different `--viz-*` palettes (5 warm-ish values vs 6 contrast-checked values with sequential + diverging ramps) | **The 6-value design-system palette.** | It states its contrast ratios against both surfaces, keeps adjacent hues ≥60° apart, and has been checked for deuteranopia. The dashboard's usage maps onto it unchanged. |
| Dashboard elevates the hero with `--shadow-2`; design system removes shadows globally | **Both, correctly.** Exactly one `--plane-2` surface per page. | This *is* the mechanism — removing the shadow from 108 sections is what lets one shadow mean something. |
| Dashboard puts "Needs a decision" on `/today`; IA puts it on `/inbox` | **Both.** Top 6 on `/today` with a `+N more →` footer; `/inbox` is the full four-lane page. | The front door should show what needs deciding; it should not *be* the triage tool. |
| IA wants the route restructure as step 1; design system wants it late | **Stage 6, mid-plan.** | It is the riskiest, least visible change. Do it once the destinations are worth reaching, but before `/inbox` needs a slot in the rail. |
| IA proposes per-operator landing routes and sub-nav memory; the alternative is a mode switch | **No modes.** Six identical words for both operators; the difference is content filtering (`assigneeId`, `ownerId`) and per-user last-used state. | `role` in the contract is `'admin' \| 'member'` — a permission, not a job. At 2–4 people everyone crosses the line weekly, and a mode makes the crossing cost a decision. |
| IA wants `/reporting` split three ways; dashboard wants it left alone | **Leave `/reporting` intact until Stage 8 ships.** Promote its local `Stat` to `shell/ui/` in Stage 3 and delete the duplicate. | Splitting a working page across three new pages that don't exist yet is how you get a half-restyled app. |

### Where an input would break a hard constraint

- **`'JetBrains Mono'` in the `--font-mono` stack.** Named as "first-name-if-installed", but it will render inconsistently across the two machines that use this app and invites someone to "just add the webfont" later. **Use `ui-monospace, SFMono-Regular, Menlo, monospace` only.** No dependency, no drift.
- **A dev-only `?theme=dark` query param that stamps `data-theme`.** Proposed for screenshotting. It does not violate the OS-following decision *if* it is `import.meta.env.DEV`-gated, and dark mode is genuinely the mode nobody checks. **Approved, with the gate as a review requirement** — the moment it ships to production it becomes the toggle that was decided against.
- **Nothing else violates a constraint.** No new runtime dependency is proposed anywhere in this plan: every chart is hand-rolled SVG, `Drawer` is native `<dialog>` (which gives focus trap, Esc and inert background for free), the segmented-control thumb is `getBoundingClientRect` plus a custom property, and container queries, `:has()` and `color-mix()` are baseline. Every new primitive lives in `shell/ui/` and is consumed downward — `depcruise shell-no-modules` is never approached.
- One dependency question stays open and I am **declining it**: a date-range picker. Two native `<input type="date">` inside a filter bar is adequate; a real range picker is a week of work or a library.

---

## 5. What not to build

These all sound good and would make the product worse at one client, two-to-four people, and ~13 live cards.

| Don't build | Why not |
|---|---|
| **`/money/cash` — the 13-week forecast** | It needs per-client historical payment lag. There is one client. The forecast would be one client's invoice due dates with a statistical dressing on top, and the dressing would be a lie. Revisit at five clients and a year of payment history. |
| **`/money/win-loss`** | Win rate by value across a handful of decided quotes is noise. *Do* render the rejection reasons somewhere — they're currently write-only — but as a list on the quote list page, not a page with rates on it. |
| **A pipeline kanban board** | One client and one prospect. Two cards in five columns is a screenshot of an empty product. |
| **Any pie or client-mix chart** | A one-slice pie is a circle. It announces that the design was drawn against imaginary data. |
| **Bar-per-project rankings, "top 10" anything** | Two bars looks broken. Both charts in Stage 8 were chosen specifically because they read correctly at n=2 and still read at n=30. |
| **Sparklines on numbers with <8 weeks of history** | A two-point line pretending to be a trend. Show the number alone until the history exists. |
| **An activity feed** | There is no notification system. It would be a list of your own actions replayed at you. |
| **A notifications system** | Two people who sit near each other. `/inbox` with a live badge is the right size; push infrastructure is not. |
| **Zebra striping on tables** | With a hairline row rule and a hover fill, stripes are a third differentiator and make a table look like a 2009 report. Off by default. |
| **Number count-up animations, page transitions, staggered list entrances, card hover-lift** | A figure that is still moving is a figure you cannot read — and the whole tabular-nums argument is that these numbers should look *measured*. Card lift on a dense board with 40 cards is noise. |
| **A user-facing density picker** | Density is a property of the page kind (table vs dashboard vs document), set once by the author. A toggle makes the user do the designer's job. |
| **A chart library** | Four charts, ~200 lines of SVG. The existing `.velocity` bar chart already proves the approach. |
| **A modes / role switch in the nav** | See the conflicts table. |
| **`/sales/estimates` — the estimate workspace** | Real gap, wrong stage. It needs cost rates to be worth anything (below), and it is a new entity plus a new editor. Not a UI-elevation item. |
| **Rebuilding `/meetings/:id/room`** | It is the best-built stretch of the product and it already looks finished. Leave `.room-tab` and the room grid alone through every stage. |

---

## 6. Decisions I need from you

**1. Cost rates — the biggest missing thing in the product, and it's not a UI change.** There is no `costRateCents` on a person anywhere in the schema, so the word "margin" cannot be spoken in this codebase; every "profitability" number in `reporting.service.ts` is revenue wearing profitability's name. Adding a temporal cost rate per user is the smallest schema change with the largest effect available. **It is out of scope for this plan.** Say the word and it becomes a separate track.

**2. Outbound email.** `grep -riE "nodemailer|smtp|sendEmail"` across the API returns nothing. "Send quote" changes a status; you then download a PDF and attach it in Outlook. Until this closes, `issueDate` means "the day I pressed the button", and steps 7, 13 and 14 of the commercial journey stay half-manual. Also out of scope, also a separate track, also probably worth more than half of Stage 8.

**3. The hourly rate field.** `QuoteDetail.tsx:252` reads `Hourly rate (cents)` — you type `13500` to mean €135, while every other money input in the app converts euros for you. One slipped zero is a €13.50/hour engagement. **Ten-line fix, highest risk-per-line in the repo.** I'd fold it into Stage 0. Confirm.

**4. The URL rename (Stage 6).** `/crm/clients` → `/clients` etc. is correct and it will break every bookmark and every link you've pasted into a chat. Redirects cover one release. Do you want it, and do you want the redirects permanent?

**5. Scope baseline (`/projects/:id/scope`).** The finance journey calls this the worst gap in the commercial journey — there is no baseline to compare delivered work against, so scope-creep conversations have no evidence. Every ingredient exists (frozen quote lines, task creation timestamps, portal-request conversions); nothing joins them. It is a genuine new page, roughly a Stage-8-sized piece of work. **In or out?**

**6. Priority call.** Stages 0–4 fix the complaint in about a week. Stages 5–10 are what makes somebody ask who built it. If you want to stop after Stage 4 and ship something else for a month, the app is coherent at that point — that is what "independently shippable" is buying you.