---
title: Preview a client's portal
summary: Check what a client sees of their projects, quotes, invoices and documents, read-only, before and after sharing something.
module: portal
paths: [/clients/:id/portal]
capability: portal.admin
keywords: [preview, view their portal, what the client sees, check portal, audit, shared documents, read-only]
updated: 2026-10-23
---

**View their portal** on a client's page opens a read-only picture of what that client would see. It is served by the same code the real portal uses, so it cannot show something the client would not get.

## Before you start

- You need `portal.admin` (administrators only). Without it each part refuses to load.
- The client must exist; for a client the platform cannot find you see "No such client".

## Steps

1. Open the client's page and press **View their portal** (top right).
2. Read the **Preview** notice at the top: "This is the client's own view of the portal, read-only. Opening it is recorded in the audit log against this client."
3. Look at the tables. Each only appears if it has rows:
   - **Projects**: **Project**, **Status**, **Start**, **End**.
   - **Quotes**: **Number**, **Title**, **Valid until**, **Amount**, **Status** (an unanswered quote past its date shows "expired").
   - **Invoices**: **Number**, **Date**, **Due**, **Amount**, **Status** (paid, overdue, or open).
   - **Shared documents**: **Document**, **Shared**, and **Visible to**, where you can limit a document to some of the client's people. See [Choose who sees a report or document](help:portal/restrict-who-opens-an-item).
4. If nothing is shared at all you see: "This client would see an empty portal. Nothing is shared with them yet: no issued invoices, no sent quotes, and no documents explicitly shared."

**Back to client** returns to the client's page.

## What it shows and what it does not

- Quotes shown are the ones sent, accepted or rejected; invoices are issued or paid ones. Drafts never reach a client, so they are not shown.
- Documents shown are only those explicitly shared with the client.
- The preview is **one picture for the whole client**. It does not apply a person's own choices, so it shows invoices and quotes even for a login that has them switched off, and every report and document even if limited. To see what one person is allowed, look at [their page](help:portal/portal-user-page).
- It does not include tasks shared with the client, reports, tickets, or the front page. For the full thing, sign in at the client's own address with your own account (see [What clients see](help:portal/what-clients-see)).

## Good to know

- **Every load is written to the audit log** against the client, naming you and what was read. This is on purpose; the notice says so.
- Nothing here can be changed except the **Visible to** setting on a document.
- It never shows the internal reasons: no rates, budget, margin, or a task's description or owner.
