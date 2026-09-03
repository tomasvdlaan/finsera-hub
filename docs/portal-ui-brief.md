# Finsera client portal — what it does, for a design pass

A complete description of the client portal's surface as it is built today, written to be
handed to a designer. Everything below exists and works; nothing here is aspirational. The
internal platform (`hub.finsera.nl`) is a separate application and is **not** in scope.

**Updated after the 2026-09-04 craft pass.** The surface described here is the reworked one:
a type scale, a 4px spacing scale, a measured neutral ramp, one elevation language
(hairlines on white), designed hover, focus, disabled, loading, empty and error states, and
a header that is a band rather than three wrapped rows. §8 carries the tokens.

---

## 1. What this is, and who uses it

Finsera is a Dutch BI and data consultancy. The portal is where their clients see their own
work: projects, tasks, quotes, invoices, shared documents, custom reports, and a place to
ask questions.

**Two audiences, one interface.**

- **A client.** Typically a finance or operations person at the client company. They visit
  rarely — a few times a year to approve a quote or fetch an invoice, more often if a report
  is being used. Not technical. Will read it on a laptop, sometimes a phone.
- **A Finsera employee.** Can open any client's portal to see exactly what that client sees.
  They get a persistent banner and cannot perform the client's own actions.

**Every client has their own address**: `dochorse.finsera.nl`, `duce.finsera.nl`. The portal
looks the same on each; only the data differs. There is no client switcher, because a
session belongs to one client.

**Language is Dutch throughout.** Dates are `nl-NL` medium format (`3 sep 2026`), money is
EUR in `nl-NL` format (`€ 1.234,56`).

## 2. Tone and constraints

- **Small and calm.** A client should be able to find their invoice and leave. The current
  design is deliberately plain; it should stay quiet rather than become a dashboard.
- **This is not a product they bought.** It is a service relationship made visible. It
  should feel like a well-kept file, not like software with features.
- **Trust matters more than delight.** Money, contracts and a company's own project data.
  Nothing playful around amounts, statuses or acceptance.
- **Infrequent use.** Nothing may rely on the reader remembering how it worked last time.
- **No settings, no profile, no notifications.** Deliberately absent. Personalisation is
  something Finsera configures per client — the welcome line, the logo, which tabs exist —
  never something a client visiting twice a year has to set and then remember.

## 3. Global shell

Present on every screen once signed in:

- **Header bar** — the Finsera wordmark, the navigation, the signed-in email address, and a
  "uitloggen" link.
- **Navigation, up to eight items in this order**: Overzicht · Projecten · Taken · Offertes ·
  Facturen · Documenten · Rapporten · Vragen. The active item is marked. **A tab appears
  only when there is something behind it** — a client with no quotes has no Offertes tab —
  so the navigation is shorter for a new client and grows as the relationship does. Overzicht
  and Vragen are always present.
- **The client's logo**, when they have given us one, sits beside the Finsera wordmark. Their
  mark, our design language; the portal is Finsera's, at their address.
- **Staff banner** — shown only to Finsera employees, above the header, currently a solid
  warning-coloured strip: *"Finsera — u bekijkt het portaal van {client} als medewerker.
  Acties van de klant zijn uitgeschakeld."* It must be impossible to overlook or mistake for
  the client's own view.

Every list screen has three states, and all three need a design:

| State | Current text |
|---|---|
| Loading | "Bezig…" |
| Error | the message, in an error style |
| Empty | a sentence written per screen, listed below |

## 4. Signing in

There is no password field, no sign-up, no reset flow. Authentication happens at Finsera's
identity provider; the portal only starts and ends it.

- **Signed out**: "Finsera" / "Klantportaal" / a single **Inloggen** button. Clicking it
  leaves the site and returns signed in.
- **Refused**: the same screen with a message — *"Dit account heeft geen toegang tot dit
  klantportaal."* — and only an **Uitloggen** button, because signing in again would loop.
- **Interstitials**: three plain full-page messages exist for login failures ("Inloggen
  mislukt", "Inloggen verlopen", "Portaal niet beschikbaar"), each with one action. They are
  currently unstyled and would benefit from the same treatment as the signed-out screen.

## 5. The eight screens

### 5.0 Overzicht — the front page
Where signing in lands, and deliberately not a dashboard. The portal shows a client nothing
about the business, and a page of totals would be the first place that stopped being true.
It answers two questions instead.

- **A greeting** using the person's first name, then a **welcome sentence** written per client
  by their account manager in the internal app. This is the one genuinely personal thing on
  the screen and should be treated as the page's anchor.
- **Wacht op u** — quotes to review, overdue invoices, tickets where the ball is with them.
  Exactly the three things a client can act on in this portal, so the list is short by
  construction. When it is empty it says so plainly, because nothing waiting is the good
  outcome rather than an empty state to apologise for.
- **Rapportages**, promoted here rather than left behind the last tab.
- **Nieuw sinds uw vorige bezoek**, measured from their previous sign-in. Absent on a first
  visit and on most visits, which is correct.
- **Loopt nu** — the projects actually under way.
- **Uw contactpersoon** — their account manager by name, with an email link.

Design note: five short sections, most of them often empty. The hardest part is making a page
that is mostly absent still feel like a welcome rather than a stub.

### 5.1 Projecten
A read-only table of the client's projects.

Columns: **Project**, **Status**, **Start**, **Einde**.
Statuses: Loopt · Gepauzeerd · Afgerond · Geannuleerd.
Empty: *"Er lopen op dit moment geen projecten."*

Nothing about budget, rate or margin is ever shown.

### 5.2 Taken
The work being done for the client, **grouped under a heading per project**. Only tasks
Finsera has explicitly marked visible appear, so this is a curated shortlist rather than a
board.

Columns: **Wat** (title) · **Soort** (Werk / Herstel / Onderhoud / Onderzoek) · **Gepland**
(due date) · **Status**.
Status is either the board column's own name, shown verbatim, or "Afgerond {date}".
Empty: *"Er staat op dit moment niets voor u open."*

Read-only. There is no dragging, no commenting, no detail view. A client never sees a task's
description, who it is assigned to, or how long it was estimated to take.

### 5.3 Offertes
Quotes, and the one place a client commits to something.

Columns: **Nummer** · **Omschrijving** · **Geldig tot** · **Bedrag** · **Status** · action.
Statuses: Ter beoordeling · Geaccepteerd · Afgewezen, plus a distinct **Verlopen** state for
an unaccepted quote past its date.

- **Expanding a quote number** reveals its lines inline: Omschrijving · Aantal (with unit:
  uur / dagen / vast) · Prijs · Bedrag.
- **Accepting** is two steps on purpose. The button reads "Accepteren"; pressing it replaces
  the cell with *"Akkoord met € 12.500,00?"* plus **Ja, accepteren** and **annuleren**. The
  amount is repeated so what is being agreed to is on screen at the moment of agreeing.
  This is the highest-stakes interaction in the portal and deserves the most care.
- Only an open, unexpired quote offers the button. Employees never see it.

### 5.4 Facturen
Columns: **Nummer** · **Datum** · **Vervaldatum** · **Bedrag** · **Status** · **PDF**.
Statuses: Voldaan · Openstaand · **Vervallen** (overdue — currently the only emphasised
state in the portal).
The PDF opens in a new tab. Empty: *"Er zijn nog geen facturen."*

Only issued and paid invoices appear; drafts never do.

### 5.5 Documenten
Files Finsera has explicitly shared with this client.

Columns: **Document** · **Gedeeld op** · **Downloaden**.
Empty: *"Er zijn nog geen documenten met u gedeeld."*

There is no folder structure, no upload, no preview. A category exists on each document but
is not currently shown — grouping by it is an option worth considering.

### 5.6 Rapporten
Custom HTML reports Finsera builds for this client, served on the client's own address.

Currently a simple list: the report's title as a link, plus its address (`/rapportage-q3`).
Opening one **replaces the whole page** with the report — no header, no navigation, and no
way back except the browser's back button. Empty: *"Er staan nog geen rapportages voor u
klaar."*

**This is the weakest part of the design and the most valuable to solve.** Two open
questions:
1. How does a report announce itself in the list? There is only a title today; a
   description, a date, or a thumbnail would all be possible.
2. Should a proxied report carry any portal chrome — a slim bar with the client's name and a
   way back — or stay full-bleed? The reports are designed independently and vary wildly, so
   anything wrapped around them has to survive not knowing what it contains.

### 5.7 Vragen
The conversation surface. Replaces "can you also…" in email.

**Opening a question** — a short form at the top: **Onderwerp** (one line), a message
(multi-line), and an optional project chooser ("Niet aan een project gekoppeld" is the
default and stays common). Deliberately short: a client should be able to ask for something
in the time it would have taken to open their mail client.

**The list** — Columns: **Onderwerp** · **Laatst** (last activity) · **Status**.
Statuses: **Bij Finsera** (we owe them a reply) · **Wacht op u** (they owe us one, currently
emphasised) · **Afgerond**.

**The thread** — opens inline under the subject. Each message shows who wrote it (the
client's own name, or "Finsera · {name}"), the date and time to the minute, and the text
with line breaks preserved. Client messages are indented to separate the two voices. Below
the thread is a reply box, unless the ticket is closed — then: *"Deze vraag is afgerond.
Stel gerust een nieuwe vraag."*

Employees see the threads but get no form and no reply box; they answer from the internal
application.

Empty: *"U heeft nog niets gevraagd."*

## 6. What the design must respect

These are behaviours, not preferences — changing them changes the system.

- **A client sees only their own data**, and only the fields listed above. Do not design a
  screen that implies more is available (a "team" page, a person's photo, an activity feed).
- **Accepting a quote is the only commitment a client can make.** It stays two-step.
- **Employees may read everything and act on nothing.** Any control a client has must have a
  visibly disabled or absent state for staff, and the banner must always be present.
- **Reports are third-party HTML.** They cannot be restyled, and they cannot call the portal.
- **No client-side branding per client.** Every portal is Finsera's, at the client's address.

## 7. Where the current design is thinnest

Ranked, for a designer deciding where to spend effort. The craft pass fixed the structural
faults; what is left is judgement about the product rather than the CSS:

1. **Rapporten and the report experience** (§5.6) — the reason the whole per-client-address
   architecture exists, and the least designed screen.
2. **The thread in Vragen** (§5.7) — two voices in one column, currently separated only by
   indentation and a border.
3. **The interstitial screens** (§4) — the three full-page login messages are still plain
   HTML served by the API, and are the one surface the craft pass did not reach.
4. **Mobile.** The rows stack and the tables scroll inside their cards, which is correct
   rather than considered. A table is still a table on a phone.
5. **The staff banner** (§3) — loud on purpose, and it could be loud more gracefully.
6. **The front page's empty condition.** A new client sees a greeting, a welcome sentence and
   almost nothing else. That is the honest state and it should still read as considered.

## 8. Reference: the visual language today

Deliberately plain, and offered as a starting point rather than a constraint.

One warm-grey ramp, so borders and secondary text belong to the same family as the paper.

| Token | Value | Used for |
|---|---|---|
| `--paper` | `#f6f6f3` | the page |
| `--surface` | `#ffffff` | cards, tables, the header band |
| `--surface-sunk` | `#fbfbf9` | table headers, row hover, message bodies |
| `--ink` | `#15181a` | body text |
| `--ink-2` | `#565d62` | secondary text, 6.7:1 |
| `--ink-3` | `#6b7075` | 12–13px labels, 4.6:1 on paper — measured, not chosen by eye |
| `--line` | `#e7e7e2` | hairlines |
| `--line-strong` | `#d8d8d1` | form borders |
| `--accent` | `#1f5f4f` | links and the one primary action, 6.9:1 |
| `--alert` | `#9a3412` | overdue, waiting on you, the staff banner — nothing else |

**Spacing** is a 4px scale, `--s1` (4px) through `--s8` (72px), and nothing is eyeballed.
**Type** is 12 / 13 / 14 / 15 / 17 / 26 / 34, with hierarchy carried by weight and colour
before size. Numbers use tabular figures so columns of money align. Content is capped at
68rem. **Elevation is hairlines only** — nothing in the app floats, so nothing has a shadow.
**Motion** is 140ms on named properties, never `all`, and `prefers-reduced-motion` is
honoured. Every interactive element has hover, focus-visible, active and disabled states,
and a disabled primary turns neutral rather than translucent — a half-faded green button
reads as "working", which is the one thing it must not say while refusing to be pressed.
