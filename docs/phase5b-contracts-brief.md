# Phase 5b — Contracts & rate cards

**Status:** ✅ built and verified (2026-07-28). Decision D1 = **option A** (rate cards fill the project rate), D2–D5 as recommended.
**Depends on:** Phase 1 (CRM), Phase 3 (Documents), Phase 5a/5c (rates, VAT, org settings)
**Parent:** [phase5-commercial-brief.md](phase5-commercial-brief.md)

---

## 1. What this is for

Two things that look related but are not:

**A contract register** answers "what have we actually agreed with this client, and when
does it lapse?" Today an NDA is a PDF in Documents with no dates attached to it, so nothing
can tell you a notice period is closing. That is a real gap, and it is the smaller half of
the work.

**Rate cards** answer "what does an hour cost, and since when?" This is the half that needs
care, because it touches money that has already been invoiced.

---

## 2. The decision that actually matters

### D1 — Does a rate card change what an invoice bills?

The parent brief says: *"the rate that applies is the one in force on the day the hours were
worked."* That is the correct model for a long engagement crossing a 1 January indexation,
and it is genuinely how consultancies price.

It is also a change to how invoicing currently works. Today `project.defaultRateCents` is the
single authority: quotes write it, invoicing reads it, and the number on the invoice is the
number on the project. Introducing date-based lookup means the rate becomes a *query* — and a
query that can silently return a different answer than it did last month.

**Two options:**

| | **A. Rate cards fill the project rate** *(recommended)* | **B. Invoicing looks the rate up by work date** |
|---|---|---|
| Authority | Project rate stays the single source | Rate card becomes the source |
| Indexation | An explicit "apply from ⟨date⟩" action, which you see and confirm | Automatic on the effective date |
| Risk | You must remember to apply it | An unnoticed rate card edit changes what a draft invoice bills |
| Mid-project change | New rate applies to the whole project from when you apply it | Hours before and after bill at different rates, correctly |

**Recommended: A**, for the same reason Q1 deferred rate cards at all. You have one client and
one rate. Option B's correctness only pays off when an indexation actually crosses a project,
and it introduces the failure mode this phase is least able to test — an invoice that quietly
disagrees with the last one. Rate cards still carry effective dates, so the history is
recorded and B remains a small change later, not a rewrite.

This is a decision worth disagreeing with me about if you expect to index rates in January.

---

## 3. The rest of the decisions

### D2 — Is a contract a document, or a record with a document attached?

**Recommended: a record with a document attached.** The register carries the dates, notice
period and party details; the signed PDF stays in Document Management where every other file
lives. Duplicating storage here would be the third time this platform models "a file", and
the first two were enough.

### D3 — How do renewal and notice alerts work?

There is no scheduler in this platform. The only recurring job is the event dispatcher's
poll loop, and adding a cron for this would be the first background process that writes.

**Recommended:** `expiringSoon` is **derived on read**, exactly like `overdue` on invoices and
`expired` on quotes, and surfaced on the client page and a dashboard list. The
`contract.expiring` *event* — which needs something to notice the day it becomes true — waits
for Phase 6's insight service, which is where scheduled proactivity was always going to live.

Nothing changes state while nobody is looking. That has been the rule three times now.

### D4 — What contract types?

**Recommended:** `framework`, `sow`, `nda`, `dpa`, `other`. Free-text would calcify into
inconsistent spellings; a closed list of five covers what a Dutch consultancy signs, and
`other` is the escape hatch.

**`dpa` is not incidental.** Open item O8 is client DPA language for AI processing. A register
that can answer "which clients have a DPA, and does it cover sub-processors?" is the thing
that makes O8 actionable rather than a note in a document.

### D5 — AI

| Tool | Risk class | Notes |
|---|---|---|
| `sales_list_contracts` | `read` | "What have we signed with X?" |
| `sales_extract_contract_terms` | `write:draft` | Reads an uploaded contract from Documents and proposes dates, notice period and rate as a **draft** for confirmation |

Extraction is the honest use of AI here: reading a 14-page framework agreement to find the
notice period is exactly the tedium worth delegating, and every field it proposes is one you
confirm. It must never write a term it did not find — no inferring a "standard" 30 days.

---

## 4. Shape

**Entities:** `contract`, `rate_card`, `rate_card_line`
**Events:** `contract.signed` *(`contract.expiring` deferred per D3)*

```
client ─┬─ contract ── document (the signed PDF)
        └─ rate_card ── rate_card_line (role → rate, effective from)
```

A rate card belongs to a client (or is the house default, `clientId` null). Lines carry a
role label and a rate, with an effective-from date. Applying a card to a project writes the
matching rate onto the project — the same seam quotes already use.

---

## 5. Tests this phase must have

1. **A signed contract is immutable** in its commercial terms, by trigger — same standard as
   quotes and invoices. Dates and notice periods are what a dispute turns on.
2. **Expiry and notice windows are derived**, never stored.
3. **Applying a rate card writes the project rate**, and the project reflects it — the seam.
4. **Rate card lines are effective-dated**, and the correct line is selected for a given date
   (the lookup exists and is tested even under option A, so option B is a small step later).
5. **A contract links to its document** without copying bytes.

---

## 6. Build order

| Step | Deliverable |
|---|---|
| 1 | Contract register: schema, service, immutability trigger, derived notice windows |
| 2 | Rate cards with effective-dated lines, and apply-to-project |
| 3 | UI: contracts on the client page, a rate card editor, expiry surfacing |
| 4 | AI: list + extract terms from an uploaded document |

---

## 7. What was built (2026-07-28)

| Step | Status |
|---|---|
| Contract register, immutability trigger, derived notice windows | ✅ 18 tests |
| Rate cards with effective-dated lines, apply-to-project | ✅ |
| UI: contracts list/detail, rate card editor, client widget | ✅ |
| AI: `sales_list_contracts`, `sales_draft_contract_terms` | ✅ bound |

**Verified live.** A framework agreement ending in 75 days with 60 days' notice produced a
deadline of 2026-08-11 and a "notice by" badge; editing it after signing was refused; a rate
card carrying both €35 (2025) and €37,50 (2026) applied the current rate to a project,
changing it from 3500 to 3750. Test data removed and the project rate restored afterwards.

`rateOn()` — the date-based lookup option B would need — is implemented and tested even
though invoicing does not call it, which is what keeps B a small change rather than a rewrite.

### The finding that mattered more than the feature

Migration 0013 reported **applied successfully** but left the dev database without its two
contract triggers. The test database had them, because it is rebuilt from scratch; the tests
therefore passed. Nothing failed, and nothing would have failed — the service-level guards
still refused edits — until someone reached the data another way, at which point signed
contract terms would have been quietly editable.

A guarantee that can silently disappear is not a guarantee. `DbIntegrityService` now checks
all ten immutability triggers at boot and **refuses to start** if any is missing, naming what
each one protects. It is tested by dropping a trigger and asserting the refusal.

---

## 8. What this phase deliberately does not do

- **No e-signature.** Contracts are signed elsewhere and filed here.
- **No scheduled alerts.** D3 — Phase 6 owns proactivity.
- **No automatic indexation.** D1 — applying a new rate is a decision you make.
- **No contract templates.** Generating agreements is a different problem from tracking them.
