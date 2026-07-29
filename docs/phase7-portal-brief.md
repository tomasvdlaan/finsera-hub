# Phase 7 — Client Portal

**Status:** brief, awaiting one decision (G4 — portal auth)
**Parent:** [build-roadmap.md](build-roadmap.md) §Phase 7

---

## 1. Why this one is different

Everything built so far has exactly one user, and a permission bug means Tomas sees
something in the wrong order. Here a permission bug means **a client sees another
client's data**. That is not a worse version of the same problem; it is a different
problem, and it is why the roadmap put this last.

So the governing rule for this phase, from which everything else follows:

> **Portal data is not internal data with a filter over it. It is a separate,
> explicitly-built projection, and the internal data is architecturally unreachable.**

A filter is one forgotten `WHERE` clause away from a leak. A separate projection cannot
leak what it never had.

## 2. What a client would actually get

Small, and useful because it is small:

- **Their projects** — status, what is happening, nothing about margin or internal notes
- **Documents shared with them** — explicitly shared, never "all documents for this client"
- **Quotes** — read, and accept. This is the one that pays for the phase: click-to-accept
  is what G3's predecessor deferred out of 5a, and the portal is where it belongs
- **Invoices** — what is owed and what is paid, with the PDF
- **A request form** — becomes an internal task, so "can you also…" stops living in email

Explicitly not: hours, rates, margin, internal meeting notes, the pipeline, anything about
other clients, and anything about the business.

## 3. The decisions

### G4 — how a client signs in

Zitadel is already fixed (D5), with a **separate tenant** so a portal account can never be
an internal account. What is open is the method:

| | For | Against |
|---|---|---|
| **Magic link** *(recommended)* | Nothing to remember, nothing to reset, no password to leak. A finance person logging in twice a year will never remember a password | Email becomes the security boundary; a forwarded link is an account |
| **Password** | Familiar; works when email is slow | Password reset flows, storage, and the reset flow is itself an attack surface |
| **SSO into their own tenant** | Best security, no new credential | Only works for clients with an IdP, and needs setup per client — for one client, weeks of work for one login |

**Recommended: magic link**, with short expiry and single use. For a consultancy whose
clients log in occasionally, it is the only one that gets used rather than reset. SSO
stays available later for a client who asks — that is a per-client addition, not a
rewrite.

### Portal exposure is per-entity and opt-in

Every module manifest already has a `portalExposure` field, empty everywhere. It stays
empty unless a module deliberately declares an entity visible, and the portal reads only
what is declared. Nothing is portal-visible by default, and adding a module cannot
accidentally expose anything.

### The portal assistant, if any

The roadmap wants one. It would need a tool set built from `portalExposure` alone —
architecturally unable to reach an internal tool, not merely filtered from calling it.

**Recommended: not in the first cut.** The portal is worth having without it, and the
assistant is the part where a mistake is worst. Ship the portal, watch it, then decide.

That also defers O8 (client DPA language for AI processing) rather than forcing it now.

## 4. What must be true before a client sees it

- **A security review**, on the portal specifically. Not a general code review: an
  attempt to reach another client's data through every endpoint the portal exposes.
- **Tests that assert the negative** — a portal user requesting another client's invoice
  gets nothing, and the test fails loudly if that ever changes.
- **Rate limiting** on the login endpoint, because a magic-link request form is a mail
  bomb otherwise.
- **The audit log covering portal reads**, not just writes. Who saw what matters more
  externally than internally.

## 5. Build order

| Step | Deliverable |
|---|---|
| 1 | Portal projection layer + `portalExposure` enforcement, with negative tests |
| 2 | Zitadel portal tenant, magic-link sign-in, rate limiting |
| 3 | Read-only portal: projects, documents, invoices |
| 4 | Quote acceptance — the part that earns its keep |
| 5 | Request form → internal task |
| 6 | Security review before a single external user |

## 6. Deliberately not in this phase

- **A portal assistant.** §3.
- **Payment.** Showing what is owed is useful; taking money is a different regulated
  problem.
- **Client user management.** One login per client to start; roles inside a client
  organisation is a problem for when a client asks.
