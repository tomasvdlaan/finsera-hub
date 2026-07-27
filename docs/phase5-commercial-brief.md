# Phase 5 Requirement Brief — The Commercial Loop

**Companion to:** Master Document · AI Integration Plan · Build Roadmap · Decision Log
**Covers:** 5a Quotation · 5b Contracts & rate cards · 5c Invoicing
**Status:** Draft
**Date:** July 2026

---

## 1. Why this phase is different

Every phase so far could be wrong in private. A mis-shaped task or a missing document annoys
you. **An invoice is a legal document sent to a client**, and the Belastingdienst has opinions
about it: sequential numbering without gaps, specific mandatory fields, correct BTW treatment,
seven-year retention, and no editing after issue.

That changes how this phase should be built:

- **Correctness beats velocity.** Everywhere else "ship the MVP and learn" was right. Here,
  learning happens on a real client's real invoice.
- **The database enforces what the law requires**, not the UI. Numbering, immutability and
  rounding are constraints, not conventions.
- **A bookkeeper reviews it before the first send.** That is gate G2, and it is not a formality.

The phase also closes the loop the platform was built for: an accepted quote becomes a project,
hours are logged against it, and those hours become an invoice — each step a link the timeline
already knows how to show.

---

## 2. A precondition worth stating plainly

**Invoicing is built on logged hours.** For time-and-materials work, hours *are* the invoice.

Gate G1 has not passed: there is one 10-hour entry in the system, and no week has been logged
end-to-end. Building invoicing on a timesheet nobody has stress-tested means the first real
invoice is also the first real test of the hours behind it — and an invoice that is wrong is
worse than no invoice.

Similarly, **the platform still runs only on a laptop**. Invoices carry a seven-year retention
obligation. That obligation is not met by a Docker volume in `~/WorkDir`.

Neither blocks *building* this phase. Both block *sending a real invoice from it*, and the brief
records that rather than discovering it at the worst moment.

---

## 3. What comes due from earlier phases

Phase 1 deferred the billing fields "to Phase 5c, where invoicing actually reads them" (CRM
brief §6). They now come due, and they are legally mandated rather than nice to have:

**On the client:** legal name (which may differ from the display name), invoice address, KvK
number, BTW/VAT number, payment terms in days, invoice email, and — for EU clients — the
country, because it decides the VAT treatment.

**On Finsera itself:** own KvK, own BTW number, IBAN, address, logo. These belong in a small
`settings` area rather than being hard-coded into a template, since they appear on every
invoice and change rarely but do change.

---

## 4. VAT: the part to get right

Dutch B2B consultancy hits three cases. All three must exist from the start, because a client
in the wrong bracket produces an invoice that is legally wrong.

| Case | Treatment | Applies when |
|---|---|---|
| Domestic | 21% BTW | Dutch client (the common case) |
| Intra-EU B2B | 0%, **BTW verlegd** — reverse charge | EU client outside NL with a valid VAT number |
| Outside EU | 0%, out of scope | Client established outside the EU |

Two rules that must be enforced, not documented:

**Reverse charge requires the client's VAT number on the invoice**, plus the words "BTW
verlegd" (or "VAT reverse charged"). An invoice claiming reverse charge without a VAT number is
invalid — so the service refuses to issue one.

**VAT is computed per rate, not per line.** Lines are summed by rate, then VAT is calculated
once per rate group and rounded there. Rounding each line separately produces totals that
disagree with the client's own bookkeeping by a cent or two, which is exactly the kind of
discrepancy that costs an hour of somebody's week.

Rounding is half-up on cents, applied once, on the rate subtotal.

---

## 5. Invoice numbering

Legally: sequential, no gaps, no reuse.

**Numbers are allocated when an invoice is issued, never when a draft is created.** A draft that
gets deleted must not leave a hole in the sequence, and drafts get deleted constantly.

Implementation: a per-year counter row locked with `SELECT … FOR UPDATE` inside the issuing
transaction. Format `2026-0001` by default, configurable prefix, year resetting. The uniqueness
constraint is on the number itself, so a bug produces a failed transaction rather than two
invoices sharing a number.

---

## 6. Immutability

**A sent invoice is never edited.** Not the amounts, not the client, not the date. Corrections
happen through a credit note that references the original.

This is enforced in the database — an `issued_at` that, once set, makes the row read-only to the
service — because "the UI hides the edit button" is not a guarantee. A PDF is generated at issue
time and stored as a document version (Phase 3's file backbone earns its place here), so what
was sent can always be reproduced exactly, seven years later.

---

## 7. The three modules

### 5a — Quotation

Quotes built from a rate card or fixed price, versioned during negotiation, sent as a branded
PDF, accepted by a click-to-accept link. Statuses `draft → sent → accepted / rejected / expired`
feed the CRM pipeline. **An accepted quote converts to a project** with its budget, rate and
milestones pre-filled — the conversion that makes the loop a loop.

Entities: `quote`, `quote_line`. Events: `quote.sent`, `quote.accepted`, `quote.rejected`.

### 5b — Contracts & rate cards

A contract register per client: type (framework, SOW, NDA, DPA), dates, notice period, renewal
terms, and the rates the work is performed under. **Rate cards carry effective dates**, so an
indexation on 1 January does not silently rewrite last year's invoices — the rate that applies
is the one in force on the day the hours were worked.

Renewal and notice alerts publish `contract.expiring`, which the Phase 6 insight service turns
into a nudge. Contract documents live in Document Management, not in a new store.

Entities: `contract`, `rate_card`, `rate_card_line`. Events: `contract.signed`, `contract.expiring`.

### 5c — Invoicing

Drafts generated from submitted hours (T&M) or milestones (fixed fee), with lines grouped
sensibly — per project, per person, or per task, chosen once and defensibly. Correct VAT,
sequential numbering, PDF generation, send by email, status tracking `draft → sent → paid →
overdue`, payment reminders, and credit notes.

Entities: `invoice`, `invoice_line`, `credit_note`. Events: `invoice.issued`, `invoice.paid`,
`invoice.overdue`.

**Subscribes to `timesheet.submitted`** — the seam left open since Phase 2a finally gets used.

---

## 8. AI in this phase

Per the AI plan, this is where the assistant becomes commercially useful — and where its limits
matter most.

| Tool | Risk | Note |
|---|---|---|
| `quote_draft_from_context` | `write:draft` | Draft scope and lines from a meeting note or document |
| `invoice_draft_from_hours` | `write:draft` | Assemble a draft from submitted hours |
| `invoice_line_descriptions` | `write:draft` | Turn raw time entries into client-readable lines |
| `payment_reminder_draft` | `write:draft` | Tone-matched reminder, escalating with age |
| `contract_extract_terms` | `write:draft` | Pull dates, notice periods and rates from an uploaded PDF for human verification |
| **`invoice_send`** | **`restricted`** | **Never exposed to the assistant** |

`invoice_send` stays restricted permanently, not pending a track record. Sending a client a
document that asserts they owe money is not a thing to delegate, and the AI plan's own rule —
"sending anything to a client is never below `write:commit`" — is met by putting it out of
reach entirely.

Contract extraction is the one place a client-supplied PDF becomes structured data. That is the
prompt-injection surface the AI plan warns about, so extracted values are **proposals a human
confirms**, never written directly.

---

## 9. Build order

| # | Step | Done when |
|---|---|---|
| 1 | Settings: Finsera's own legal details | They appear on a rendered document |
| 2 | CRM billing fields; VAT treatment per client | A client can be marked reverse-charge |
| 3 | **5b rate cards** (contracts can follow) | A rate applies by date, not by guess |
| 4 | 5a quotes: lines, versions, PDF, accept → project | A quote can be sent and accepted |
| 5 | 5c invoice drafts from hours + milestones | Draft totals match a hand calculation |
| 6 | VAT engine + numbering + immutability | The tests in §10 pass |
| 7 | PDF, send, status tracking, reminders, credit notes | An invoice can complete its life |
| 8 | Accounting export (**gate G2**) | Bookkeeper accepts the output |
| 9 | AI tools bound | Draft quality reviewed before use |

Note step 3: **rate cards come before quotes**, because a quote priced from an ad-hoc number is
a quote that disagrees with the invoice later.

**Size:** XL · ~11–16 weeks. Realistically the phase where the roadmap's estimate is least
reliable, because correctness work resists estimation.

---

## 10. Tests this phase must have

Unusually for a brief, the tests are specified up front — because these are the assertions that
make the difference between software and a liability.

- 21% on a domestic invoice, to the cent, against a hand calculation
- Reverse charge produces 0% **and** refuses to issue without the client's VAT number
- Per-rate rounding: an invoice of many odd-cent lines totals correctly
- Numbering: concurrent issues never collide; a deleted draft leaves no gap
- Immutability: a sent invoice cannot be modified by any service path
- Credit note reverses exactly, and references the original
- An invoice reproduces its PDF byte-for-byte after a restore

---

## 11. Decisions (2026-07-27)

1. **Invoicing first.** 5c is built against project rates; quotes (5a) and the contract
   register (5b) follow. Rate cards still precede quotes when 5a starts — the ordering
   argument in §9 holds, it just starts later.
2. **All three VAT cases are real** — Finsera has domestic, EU and non-EU clients — so all
   three get first-class tests, not just the domestic path.
3. **UBL export**, deferring the package integration without blocking the phase.
4. **Fresh sequence, `2026-0001`.** No invoices issued elsewhere this year.
5. Payment terms default to 30 days (per the DocHorse agreement); statutory interest is
   mentioned on the invoice but not auto-calculated.

## 12. Questions asked and answered

1. **Order.** With one client, is the full quote → contract → invoice loop the right target, or
   should invoicing come first because it is what gets money in? Quotes matter when you are
   winning work; invoices matter now. I can build 5c against project rates and add quotes later.
2. **VAT cases.** Do you have EU clients outside NL, or clients outside the EU — or is
   everything domestic 21% today? Build all three regardless, but it changes what gets tested
   hardest.
3. **Invoice numbering format.** `2026-0001`, or does your bookkeeper expect something else?
   Continuing an existing sequence matters — tell me the last number you issued.
4. **Accounting package** (gate G2). Exact Online, Moneybird, e-Boekhouden, or something else?
   That decides API versus UBL export, and it is worth asking your bookkeeper which they prefer
   to receive.
5. **Payment terms.** Default days, and do you charge statutory interest on late payment? The
   DocHorse agreement says thirty days.
