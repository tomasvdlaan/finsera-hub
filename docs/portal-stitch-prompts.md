# Google Stitch prompts for the Finsera client portal

Stitch generates one screen per prompt and does better with a short, concrete description
than with a design document. So this is not the brief — it is six prompts, each
self-contained and ready to paste.

**How to use it.** Put the style block in Stitch's theme or paste it at the top of every
prompt, then run one screen prompt at a time. Start with Overzicht: it sets the type scale
and spacing the rest should inherit. Generate desktop first, then re-run the same prompt
with "mobile app screen" swapped in for the responsive pass.

The content in these prompts is real — the actual Dutch labels, statuses and amounts the
portal uses. Keep it. Placeholder text is what makes generated designs look generated, and
it is why the empty states matter as much as the full ones here.

---

## Style block — paste at the top of every prompt

```
Style: a calm, restrained web app for a Dutch business-intelligence consultancy's clients.
Professional services, not SaaS. It should feel like a well-kept file rather than a
dashboard. Generous whitespace, quiet hierarchy, content-first. No gradients, no glows, no
drop shadows, no illustrations, no icons except where stated. Light theme only.

Colours: near-black text #1a1a1a, muted text #6b6b6b, hairline borders #e4e4e7, page
background #fafafa, cards and tables on white, one accent — deep green #1f5f4f — used only
for links and primary buttons, and one alert colour — rust #9a3412 — used only for overdue
and "waiting on you". Nothing else is coloured.

Typography: one clean grotesque sans (Inter or similar). Page title around 22px semibold,
section headings 15px semibold, body 14px, secondary 13px. Numbers tabular and
right-aligned. Language is Dutch. Content column max 960px, centred.

Tables are borderless with a single hairline between rows, no zebra striping, no card
around them. Status values are small quiet pills, not badges with heavy fills.
```

---

## 1. Overzicht — the front page

```
A client portal home screen, in Dutch, for a consultancy's customer.

Top bar: the wordmark "Finsera" on the left with a small client logo beside it, a
horizontal text navigation — Overzicht, Projecten, Taken, Offertes, Facturen, Documenten,
Rapporten, Vragen — with Overzicht active, and on the right "charlotte@dochorse.nl ·
uitloggen" in muted small text.

Page content, stacked as generously spaced sections with small headings:

1. A greeting "Welkom, Charlotte" as the page title, and under it one warm sentence in
   muted text: "Fijn dat u er bent. We werken deze maand aan de nieuwe omzetrapportage —
   laat het gerust weten als u iets mist."
2. "Wacht op u" — three rows, each one line with a green link and plain text after it:
   "Offerte 2026-014 — € 12.500,00, te beoordelen tot 30 september"; "Factuur 2026-088 —
   € 3.630,00" followed by a rust-coloured pill reading "vervallen 20 augustus"; "Extra
   kolom in het dashboard — wacht op uw antwoord".
3. "Rapportages" — two green links: "Rapportage Q3 2026" and "Marge-analyse".
4. "Nieuw sinds uw vorige bezoek" — one line: "Factuur 2026-091 — 1 september".
5. "Loopt nu" — two lines: "Dashboard vernieuwing", "Datawarehouse migratie".
6. "Uw contactpersoon" — "Tomas van der Laan · tomas@finsera.nl".

Mostly text and links, no cards, no metrics, no charts, no numbers in boxes. The greeting
and the sentence under it are the visual anchor.
```

## 2. Facturen

```
An invoices table screen in a Dutch client portal. Same top bar, Facturen active.

A borderless table, hairline between rows. Columns: Nummer, Datum, Vervaldatum, Bedrag
(right-aligned, tabular), Status, and a last column with a small green text link "PDF".

Six rows, for example "2026-088 · 20 juli 2026 · 20 augustus 2026 · € 3.630,00" with a
rust pill "Vervallen"; "2026-091 · 1 september 2026 · 1 oktober 2026 · € 8.470,00" with a
neutral pill "Openstaand"; the rest with a quiet grey pill "Voldaan".

Only the overdue row carries colour. No row actions, no checkboxes, no filters, no search.
```

## 3. Offertes, mid-acceptance

```
A quotes screen in a Dutch client portal, showing the moment a client confirms. Same top
bar, Offertes active.

Table columns: Nummer, Omschrijving, Geldig tot, Bedrag (right-aligned), Status, and an
action column.

Three rows. The first is expanded and mid-confirmation: its action cell shows the sentence
"Akkoord met € 12.500,00?" followed by a solid deep-green button "Ja, accepteren" and a
muted text link "annuleren". Under that row, indented, its lines are shown as a small inner
table — Omschrijving, Aantal, Prijs, Bedrag — with rows like "Inrichting Power BI · 40 uur
· € 125,00 · € 5.000,00".

The second row shows a pill "Geaccepteerd" and no action. The third shows "Verlopen" in
rust and no action.

This confirmation is the highest-stakes moment in the product. It should feel deliberate
and calm — the amount repeated at full size, nothing else competing for attention.
```

## 4. Vragen — a conversation

```
A support conversation screen in a Dutch client portal. Same top bar, Vragen active.

At the top, a compact form on the page background: a one-line input "Onderwerp", a
three-row textarea "Waar kunnen we mee helpen?", a select showing "Niet aan een project
gekoppeld", and a deep-green button "Versturen".

Below it a table: Onderwerp, Laatst, Status. Statuses are quiet pills reading "Bij
Finsera", "Wacht op u" in rust, and "Afgerond".

The first row is expanded into a thread, indented under it with a hairline down the left.
Four messages alternating between the client and Finsera, each with a small muted line
above it — "Charlotte de Vries · 2 sep 2026 09:14" or "Finsera · Tomas van der Laan ·
2 sep 2026 11:02" — and the message text below in normal body copy. The client's own
messages are indented slightly further than Finsera's. At the bottom of the thread, a
textarea "Uw antwoord…" and a "Versturen" button.

Two voices told apart by position and spacing, not by coloured bubbles.
```

## 5. Rapporten

```
A reports index in a Dutch client portal. Same top bar, Rapporten active.

A short list of custom reports the consultancy built for this client. Each row: the report
title as a deep-green link at 15px, the address it lives at in small muted monospace
underneath — "/rapportage-q3" — and a hairline between rows. Four rows, titles like
"Rapportage Q3 2026", "Marge-analyse per project", "Uren en bezetting", "Forecast 2027".

No thumbnails, no descriptions, no cards, no grid. This is a table of contents, and the
reports themselves are full-page and designed separately.

Also produce a variant of this screen in its empty state: the same page with one centred
muted sentence, "Er staan nog geen rapportages voor u klaar."
```

## 6. Signed out

```
The sign-in screen of a Dutch client portal. No navigation, no top bar.

Centred on a #fafafa page, a narrow column: the wordmark "Finsera" at around 22px
semibold, under it "Klantportaal" in muted 13px, a generous gap, then a single solid
deep-green button "Inloggen". Nothing else — no email field, no password field, no
"remember me", no illustration, no logo lockup.

Below the fold there is nothing. The whole screen is four elements and a lot of quiet.

Also produce a second version of the same screen with a short rust-coloured line above the
button reading "Dit account heeft geen toegang tot dit klantportaal.", and the button
replaced by an outlined button reading "Uitloggen".
```

---

## Two things to feed back into whatever comes out

**Most of these screens are empty most of the time.** A client with one project and no open
quotes sees a greeting and very little else. Judge every result by its empty state before
its full one — a design that only works when the tables are full is the wrong design here.

**A tab exists only when there is something behind it**, so the navigation is genuinely
shorter for a new client: sometimes only Overzicht and Vragen. Ask Stitch for that version
too and make sure the top bar still looks deliberate with two items in it.
