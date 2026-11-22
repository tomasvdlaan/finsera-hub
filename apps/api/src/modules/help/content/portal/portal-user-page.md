---
title: One portal login
summary: See and change a client contact's name, which sections and reports they see, their sign-ins, and the identity provider's record.
module: portal
paths: [/portal/users/:id]
capability: portal.admin
keywords: [portal user, sign-in history, sessions, end session, invoices quotes visibility, identity events, failed login, last seen, zitadel]
updated: 2026-10-23
---

Each person invited to a client's portal has a page of their own. Open it by clicking their name in **Who can sign in** on the client's **Portal access** tab, or from a search result or mention. It answers the three things a client rings about: who is this, what can they see, and have they been in.

## Before you start

- You need `portal.admin` (administrators only).
- The page header shows the person's email and whether access is "active", "invited, not signed in yet" or "access revoked". The **Client** link goes back to their client.

## The person

- **Email**, **Invited** and **Last signed in** are read-only. The address cannot be changed: it is what the invitation binds to, and changing it would either strand them or hand their access to whoever holds the new one.
- **Name** is how they are greeted in their portal and how they appear anywhere they are mentioned. Type a new name and click away; it saves.

## What they see

- Tick or untick **Invoices** and **Quotes**. Each is all or nothing: showing half a client's invoices would make the total not add up. A person without **Invoices** has no Facturen tab; without **Quotes**, no Offertes tab.
- Projects, tasks and tickets are shared with everyone at the client. Reports and documents are chosen one by one (next section).

## Reports and documents

The card **Reports and documents** lists everything this client has that can be shared: reports (custom content pages) and documents shared with the client. For each you see its type, "off" if a report is switched off, and "everyone" or the number of people it is limited to. The header counts "N of M" the ones this person can open.

- Tick or untick a row to add or remove this person from something that is already limited to named people. The tick is disabled for items shared with everyone (unticking would mean "everybody except them", which cannot be expressed), and for a revoked login.
- **restrict to some people** (on an item shared with everyone) opens a picker with this person already ticked; **change who** opens it for an item already restricted.
- If this person is the only one named on an item, unticking them is refused with a message: share it with everyone first, because an item limited to nobody can be opened by nobody.

The same decision can be made from the report's or document's side; see [Choose who sees a report or document](help:portal/restrict-who-opens-an-item).

## Sign-ins

A table of the last 50 sessions: **When**, **Browser** (shortened), **From** (IP address) and **Status**: active, ended or expired. A session expires after 12 hours without use, or 30 days at most. For an active session, **End** signs that one browser out. Their access is unchanged and they can sign in again. Use it for a laptop left at a client's office. To take access away altogether use **Revoke** on the client's page (see [Invite and manage portal logins](help:portal/portal-logins)).

## At the identity provider

Our own records only show sign-ins that worked. This card shows what the identity provider (Zitadel) knows: failed attempts, password changes, second factors, with the provider's own event names, when it happened and who did it. It shows the latest 25. It says why when it cannot: "This login has never signed in, so Zitadel has no account for it yet", or that the provider is not configured. The page keeps working when the provider is down.

## Good to know

- Revoking, restoring and issuing links are on the client's page, beside everyone else who can sign in. This page says so at the bottom.
- Changes to name and sections are recorded with before and after, so "when did Bob lose the invoices?" can be answered.
