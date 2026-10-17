# Notifications — being told, wherever you are

**Status:** drafted 2026-10-17; **all recommendations (N1–N12) accepted the same day** — see the
decision log, 2026-10-17. Nothing built; N0 is next
**Reverses, narrowly:** [ui-elevation-plan.md](ui-elevation-plan.md) §5, *"A notifications system — don't
build"*. §2 says what changed and why the principle behind that call survives
**Keeps:** [ui-ux-plan.md](ui-ux-plan.md) §2, *"one triage queue, and a new alert type joins it or does not
exist"* — this brief is built on it, not around it
**Depends on:** gate **G8** (mail provider) for the email channel only; everything else stands alone

---

## 1. What is being asked

A way to be told about things without having to go and look. It started as one case — *a timer
that has been running for three hours* — and widened to the ordinary ones: **being mentioned, a
task being assigned to you, a client waiting on you.**

The question is not whether the platform should be able to notify. The master document put
notifications in the core and a notification centre in the shell from the first page. It is
**what deserves to interrupt somebody, through which channel, and how that stays true as the
platform grows** — because a notification system is easy to build and very easy to make into
something everybody turns off in the second week.

## 2. What exists, and what it means for this

**The Inbox is already the queue.** `/insights` holds fifteen rules that raise items addressed
to a person (`personId`) or a department (`audience`), resolve themselves when the cause goes
away, and escalate from *attention* to *urgent*. Mentions land on the same page. The top bar
shows one number for both. That is the right model, and this brief keeps it: **a notification is
a way an Inbox item reaches you, never a second place it lives.**

**But the badge is not live.** The elevation plan rejected a notifications system because
*"/inbox with a live badge is the right size"*. The live badge was never built: `App.tsx`
fetches the count once, when you sign in, and never again. On a phone — which the app now
genuinely supports — nobody keeps a tab open, so a number that only refreshes at sign-in is a
number nobody sees. The assumption under the old call, *two people who sit near each other*,
also stops holding once the team works from a client site or a train. So the narrow reversal:
**the queue stays one queue; it gains a way to reach you.**

**The events mostly exist, and nothing listens to them.** The core has a transactional outbox
(`core.events`) and a dispatcher with retries and a dead-letter state. Every manifest declares
`subscribes: []`. Two faults in the dispatcher have never mattered because of that, and both
would the moment a subscriber is added:

- **Starvation.** `fanOut()` reads the oldest 200 events that have no delivery rows, and skips
  any event nobody subscribes to *without writing a row*. Those events never leave the window.
  There are already more than 200 of them, so a new subscriber's events would never be reached
  (`event-dispatcher.service.ts:72–99`).
- **Backfill.** The dispatcher deliberately delivers events published before a subscriber
  existed (its spec asserts it). For a projection that is right; for a notifier it means the
  first run announces every mention since July.

**Some moments publish nothing.** Comments and mentions (by design, so far), timesheet
submit/approve/return, ticket assignment, action items, project membership and ownership
changes are audit-only. `task.created` with an assignee — which is how every task made from a
meeting action point starts — does not emit `task.assigned`. `task.blocked` stores
`blockedOnUserId` but leaves it out of its payload. Each is a small, local fix (§4.6).

**Nothing on the client can receive a push.** No manifest, no service worker, no Push API. The
assistant uses SSE; the meeting room and whiteboard use per-document websockets. **No outbound
mail exists** — portal invitations hand back a link for somebody to paste — and the provider is
gate G8. People have no time zone, working hours or preferences anywhere.

## 3. The decisions

### N1 — Notifications deliver the Inbox; they are not a second queue (recommended: yes)

Every notification is about something that is, or was, an item you could act on in hub, and
opening one lands you on that thing. There is no separate feed of "activity", and nothing is
notified that the Inbox would not also show. This is the guard against the failure the
elevation plan was right to fear: a second stream of alerts that disagrees with the first.

Concretely, two kinds of source feed one table:

- **Moments** — something happened that is addressed to you: a mention, an assignment, a client
  reply. Published as events; a notifications subscriber turns them into notifications.
- **States** — something has become true and is still true: a clock running too long, a task
  overdue, a ticket waiting. These are already Insights rules; when one is *raised for you* or
  *escalates to urgent*, it becomes a notification, and when it resolves, the notification
  clears.

### N2 — One record per person, delivered through channels (recommended: yes)

A notification is a row in `core.notifications`, owned by one person. **In-app is not a channel
you can turn off — it is the record.** Push and email are deliveries of that record, logged in
`core.notification_deliveries` so that "did it reach me?" has an answer and a retry. A
notification that clears (its insight resolved, its ticket answered) clears in-app at once; a
push already on a lock screen cannot be recalled, which is one reason push is reserved for the
top tier (N4).

### N3 — Fix the dispatcher before anything listens (recommended: yes, as step zero)

Both faults in §2 are fixed before the first subscriber is registered:

- `fanOut()` writes a terminal marker for events with no subscribers (or selects only event
  names that have one), so the window always moves.
- A subscriber declares a **start point** — the time it was first registered — and the
  dispatcher never fans out an older event to it. The notifier starts at its deploy; the
  timeline, which wants history, keeps the old behaviour.

Also worth recording, not fixing yet: the dispatcher's `running` flag serialises within one
process. Production runs one API container, so this is fine; a second replica would
double-deliver, and the notifications table's unique `(person, dedupe_key)` (§4.1) is the
backstop.

### N4 — Three tiers, and only the top one interrupts (recommended: yes)

What a notification is *for* decides where it goes. Every moment in §4.2 is assigned one tier,
and the person can move a category down but the defaults are what most people will live with.

| Tier | Means | Default delivery |
|---|---|---|
| **Now** | Somebody is waiting on you by name, or time or money is leaking right now | In-app + push |
| **Today** | Matters today, not this minute | In-app, and the **morning brief** (one push, start of day) |
| **Quiet** | Worth knowing when you next look | In-app only |

The morning brief is the pressure valve: everything that would otherwise be a dozen pushes a
day becomes one line at 08:30 — *"3 things for you today: an overdue task, a sprint ending, an
invoice 30 days late"* — that opens the Inbox.

### N5 — The in-app home is the Inbox, and the badge becomes live (recommended: yes)

No bell, no drawer, no second count. The Inbox gains a **For you** section above the
department-wide list: mentions (which are already there) widen into all of your notifications,
newest first, unread in bold, each clearing when its cause does. The top-bar and bottom-bar
number stays one number — your unread notifications plus open items addressed to you.

"Live" in the cheapest form that works for four people: refetch the count **every 60 seconds
while the tab is visible, on focus, and when a push arrives** (the service worker posts to open
tabs). A per-person websocket is possible — `auth.verifyToken` already authenticates three
gateways — but is not worth its moving parts until polling is shown to be too slow.

On an installed app, the **icon badge** carries the same number (`navigator.setAppBadge`,
supported on iOS 16.4+ for Home Screen apps). It is the closest thing to a widget the web gets.

### N6 — Push is Web Push, push-only, with nothing private on the lock screen (recommended: yes)

- **Standard Web Push with VAPID keys**, through the browsers' own push services (Apple, Google,
  Mozilla). No account, no fee, no SDK; the `web-push` library (MIT, widely used) on the API.
  Payloads are encrypted end to end between our server and the device (RFC 8291) — the relay
  sees that a message exists, not what it says.
- **A push-only service worker.** It shows notifications and handles the click. It **caches
  nothing**: the platform already goes to some length to know which build a browser runs, and a
  caching worker is the classic way to serve last week's bundle against this week's API.
- **On iPhone it requires installing the app** ("Add to Home Screen"), and permission can only be
  asked from inside the installed app, from a tap. The enable flow (§4.4) explains this in one
  screen rather than failing silently. On a Mac or PC it works in the browser.
- **What may appear on a lock screen:** who, what kind of thing, and its title — *"Charlotte
  replied on the DocHorse ticket 'Supplier page'"*. **Never a body, never an amount.** That is
  the same line the ticket events already draw (*the subject travels, the body never does*),
  applied to a screen anybody across the table can read.
- **Sign-out removes this device's subscription**; deactivating an account removes all of them.
  A shared laptop must not keep receiving somebody else's pushes.

### N7 — Working hours, and nothing at night (recommended: yes)

People get a time zone (default `Europe/Amsterdam`) and working hours (default Mon–Fri
08:30–18:30). Outside them, push is **held, not dropped**, and delivered — collapsed — at the
start of the next working window. There is no "urgent overrides quiet hours" exception in the
first version: nothing in this business is worth waking somebody for, and the one candidate,
a clock left running overnight, is better answered in the morning (§4.3), where the Time page
already asks for the hours actually worked.

### N8 — Collapse, cap and never notify yourself (recommended: yes)

- **You are never notified of your own action.** Naming yourself in a comment, assigning a task
  to yourself, approving your own timesheet — the actor is always excluded.
- **Collapse by subject.** Notifications carry a group key (the task, the ticket). Five comments
  on one task in ten minutes are one notification that says *five*; on a device, a later push
  with the same tag replaces the earlier one rather than stacking.
- **Rate limits per person:** at most one push per subject per 15 minutes, and a ceiling of 20
  pushes a day, after which the rest wait for the next morning brief. The ceiling is a backstop
  that should never be hit; if it is, a rule is wrong, and the delivery log says which.
- **Dedupe:** `(person, dedupe_key)` is unique, so an at-least-once redelivery of an event never
  produces a second notification.

### N9 — Settings per person, per category (recommended: yes)

Settings → **Notifications**, for each person:

- A short list of **categories** (§4.2 groups them into about eight), each with push on or off.
  In-app cannot be turned off (N2); email appears here once G8 lands.
- Working hours and time zone; the morning brief on or off and its time.
- **Timer reminders**: on or off and the thresholds (§4.3).
- **This device**: turn push on (with the install explanation on iPhone), send a test, and a list
  of the other devices receiving pushes, each removable.
- Per record, a **Mute** on a task, ticket or meeting note, for the thread you no longer need to
  follow.

Defaults are chosen so that a person who never opens this page gets the right thing.

### N10 — Email waits for G8, and G8 now has a reason (recommended: decide G8 next)

Email is the channel for two cases push cannot serve: **somebody who has not installed the app**
(a daily digest of what they missed) and **clients**, who have no hub account to push to. The
Phase 9 brief deferred the provider deliberately; notifications are the first feature that needs
it on its own terms.

The evidence in the decision log points one way: `finsera.nl` already publishes SPF, Microsoft
DKIM and DMARC aligned for **Microsoft 365**. Graph `sendMail` from a dedicated mailbox, with
an application access policy restricting the app to that one mailbox, sends from the domain that
is already authenticated, adds no new data processor, and keeps `core/graph` drive-and-one-mailbox
rather than tenant-wide. Recommended — but as G8, decided in its own short note, not here.

### N11 — Clients, later and by email only (recommended: defer to after G8)

The portal brief chose *"no settings, no profile, no notifications"* for clients, and the reason
— a portal a client visits occasionally should not grow an inbox to manage — still holds for
push. Email is different: *"We answered your question"*, *"A quote is ready for you"*, *"An
invoice has been issued"* are the three messages that make a client come back, and the
recipients are already resolvable (`portalUserId`, and `seesQuotes` / `seesInvoices` with
artefact visibility). It needs one new event (`portal.ticket_answered`, for our replies — today
deliberately unpublished) and G8. Phase N6 below.

### N12 — Language (recommended: English in hub, Dutch to clients)

Notifications speak the language of the screen they open: hub is English, so are its
notifications; the portal and the client mails are Dutch, like everything else a client reads.

## 4. Design

### 4.1 Data

All in `core`, because notifications cross every module and the master document puts them
there.

```text
core.notifications
  id, person_id → users, category, tier ('now'|'today'|'quiet'),
  subject_type, subject_id          -- the registry entity it is about; drives the link
  actor_id → users | null           -- who did it; never equal to person_id
  title                             -- the lock-screen-safe sentence (N6)
  count                             -- collapsed occurrences (N8)
  group_key, dedupe_key             -- unique (person_id, dedupe_key)
  insight_id → insights | null      -- set for states; clears with it
  created_at, read_at, cleared_at

core.notification_deliveries
  id, notification_id, channel ('push'|'email'), device_id | null,
  status ('held'|'sent'|'failed'|'skipped'), reason, scheduled_for, sent_at, attempts, error

core.push_devices
  id, person_id, endpoint (unique), p256dh, auth, label (from user agent),
  created_at, last_success_at, failures, revoked_at
  -- a 404/410 from the push service revokes the row; three consecutive failures likewise

core.notification_settings          -- one row per person
  time_zone, work_days, work_start, work_end, brief_enabled, brief_at,
  push_by_category jsonb, timer_reminders jsonb, muted jsonb
```

Retention: read notifications are deleted after 90 days and deliveries after 30. A log of what
was sent to somebody's phone is personal data and has no reason to outlive its use.

### 4.2 The catalogue

The moments, grouped into the categories a person sees in settings. *Source* says what exists
today: ✓ an event or rule exists; **+** something small must be added (§4.6).

| Category | Moment | Who | Tier | Clears when | Source |
|---|---|---|---|---|---|
| **Mentions** | Named in a comment | The person named | Now | Read | **+** `comment.mentioned` (rows exist in `core.mentions`) |
| **Your tasks** | A task is assigned to you | Assignee | Now | Read | ✓ `task.assigned` (update); **+** emit on create |
| | A task is blocked on you | `blockedOnUserId` | Now | Unblocked | ✓ `task.blocked`; **+** carry `blockedOnUserId` |
| | Your task is overdue / ageing in a column | Assignee | Today | Done or moved | ✓ rules `task_overdue`, `task_aging_wip` |
| | An action point from a meeting is yours | Action item assignee | Now | Accepted or dismissed | **+** `action_item.assigned` |
| | A task you created is done, or unblocked | Creator | Quiet | Read | ✓ `task.completed`, `task.unblocked` |
| **Comments** | A comment on a task you are assigned to or created, or a reply to your comment | Assignee, creator, parent author | Quiet (collapsed) | Read | **+** `comment.created` |
| **Clients** | A client opens a ticket | Client owner, else `delivery` | Now | Answered | ✓ `portal.ticket_opened` |
| | A client replies on a ticket | Ticket assignee, else client owner | Now | Answered | ✓ `portal.ticket_replied` |
| | A ticket is assigned to you | Assignee | Now | Read | **+** `ticket.assigned` |
| | A client has waited two days or more | Assignee, else `delivery` | Today | Answered | ✓ rule `ticket_waiting_on_us` |
| | A client accepts a quote in the portal | Quote creator + client owner | Now | Project set up | ✓ `quote.accepted` (actor null = portal) |
| | A client rejects a quote | Quote creator + client owner | Today | Read | ✓ `quote.rejected` |
| **Time** | Your clock has run long (§4.3) | The person | Now | Stopped | **+** time reminder job |
| | Your timesheet was returned, with the note | The person | Now | Resubmitted | **+** `timesheet.returned` |
| | A timesheet waits for your approval | Holders of `time.approve` | Today | Decided | **+** `timesheet.submitted` |
| **Money** | An invoice is paid | Invoice creator + client owner | Quiet | Read | ✓ `invoice.paid`; **+** carry `clientId` |
| | An invoice is overdue / unbilled work ageing | `finance` | Today | Paid / invoiced | ✓ rules |
| | A contract's notice window is closing | Client owner, else `sales` | Today | Window passes / renewed | ✓ rule (owner is new) |
| | A budget is nearly spent | Project lead, else `delivery` | Today | Budget raised | ✓ rule (lead is new) |
| **Meetings** | Notes of a meeting you were in are finalised | Attendees with a user, viewers | Quiet | Read | ✓ `meeting_note.finalised` (respect `restricted`) |
| | Action points from your meeting are still undecided | Note creator | Today | Decided | ✓ rule (addressed to `delivery` today) |
| **Projects** | You are added to a project, or made its lead or owner | The person | Quiet | Read | **+** `project.member_added`, `*.owner_changed` |
| | A sprint on your project starts or ends with open work | Project members | Today | — / sprint closes | ✓ `sprint.started`; rule |

**Insights not in this table stay in-app only**, as they are today — `setup_incomplete`,
`quote_unanswered`. And **any insight that escalates to *urgent* and is addressed to you by
name** is promoted one tier for that occurrence: the second, louder notice the rules already
encode.

Where a row says *client owner* or *project lead* and the record has none, it falls to the
department the Insights rule already names, and from there to admins — the same fallback chain
`list()` uses, so a notification can never reach somebody who could not see the item.

### 4.3 Timer reminders

The case that started this, designed on its own because it is about a clock, not an event.

- A job in the `time` module runs **every five minutes** — the Insights sweep, at six hours, is
  far too coarse — and looks at running entries.
- Default thresholds, each sent once per running entry: **after 3 hours**, **at the end of the
  working day if still running**, and — held by quiet hours — **at the start of the next working
  day if it ran overnight**: *"Your clock on Dashboard ran overnight (14h). Set the hours you
  actually worked."* The tap opens the Time page, which already asks for exactly that.
- Thresholds are per person (some days are one six-hour block on purpose), and the 3-hour
  reminder can be switched off without losing the overnight one.
- The existing `timer_left_running` insight (12h, urgent at 24h) stays as the backstop for
  anybody with reminders off; the overnight reminder makes it rare.
- **Not possible as a web app:** a live, ticking timer on the lock screen. That is an iOS Live
  Activity, native-only. A notification is a message, not a clock.

### 4.4 Client side

- **Manifest** (`/manifest.webmanifest`): name, icons from the existing logo, `display:
  standalone`, theme colours matching `index.html`. Also what makes "Add to Home Screen" open
  hub full-screen, which the phone tier already prepared for.
- **`/sw.js`**: `push` → `showNotification(title, { tag: group_key, data: { url, id } })` and
  `setAppBadge(count)`; `notificationclick` → focus an open hub window and navigate, or open
  one; then `POST /core/notifications/:id/opened`. Posts `{type: 'notification'}` to open tabs
  so their badge refreshes. **No `fetch` handler.**
- **Enable flow**, in Settings → Notifications → *This device*:
  - On iPhone in Safari (not installed): a short explanation with the Share → *Add to Home
    Screen* steps and why. No permission prompt — it would fail.
  - Installed, or on desktop: one button that asks for permission *from the tap*, subscribes,
    and sends a test notification at once, so the person knows it works.
  - Denied at the browser level: the one sentence on where to change it, not a broken toggle.
- **Inbox**: the *For you* section (N5), with mark-read, mark-all-read and per-thread Mute.

### 4.5 Server side

- `core/notifications`: the service that writes notifications (dedupe, collapse, actor
  exclusion, recipient fallback), the router that decides deliveries (tier × settings × working
  hours × rate limits), and the push sender (`web-push`, VAPID keys from `deploy/.env`).
- **Producers:** one subscriber per event in §4.2, registered with a start point (N3); a hook
  in `InsightsService.refresh()` where an item is raised or escalates, and where it resolves (to
  clear); and the time reminder job.
- **A minute job** sends held deliveries when a working window opens and composes each person's
  morning brief.
- **Endpoints:** `GET /core/notifications` (+ `?unread`), `GET /core/notifications/count`,
  `POST …/read`, `POST …/:id/opened`, `GET/PUT /core/notification-settings`,
  `GET /core/push/key`, `POST/DELETE /core/push/devices`, `POST /core/push/test`.
- **Config:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` for the push
  services to contact about abuse), named in `docker-compose.yml` as well as `deploy/.env` — the
  lesson from the Vercel secret, which reached the host and stopped there.

### 4.6 Events to add or widen

Each is local to its module and published in the same transaction as the change it describes.

| Event | Module | Payload addition |
|---|---|---|
| `task.assigned` on create, when an assignee is set | scrum | — (existing shape) |
| `task.blocked` | scrum | `blockedOnUserId` |
| `comment.created`, `comment.mentioned` | core | `subjectType`, `subjectId`, `parentAuthorId`; mentioned `userIds` |
| `ticket.assigned`, `portal.ticket_answered` | portal | `assignedTo`; for answered, the ticket only — never the body |
| `action_item.assigned` | meetings | `assigneeId`, `noteId` |
| `timesheet.submitted`, `timesheet.returned`, `timesheet.approved` | time | `personId`, `weekOf` |
| `project.member_added`, `project.owner_changed`, `client.owner_changed` | crm | `userId` / `from`, `to` |
| `invoice.paid` | billing | `clientId` |

Comments and mentions were kept off the bus *"by design"*. That design predates any subscriber;
the reason it gave — nothing needed them — is the one this changes. The comment **body** still
never travels; the notifier only needs who, where, and to whom.

### 4.7 Measuring whether it is right

The deliveries log answers the only question that matters after a month: **which categories
do people open, and which do they turn off?** A category with a low open rate and a high
switch-off rate is noise, and the response is to move it a tier down, not to tune the copy.
Reviewed once, four weeks after N2 ships, and written into the decision log.

## 5. Build order and gates

| Step | What | Gate to the next |
|---|---|---|
| **N0** | Dispatcher fixes (N3). `core.notifications` + settings tables. Inbox *For you*, live count (60s / focus). Mentions and assignments as the first producers. | In-app notifications appear for a mention and an assignment, clear correctly, never for your own action, and the first deploy announces nothing historical |
| **N1** | Manifest, push-only service worker, VAPID, devices, the enable flow, test push, icon badge | A push arrives on Tomas's iPhone (installed) and on a Mac browser; a tap opens the right page; signing out stops it |
| **N2** | The remaining *Now* moments: tickets, quotes, action points, blocked-on-you, timesheet returned — with the §4.6 events | Each moment in the catalogue fires once, to the right person, collapsed, inside working hours |
| **N3** | Timer reminders (§4.3) | A clock left on overnight produces exactly one message, in the morning |
| **N4** | Insights through the pipe: raised-for-you, escalation, resolution clears; the morning brief | One brief a day per person; nothing the Inbox does not also show |
| **N5** | *Quiet* tier: comments, finalised notes, projects; Mute | — |
| **G8** | Mail provider decided (N10) | — |
| **N6** | Email: digest for people without push; the three client messages (N11) | — |
| **Review** | Four weeks after N2: open and switch-off rates per category (§4.7) | Tiers adjusted and recorded |

N0 and N1 are most of the work and all of the risk; every later step is a producer and a row in
the catalogue. Estimates are in risk, not days, as elsewhere: the risky parts are the dispatcher
change (it touches every event in production) and the iPhone enable flow (it can only be tested
on a device).

## 6. Out of scope, on purpose

| Not building | Why |
|---|---|
| An activity feed | It would be a list of your own and your colleagues' actions replayed at you. The timeline on each record already does this where it is useful. |
| Notifying the actor | Never useful, always noise (N8). |
| A bell or a second count | The Inbox is the place; the badge is the count (N5). |
| Push for *every* insight | Most are states to deal with this week, not interruptions. They stay in the Inbox, and the morning brief carries them. |
| Push to clients | Clients get email or nothing (N11). |
| SMS, WhatsApp, Slack | No need at four people, and each is a new processor of client data. Teams is the one worth revisiting, through the same Graph decision as G8. |
| Live Activities, lock-screen widgets | Native iOS only; a separate decision about whether a native companion app is worth having. |
| Read receipts, "seen by" | Not the kind of team this is for. |

## 7. What was asked, and the answer

Accepted as recommended on 2026-10-17, all six:

1. **N1/N2** — notifications as delivery of the Inbox, one record per person: agree?
2. **N4** — the three tiers, and the catalogue's assignment of moments to them (§4.2). This is the
   part most worth an opinion: anything you would want *now* that is marked *today*, or the
   reverse.
3. **N7** — working hours default (Mon–Fri 08:30–18:30, Europe/Amsterdam), and no exception for
   anything at night.
4. **N6** — the lock-screen rule: names and titles yes, bodies and amounts never.
5. **N10** — whether to settle G8 next (recommended: Graph `sendMail` from one mailbox).
6. **N11** — clients by email after G8, or not at all.
