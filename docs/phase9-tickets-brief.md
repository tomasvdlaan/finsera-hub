# Phase 9 — Tickets: a conversation somebody is told about

**Status:** drafted 2026-09-12; **steps 1–5 built that day, P5 (rich text) built 2026-09-14**.
P3 (mail) is gated on a provider choice; P6 (attachments) is not started
**Parent:** [phase8-portal-v2-brief.md](phase8-portal-v2-brief.md) §4.1 (the ticket schema) and
§4.6 (the internal inbox) — everything there still governs
**Renaming already done:** the client-facing tab is *Tickets* at `/tickets`, with `/vragen`
redirecting; the hub page is reachable from **Board → Work → Client tickets**

---

## 1. What is being asked

Tickets exist and work. The ask is that they become a feature rather than a screen: called
what they are, findable, and — the part that matters — **capable of telling somebody that a
client is waiting.**

Three things, in the order they were raised:

1. **Call them tickets.** Done ahead of this brief: the portal tab, the page copy, the route.
2. **Where do they land in hub?** In exactly one place, and until this week nothing linked
   to it. Fixed, and §2 says why it happened.
3. **Make the feature richer** — including rich text in a thread.

The third is the open question, and it needs ordering rather than a list. What follows puts
notification first and formatting seventh, for the reason §2 makes plain.

## 2. What exists, and what it means for this

`portal.tickets` and `portal.ticket_messages` are complete and well-shaped. The status is
**derived, never typed** (`waiting_on_finsera` / `waiting_on_client` / `closed`), which is
the property that makes "what do we owe people" trustworthy. Messages carry
`internal_only`, filtered in exactly one query. The service already implements `open`,
`replyAsClient`, `reply`, `close`, `reopen`, `assign`, `convert`, and a per-visitor rate
limit.

What is missing is not in the data model. It is everything between a ticket existing and a
person knowing it does:

- **No event is published.** The portal manifest publishes `portal.signed_in` and nothing
  else, so opening a ticket writes two rows and raises nothing. No timeline entry, no
  Today, nothing an assistant or a rule could consume.
- **No mail, anywhere in the platform.** `core/graph` is deliberately drive-only — its own
  types file says "no mail, no calendar, no user directory". So "email the client back"
  is not a feature of this module; it is a platform capability that does not exist yet (P3).
- **The Inbox badge cannot see tickets.** `NavCounts` has one field, `attention`, and
  `App.tsx` computes it from open insights plus mentions. Tickets are in neither.
- **Nothing linked to the hub inbox.** `portal.manifest.ts` declares *Client tickets* in
  `section: 'work'`, and only the `money` section ever rendered its tab strip — the same
  hole `useNav.tsx` documents for four finance pages, repeated. Whiteboards was orphaned
  with it. Now fixed by rendering the strip on the Work page.
- **A closed ticket has no address.** `inbox()` filters `status <> 'closed'` and there is
  no archive view, so closing a ticket makes the thread unreachable unless you know its
  UUID. That is a bug wearing a feature's clothes.
- **`assign()` has no button.** The method is tested and unreachable, so "is anyone on
  this" cannot be answered from the screen.
- **Triage is `portal.admin`**, which is `adminOnly` by declaration. A member opening
  `/portal/tickets` gets an empty page, which reads as broken rather than as forbidden.
- **Both sides are plain text**, deliberately (`Tickets.tsx` says so), and both render
  `white-space: pre-wrap`, so paragraphs survive. Hub already runs TipTap for meeting
  notes, so an editor is nearly free — the cost of rich text is storage, sanitisation and
  the assistant boundary, not the widget.

Two of those facts decide the shape of this phase:

- **The Insights engine is already the thing being asked for.** It regenerates candidates
  from published views each run, matches on a stable `key`, **self-resolves** when the
  condition stops being true, carries `severity`, `audience` and `personId`, and records
  dismissal per person. "A client has been waiting four days" is that shape exactly. There
  is even a sibling rule, `waiting_on_client_too_long`, for the mirror case. Building a
  bespoke ticket counter next to this would be a second, worse notification system.
- **Insights rules read published views only.** `portal.tickets` is a private module
  table, so the rule cannot read it. The portal must publish a view first — which is the
  same discipline Reporting holds itself to, and the reason P2 has a schema step.

## 3. The decisions

### P1 — Publish events on ticket activity (recommended: yes)

Publish `portal.ticket_opened` and `portal.ticket_replied` (client side only; our own
replies are not news to us) in the same transaction as the message insert, against the
client, the way `portal.signed_in` already is.

| | For | Against |
|---|---|---|
| **Publish two events** *(recommended)* | Every later surface — timeline, Today, the assistant, mail when it exists — becomes a consumer rather than a new integration. Matches how the rest of the platform learns anything | Two manifest lines and two service calls; events are cheap but not free |
| **Let each surface query the tickets table** | Nothing new to declare | Every surface then needs the portal's private tables, which is the coupling the manifest exists to prevent |

**Note what is deliberately absent.** No event for our own replies, and none carrying the
message body. An event is a fact that something happened, and a client's prose travelling
through the bus is how it ends up somewhere nobody audited — including in front of the
assistant, which the portal manifest specifically refuses.

### P2 — The badge comes from an Insights rule, not a new counter (recommended: yes)

Publish `portal.v_tickets` (open tickets with client, age, status, assignee) and add a
rule: *a ticket has been waiting on us for more than N days.*

| | For | Against |
|---|---|---|
| **An Insights rule** *(recommended)* | The badge, the Inbox page, per-person dismissal, audience routing and self-resolution all come free. `waiting_on_client_too_long` is the mirror image and already lives there | Needs a published view first; the rule fires on age, so it is a nudge rather than an instant ping |
| **A third fetch in `App.tsx`** | Ten lines; matches the two fetches already there | A count with no page behind it, no dismissal, no audience. And a second notion of "needs attention" |
| **Both** | Instant *and* nagging | Two systems disagreeing about the same number, which is how a badge stops being believed |

Open question for the build: **N**. One day is a nudge; three is a reproach. Recommend
**two days**, `attention`, rising to `urgent` at seven — and `audience: 'delivery'` so it
reaches the same people the mirror rule does.

### P3 — Mail is a platform decision, not a ticket feature (recommended: defer, deliberately)

A client learning by email that we answered is the single most valuable thing on this list
and the only one that cannot be built inside this module. There is no mail capability at
all today.

| | For | Against |
|---|---|---|
| **Graph `sendMail`, reusing the existing app registration** | The tenant is already there; mail comes from a real Finsera mailbox, so replies go somewhere a person reads | Needs a new Graph scope and an admin consent step; `core/graph` is deliberately drive-only and this widens it |
| **A transactional provider (Postmark/Resend)** | Best deliverability and bounce handling; independent of the tenant | A second processor to name in the DPA, for mail that is mostly to clients — exactly the paperwork D-decisions exist to keep deliberate |
| **SMTP via the existing mailbox** | No new processor, no new scope | Credentials in env, no bounce handling, and the first spam classification is silent |

**Recommendation: decide this as its own gate (G8), after P1–P2 ship.** Once events exist,
mail is a subscriber and not a rewrite. Building it first would mean choosing a provider
under pressure because a screen needs it.

### P4 — A closed ticket keeps its address (recommended: yes)

Add a status filter to the hub inbox (`open` by default, `all`, `closed`) reading the same
view P2 publishes, and keep the thread route working regardless of status.

No table here: the alternative is "leave it", and leaving it means the archive of what we
answered is reachable only by UUID.

### P5 — Rich text: a markdown subset, stored as source (recommended: yes, after P1–P4)

| | For | Against |
|---|---|---|
| **Markdown subset — bold, italic, lists, links, inline code** *(recommended)* | The stored form stays text, so the `length BETWEEN 1 AND 5000` check keeps meaning what it says; renderable with a fixed element allow-list; degrades to legible plain text everywhere it is not rendered | A renderer and a sanitiser on both sides |
| **TipTap both ways, storing HTML** | The editor already exists in hub | Client-authored HTML rendered inside hub is an XSS with an admin session behind it. And 5000 characters of HTML is a third of the prose, silently |
| **Rich for us, plain for them** | Half the work | The client sees formatting they cannot reply in kind with; and our text is the half that least needs it |
| **Leave it plain** | Zero risk, and `pre-wrap` already keeps paragraphs | A ticket about an invoice cannot link to the invoice |

No inline images: that is P6 wearing a disguise.

**Built 2026-09-14, and one thing came out differently.** The plan said "a renderer and a
sanitiser on both sides"; there is no sanitiser, because `@platform/ticket-markdown` returns
a **tree of nodes with string leaves** rather than an HTML string. Each app maps those nodes
to React elements, React escapes every leaf, and `dangerouslySetInnerHTML` appears nowhere in
the path — so there is no list of dangerous things to keep current. What a sanitiser would
have guarded is instead impossible to express. The link check survives as the one real rule:
`http:`, `https:` and `mailto:` are clickable and everything else renders as the text
somebody typed, parsed with `URL` so that `JaVaScRiPt:` and a leading space are the same
question.

A single newline is a **line break**, not a paragraph join. Strict Markdown would have
silently reflowed every message written while both sides were plain text with
`white-space: pre-wrap`, which is a formatting feature rewriting other people's words.

### P6 — Attachments (recommended: yes, but last)

The commonest reason a thread falls back to email is "can you send me that document". It
needs a table, the storage module, a virus-scanning answer, and a size policy — and it is
the one item here that touches a client's files, so it wants its own security pass rather
than a paragraph in this one.

### P7 — Who may triage (recommended: widen to members)

Today `portal.admin` gates the inbox and it is `adminOnly`. Granting a login is genuinely
admin-only — it hands data to somebody outside the business. *Reading and answering a
ticket a client already opened* is delivery work.

Recommend a second capability, `portal.tickets`, held by members by default, gating the
inbox and the reply/close/assign routes; `portal.admin` keeps invitations and revocation.
Until then, hub should say "you do not have access to this" rather than render an empty
table.

## 4. Design

### 4.1 Data

```
portal.v_tickets                          (new view, published in the manifest)
  id, client_id, client_name, subject, status, project_id, task_id, assigned_to,
  opened_by_email, created_at, last_activity_at, days_waiting

portal.ticket_messages.body               (P5) unchanged column, markdown source
```

No new columns for P1–P4. Priority, due date and first-response time are explicitly not
here — see §6.

### 4.2 Events

| Event | When | Payload |
|---|---|---|
| `portal.ticket_opened` | a client opens one | `{ ticketId, clientId, subject }` |
| `portal.ticket_replied` | a client replies | `{ ticketId, clientId }` |

Against the client, in the message's own transaction. No body, no author prose.

### 4.3 The rule

`ticket_waiting_on_us`, reading `portal.v_tickets`:

```
key        ticket_waiting:<ticketId>
subject    ticketType 'portal_ticket', so the Inbox item links to the thread
audience   'delivery'
personId   assigned_to, so an owned ticket reaches its owner
severity   attention ≥ 2 days, urgent ≥ 7
title      "DocHorse has been waiting 4 days on «subject»"
```

It self-resolves the moment we reply, because the status flips to `waiting_on_client` and
the row leaves the view. That is the whole argument for P2.

### 4.4 Internal UI

- **Inbox** (`/portal/tickets`): a status filter (P4), an assignee column with a picker
  (P7 wiring `assign()`), and the age the rule is measuring, so the screen and the badge
  agree.
- **Client page**: a `tickets` widget declared in the manifest, `entity-page`, scoped to
  `client` — open tickets for the client whose page you are on. The portal manifest
  declares no widgets today, so this is the first.

### 4.5 Portal UI

Unchanged for P1–P4. P5 adds a small formatting toolbar and renders the same subset on
both sides.

## 5. Build order and gates

| Step | What | Proof it works |
|---|---|---|
| 1 ✅ | `portal.v_tickets` + manifest declaration + the two events (P1) | A client opens a ticket; the event is in the outbox and on the client's timeline. Built 2026-09-12 |
| 2 ✅ | `ticket_waiting_on_us` rule (P2) | A ticket two days old appears in Inbox and on the badge; replying makes it resolve itself, unprompted. Built 2026-09-12 |
| 3 ✅ | Status filter + reachable closed threads (P4) | Close a ticket, find it again without a UUID. Built 2026-09-12 |
| 4 ✅ | Assignee column and picker, `portal.tickets` capability (P7) | A member can triage; assignment shows on the row and routes the insight. Built 2026-09-12 |
| 5 ✅ | Client-page widget (4.4) | A client's open tickets are visible while looking at that client. Built 2026-09-12 |
| **G8** | **Mail (P3)** — decide the provider before building | A client is told by email that we replied |
| 6 ✅ | Markdown subset both ways (P5) | A ticket links to an invoice; nothing a client types renders as markup in hub. Built 2026-09-14 |
| 7 | Attachments (P6), with their own security pass | A client attaches a PDF and we open it |

**Built 2026-09-12, steps 1–5.** `days_waiting` is measured from the client's last message
and is null the moment a ticket is not ours, so the insight resolves itself rather than
waiting to be dismissed — asserted in `portal-tickets.service.spec.ts`. The threshold went
in at the recommended **2 days (`attention`) / 7 days (`urgent`)**. Not yet run against
production data: the rule fires on the Insights schedule, so the first real item appears
with the next run after deployment.

**Gate:** steps 1–3 are the phase. If only those ship, the feature has stopped being a
screen you must remember to visit, which is the whole point. 4–5 make it pleasant; 6–7 make
it complete.

## 6. Out of scope, on purpose

- **Priority, due dates, SLA timers, first-response reporting.** Cheap columns, and
  meaningless until somebody is told a ticket exists. Revisit after G8; measuring a process
  nobody is notified about produces numbers that only describe the notification gap.
- **A portal assistant, or any AI over ticket text.** The portal manifest declares no
  `aiTools` precisely so a client's words are never read as our instructions. Nothing here
  changes that.
- **Client-visible assignment.** Whose desk it is on is our business; the client is owed an
  answer, not an org chart.
- **Ticket categories or forms.** A subject and a body is what people actually write. A
  taxonomy is a thing to maintain and a question to answer before asking a question.
