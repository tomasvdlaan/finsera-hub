# Phase 5a — Quotation

**Status:** ✅ built and verified (2026-07-28). Decisions D1–D6 confirmed as recommended.
**Depends on:** Phase 1 (CRM), Phase 3 (Documents), Phase 5c (VAT engine, PDF rendering, org settings)
**Parent:** [phase5-commercial-brief.md](phase5-commercial-brief.md)

---

## 1. What this is for

A quote is the first document a client sees. It is also the document that decides what everything
downstream is worth: the project's rate, its budget, and eventually the invoice. So the goal is not
"a PDF generator" — it is **one number, entered once, that flows to the project and then to the
invoice without anyone retyping it.**

The loop this closes:

```
quote (accepted) → project (rate + budget) → hours → invoice
```

Today the middle of that chain is hand-typed. You created the Power BI project and typed €35/hr
into it. After this phase, accepting a quote does that for you, and the invoice can be traced back
to what the client actually agreed to.

---

## 2. What we already have that this reuses

Phase 5c built more than invoicing. Quoting reuses it rather than duplicating it:

| Reused | From |
|---|---|
| VAT computation per rate group, half-up, integer cents | `core/money/vat.ts` (moved there during this phase) |
| Org identity on the document header (KvK, BTW, IBAN) | `core/settings` |
| PDF rendering conventions and layout | `billing/invoice-render.ts` |
| Storing the sent document immutably | Document Management |
| Editable draft lines, add/remove rows | the invoice line editor pattern |

**Nothing here needs a new money type, a new VAT path, or a new PDF stack.** If it does, that is a
signal something is being modelled twice.

---

## 3. The shape

**Entities:** `quote`, `quote_line`
**Events:** `quote.sent`, `quote.accepted`, `quote.rejected`
**Statuses:** `draft → sent → accepted | rejected | expired`

A quote belongs to a client, optionally to an existing project (a follow-on quote), and carries
lines much like an invoice: description, quantity, unit price, VAT treatment inherited from the
client.

---

## 4. The decisions this phase needs

### D1 — Where does the price come from?

The parent brief says rate cards (5b) should precede quotes, because *"a quote priced from an
ad-hoc number is a quote that disagrees with the invoice later."* That reasoning holds at ten
clients. At one client and one rate it inverts: a rate-card module would be an abstraction over a
single number.

**Recommended:** quotes carry their own explicit lines and rates. **Accepting a quote writes the
rate onto the project**, so the quote becomes the single source of truth for what work is worth —
which is exactly what a rate card would have provided, without the extra table. When a second and
third rate appear, 5b generalises this rather than replacing it.

### D2 — Click-to-accept, or accept on your side?

The parent brief describes a click-to-accept link. That would be **the platform's first
unauthenticated public endpoint** — a genuinely different security posture, and the reason Phase 7
(Client Portal) was scheduled last with the most security attention.

**Recommended:** for now, you mark a quote accepted or rejected. With one client, acceptance
arrives by email or in a call anyway; the button would mostly serve a client who does not exist
yet. Public click-to-accept lands with Phase 7, where its security gets the attention it deserves,
and the status model here is already built to receive it.

### D3 — What happens when a sent quote changes?

Negotiation means revision. Two options:

- **Edit in place** — simple, but you lose what was actually sent, and "which version did they
  agree to?" becomes unanswerable.
- **Immutable on send, revise as a new version** — sending freezes the quote and files its PDF;
  a revision creates v2 linked to v1.

**Recommended:** the second, for the same reason invoices are immutable. A quote is a document you
made a promise with. It should be reproducible exactly, and the acceptance should point at a
specific version.

### D4 — Numbering

Invoices need gapless sequential numbers by law. **Quotes do not.** A quote that is drafted and
abandoned may leave a gap without consequence.

**Recommended:** `Q2026-0001`, allocated on send (not on draft), gaps tolerated. Same shape as
invoice numbers so they read as a family, separate counter so an abandoned quote never disturbs
the invoice sequence.

### D5 — Expiry

Quotes carry a "valid until" date. Nothing should silently change state behind your back, so
**expiry is derived for display** (like `overdue` on invoices) rather than a background job
rewriting rows.

### D6 — What does accepting actually create?

**Recommended:** accepting a quote offers to create a project pre-filled with the client, the
rate, the budget (from the quote total) and the billing model, linked back to the quote. Offers,
not does — a quote for extra work on an existing project should attach to that project instead of
spawning a second one. The choice is a click, not a guess.

---

## 5. AI in this phase

Per the AI plan, this is the headline scenario: **"draft a quote from this conversation."**

| Tool | Risk class | Notes |
|---|---|---|
| `sales_list_quotes` | `read` | Pipeline visibility |
| `sales_draft_quote` | `write:draft` | Drafts scope and lines from a meeting note, document, or chat context |
| `sales_send_quote` | `restricted` | **Not bound.** Same treatment as `billing_send_invoice` — the assistant never sends a client-facing commercial document |

The draft tool is where AI earns its place: turning "they want a Power BI dashboard, maybe three
days, plus a workshop" into structured lines you then correct. It must produce a **draft that looks
like a draft** — never a number presented with false confidence.

---

## 6. Tests this phase must have

Written before the UI, in the spirit of 5c:

1. **Totals match a hand calculation**, including a mixed-VAT quote — reusing the invoice VAT
   engine, so this is mostly a wiring test.
2. **A sent quote is immutable**, enforced by trigger, not by service politeness.
3. **Revising a sent quote creates a new version** that references the original, leaving v1 intact.
4. **Accepting sets the project rate**, and the resulting project's rate matches the quote line —
   the seam this whole phase exists for.
5. **Expiry is derived**, so a quote does not change state while nobody is looking.
6. **Numbering is allocated on send**, and an abandoned draft leaves the invoice sequence alone.

---

## 7. Build order

| Step | Deliverable | Done when |
|---|---|---|
| 1 | Schema, VAT wiring, service, immutability trigger | Tests above pass |
| 2 | PDF rendering reusing the invoice layout | A quote PDF renders and files |
| 3 | Quote list + detail + line editor | A quote can be drafted and sent |
| 4 | Accept → project conversion | The Power BI project could have been created this way |
| 5 | AI draft tool | "Draft a quote for…" produces a reviewable draft |

---

## 8. What was built (2026-07-28)

All six decisions were confirmed as recommended. Delivered against §7:

| Step | Status |
|---|---|
| Schema, VAT wiring, service, immutability trigger | ✅ 24 tests |
| PDF reusing the invoice layout | ✅ filed at send, CONCEPT preview for drafts |
| List, detail, line editor | ✅ |
| Accept → project conversion | ✅ carries rate and budget |
| AI draft tool | ✅ verified live |

**Verified end to end.** A two-line quote (24h × €35 + €450 fixed) sent as `Q2026-0001`,
accepted, and the project it created carried €35/hr and the €1290 ex-VAT budget. The AI
tool was given *"about three days at my usual rate plus a half-day workshop for a fixed
450 euro"* and produced exactly that: 24 hours at €35 looked up from the client's project,
a €450 fixed line, drafted not sent, with `ai_initiated` recorded in the audit log. All
test data was removed afterwards, so `Q2026-0001` remains free.

### Two things the build surfaced, neither about quotes

**The VAT engine moved to `core/money/vat.ts`.** The boundary rule refused Sales importing
`billing/vat.ts`, and it was right: two modules now price the same work, so the engine is a
platform concern rather than billing's private business. A quote and its invoice must agree
to the cent, and they only can by running the same code.

**The test suite was writing uploads into the real storage directory.** `StorageService`
resolves `STORAGE_PATH` at construction and nothing overrode it under test, so 374 orphaned
files had accumulated — unreferenced by any row, and included in every nightly backup. Tests
now use a throwaway directory; storage reconciles exactly against `docs.versions`.

### One thing deliberately left as-is

An **expired quote can still be accepted**. Expiry is information, not a lock — whether to
honour a lapsed price is a commercial decision, and the database should not make it.

---

## 9. What this phase deliberately does not do

- **No client portal.** D2 above.
- **No rate card module.** D1 above; 5b generalises when a second rate exists.
- **No e-signature.** Accepting is a status, not a signature. If a signed document is ever needed,
  that is a contract (5b), not a quote.
- **No automated sending.** Same position as invoices: the PDF is yours to send until sending is
  built deliberately.
