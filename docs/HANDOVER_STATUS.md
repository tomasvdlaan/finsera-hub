# Handover status

**Written 2026-11-27.** Facts come from: `origin/main` (fetched that day, head `b95223e`, 2026-11-23),
`docs/decision-log.md`, the phase briefs, and notes kept during earlier working sessions (dated below).
Things I could not verify are marked **unverified**. Re-check anything dated before November.
§0–§4 were re-checked read-only on 2026-11-27 in a second session (git, `pnpm live`, code on `origin/main`);
items confirmed there are marked **verified 2026-11-27**.

## 0. Read this first: checkouts and branches (cleaned up 2026-11-27)

- **This handover** (`CLAUDE.md`, `.claude/skills/`, this page, `ARCHITECTURE_DECISIONS.md`) was written
  uncommitted in the stale `Dashboard` checkout and moved to branch `docs/handover` (off `origin/main`).
- **"A portal page becomes a record"** — `portal_page` registry entity (`/portal/pages/:id`,
  `portal.admin`), chat card `portal:page-card`, `PortalPageDetail.tsx`, `PageChatCard.tsx`,
  `ensurePagesRegistered()` boot backfill, `getOne()` — sat uncommitted in that checkout since 2026-10-14.
  It is ported onto branch `feat/portal-pages-as-records` (worktree `../Dashboard-pages`), with the Help
  guides corrected (they already described this screen, and still said pages could not be edited) and its
  decision-log entry. **Not merged, not live** until that branch goes through a PR.
- **The stale `Dashboard` checkout** (`time/entity-picker`, 1 ahead / 43 behind `main`) still holds its
  dirty tree. Everything in it is either ported (above) or an older copy of what `main` already has
  (`mcp.*`, `core.module.ts`, `shell.module.ts` without notifications/agent checks, `EntityPicker.tsx`
  without the client-grouping fix, older manifest/decision-log/runbook/deploy files). Its one commit
  `d014ec4` is `edfdcba` on an older base. Safe to discard once the two branches above are merged.
- **`.claude/worktrees/ui-refinement`** (`feat/notifications`, commit merged) holds a **second unmerged
  feature**, uncommitted since 2026-10-17: two notification settings — *Only during working hours* (off =
  push whenever it happens) and *Things you do yourself* (`ownActions`, push your own acts), with specs.
  The second narrows N-decision "never the actor", so it is a decision, not a rescue. Do not remove that
  worktree until Tomas decides.
- `origin/fix/portal-password-reset` (`e8cd584`) is a duplicate of `645e381` on `main` (identical
  `git patch-id`); safe to delete the remote branch.
- Removed 2026-11-27: worktrees `Dashboard-agent`, `Dashboard-mcp`, `.claude/worktrees/awesome-gagarin-*`
  (clean, merged) and three dead `/private/tmp/…` entries (`git worktree prune`).
- New local branches have **no upstream** on purpose: created off `origin/main`, they would otherwise
  track it and a bare `git push` would target `main`.

## 1. Done and live

`origin/production` equals `origin/main` (0/0 on `rev-list --left-right`), and the health endpoint
reports `status ok`, v340, commit `b95223e`, built 2026-11-23T12:52:44Z — production runs `main`.
**Verified 2026-11-27** (`pnpm live` / `GET /api/core/health`).

| Area | State | Source |
|---|---|---|
| Core (registry, links, events, permissions, audit, manifests) | Live; G0 passed 2026-07-27 | decision-log G0 |
| CRM, Time, SCRUM board, Quotes, Contracts, Invoicing, Reporting, Whiteboard, Insights | Built (each has a brief in `docs/`; day-to-day use not verified) | phase1–6a briefs |
| Invoicing detail (roadmap Phase 5c): VAT treatments `domestic_21`/`reverse_charge`/`outside_eu`, gapless numbering, credit notes, PDF, **UBL 2.1 export**; `billing_send_invoice` is `restricted` | Built (core 2026-07-27). Not built: accounting-package API (Exact etc.), `payment_reminder_draft` tool | `billing/` on `main`, roadmap §5c |
| Documents, now stored in SharePoint (D8) | Built 2026-09-09; indexing is manual | decision-log D8 |
| Meetings: Recall.ai capture, Gemini transcription, attendance-based visibility, proposal ledger | Live; transcription language choice + `MODEL_TRANSCRIBE` shipped 2026-11-22 | G3, 2026-09-12, 2026-10-14 |
| Assistant (chat, tools by manifest, cards in chat) | Live; composer polish merged 2026-10-28 | phase 2 brief, `chat/composer-polish` |
| Client portal v2: per-client hosts, proxied reports, tickets, visible tasks, user management, activation journey | Live; Zitadel console settled 2026-09-14 | phase7–9 briefs, notes |
| Portal custom content: assistant can add (disabled), editable (title, link, source URL, time-out, secret), artefacts carry a signed identity | Live (`b95223e`, 2026-11-23) | decision-log 2026-10-14, git |
| Portal pages as records (`portal_page` registry entity, `/portal/pages/:id`, chat card) | **Not merged, not live** — on branch `feat/portal-pages-as-records` (§0) | branch |
| Tickets: events, `ticket_waiting_on_us` rule, Open/Closed/All scope, owner column, markdown subset | Live | phase 9 brief |
| Notifications N0–N5 (Web Push, tiers, morning brief, timer reminders) | Live since 2026-10-17; production VAPID pair is set | notifications-brief |
| MCP endpoint (`POST /api/mcp`) + `agent` role | Live 2026-10-26 | decision-log 2026-10-25 |
| Paperclip agent platform wired to the hub | Live 2026-10-26; one agent used 7 tools end to end | notes |
| In-app Help (`/help`, ~154 guides) + assistant `help_search`/`help_read` | Live | `docs/help-authoring.md` |
| Phone UI (bottom tabs, More sheet), board sort by priority, project/client picker fixes | Merged to `main` (Oct 2026) | git log |

## 2. Half done / work in progress

1. **Mail (gate G8) is undecided**, and everything that needs outbound mail waits on it: notification email
   channel (N6), client emails (N11), and "a client learns of an answer without revisiting the portal".
   Options costed in `phase9-tickets-brief.md` and `notifications-brief.md` N10; recommendation: Graph
   `sendMail` from one mailbox under an application access policy. Needs Tomas's decision.
2. **Notifications not built:** the *Projects* moments (project membership, sprint start — need CRM/scrum
   events), clients-by-email, anything after G8. People have no time zone / working-hours preferences yet.
3. **Ticket attachments (P6)** scoped, not started. Rich text (P5) is done.
4. **Paperclip leftovers:** no off-box backup of its data and Postgres volume; per-agent budgets; Caddy
   basic-auth password should be rotated (a header appeared in a screenshot); no way to assign a hub task so
   it wakes an agent (ideas: "For Paperclip" column + polling, or an `assignee` filter on `scrum_list_tasks`);
   no hub widget for Paperclip spend; `scrum.tasks.write` deliberately not granted.
5. **Agent scoping is by area, not record**: an agent with `scrum.tasks.read` + `docs.read` sees all tasks and
   all documents. Review what the library holds before widening or adding agents.
6. **Unmerged work** — see §0: `feat/portal-pages-as-records` (ready for a PR) and the notification
   settings in the `ui-refinement` worktree (needs a decision first).
7. **Phase 5c is built** (roadmap calls it *Invoicing*, not accounting): UBL 2.1 export was chosen over a
   package API so the phase was not blocked (phase5 brief, option 3). Still open: an accounting-package API
   (Exact Online / Moneybird / e-Boekhouden — which one is undecided), the `payment_reminder_draft` tool, and
   **gate G2 itself** — the bookkeeper reviewing VAT rules and output before the first send; the decision-log
   gate table still shows G2 *pending*. **Verified 2026-11-27** against `billing/` on `main`.

## 3. Known bugs, gaps and risks

- **CI on `main` has been red since `edfdcba` (2026-11-22)** and both red commits were deployed anyway.
  Cause: one `no-useless-assignment` lint error in `portal-proxy.ts` (`let identity = null`). Lint runs
  first, so **the test suite did not run in CI for `edfdcba` or `b95223e`**. Fixed on
  `feat/portal-pages-as-records`. Check `gh run list --branch main` before trusting "merged = tested".
- **Flaky test:** `portal-tickets.service.spec.ts` "orders a client's own list by what happened last" failed
  once in about four full runs (2026-09-09). `ORDER BY last_activity_at DESC` has no tiebreaker. Not known to be fixed.
- **Zitadel admin token 403** (`AUTH-5mWD2`) on `/admin/v1/events/_search` (2026-09-09): the "at the identity
  provider" panel on a portal login shows a sentence instead of failed sign-ins. Needs an instance-level role
  that includes events (IAM Owner Viewer / IAM Owner) in the Zitadel console — only Tomas can set it. Status since: **unverified**.
- **G6:** `PORTAL_ROLE_CHECK=off` was a temporary relaxation (2026-07-29) with an expiry. Code on `main`
  (verified 2026-11-27): opt-out only by exact value `'off'` (`portal-identity.service.ts:89`), a warning on
  every boot, `deploy/.env.example` ships it blank with "Leave UNSET", `docker-compose.yml` passes it through.
  Whether production `.env` still has `off` is **unverified** — server-only; the boot-log warning answers it
  without opening `.env`. Lifting it also needs Zitadel to emit role claims for the portal project.
- **Decision-log gate table is stale**: it still shows G1, G2, G4 as pending although G4's portal is live and
  G3 passed. Open items O2, O4–O8 in that table are not maintained either (O4 is settled by G4).
- **O8 (DPA / client communication on AI processing)** and written confirmation of Gemini paid-tier terms
  against Finsera's client DPAs are recorded as still to do; status **unverified**.
- **Backups:** up to 24 h data loss (nightly dumps, no WAL archiving); document bytes in SharePoint are not
  verified by the restore drill; backups sit on the same disk as production unless `offsite.sh` is configured.
- **Two permission systems for documents** (platform `docs.*` vs SharePoint membership) — accepted in D8.
- **Parallel sessions** have caused: shared test DB corruption, migration-order skips, both sessions
  committing to `production`. Keep one writer per branch; see CLAUDE.md pitfalls.
- Chrome for notification testing: the in-app browser denies the permission; use Chrome/Safari or the iPhone Home Screen app.

## 4. Next planned tasks (in the order the documents imply)

1. **Finish the cleanup** (§0): PRs for `docs/handover` and `feat/portal-pages-as-records` (the latter
   also turns CI green again); decide on the `ui-refinement` notification settings; then discard the
   stale `Dashboard` tree and move that checkout onto `main`.
2. **Decide G8** (mail provider) → then N6: notification email, then client emails (Dutch, three messages).
3. Verify the server/console-only facts still **unverified** above: `PORTAL_ROLE_CHECK` in production,
   Zitadel role claims for the portal project, Zitadel events role (`AUTH-5mWD2`), `offsite.sh` configured,
   Paperclip backup + Caddy password rotation. (Health/commit verified 2026-11-27.)
4. Paperclip hardening: off-box backup, rotate the Caddy password, decide on an `assignee`/"For Paperclip"
   wake mechanism, then consider granting `scrum.tasks.write`.
5. Update the decision-log gate table and open-decision table so they match reality.
6. Fix the `last_activity_at` tiebreaker and re-run the full suite on an isolated DB to confirm the flake.
7. Ticket attachments (P6); notification *Projects* moments once CRM/scrum publish the events.
8. G2: have the bookkeeper review VAT rules and the UBL output, pick the accounting package; only then
   decide whether a package API is worth building on top of the UBL export.

## 5. Operating facts a new person needs

- **Deploy:** see `.claude/skills/deploy/SKILL.md` and `docs/deploy-runbook.md`. Server access is by a
  dedicated SSH key held by Tomas; this repo contains no credentials.
- **Production env** lives only on the server in `deploy/.env` (gitignored via `deploy/.env*`); the variable
  catalogue is `deploy/.env.example`. Changes to env only need `docker compose … up -d api` on the server
  (the deploy script no-ops when the commit has not moved).
- **Zitadel apps:** internal app (client id in `ZITADEL_CLIENT_ID`) and portal app (`ZITADEL_PORTAL_CLIENT_ID`);
  both in one project, Auth Token Type must stay JWT. Portal console URIs are exact-match; see
  `docs/deploy-runbook.md` §9.
- **Permissions for `gh`:** the default `gh` account is read-only on the repo; creating PRs needs Tomas's
  OK to switch accounts (and switch back after).
- **Where truth lives:** `docs/decision-log.md` (why), `docs/phase*-brief.md` (what each phase built),
  `docs/deploy-runbook.md` (ops), manifests (what exists), `apps/api/src/modules/help/content` (user guides).
