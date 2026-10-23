---
title: A client's page
summary: What is on a client's page, its four tabs, and how to edit the client's name, website, notes and stage.
module: crm
paths: [/clients/:id]
capability: crm.clients.write
keywords: [client detail, edit client, 360, overview, notes, website, rename client, status, owner]
updated: 2026-10-23
---

Open a client from the **Clients** page, from a search, or from a link in the assistant. The page is split into four tabs, each with its own address so you can send a colleague straight to one.

## Before you start

Viewing needs `crm.clients.read`; changing anything on the page needs `crm.clients.write`. The edit controls show for everybody, but without the capability a save is refused.

## The header

- The client's name, with the portal address underneath (a link if one is set, otherwise a note that none exists yet).
- The stage, the website (a link), and counts of contacts and projects.
- **View their portal** opens a read-only preview of exactly what this client sees in their portal. See [the portal guides](help:portal/index).
- **Archive**, which has [its own page](help:crm/archive-client).
- The back link to **Clients**.

## The tabs

| Tab | Address | What is in it |
|---|---|---|
| **Overview** | `/clients/:id` | About, Contacts, Projects, and cards from other modules |
| **Billing** | `/clients/:id/billing` | [Billing and VAT details](help:crm/client-billing) |
| **Portal access** | `/clients/:id/access` | [Portal address, users and pages](help:crm/client-portal-access) |
| **Activity** | `/clients/:id/activity` | [Discussion, timeline and links](help:crm/client-activity) |

## Steps: edit a field

On the Overview tab, **About** lists **Status**, **Name**, **Website** and **Notes**.

1. Hover or focus the row and click **Edit** at its right.
2. Type the new value. For single-line fields press Enter to save. For **Notes** Enter makes a new line, so click **Save**.
3. Press Escape or click **Cancel** to leave without saving.

Clearing a field and saving removes the value (it shows a dash). A client always needs a name.

**Status** is a drop-down that saves the moment you choose. See [the stages](help:crm/clients).

## Steps: read the Overview tab

- **Contacts**: people at the client. See [contacts](help:crm/contacts).
- **Projects**: a table with name (link), status, billing model and budget. Projects are created from the [Projects page](help:crm/projects), not here.
- Further cards appear below, supplied by other modules, for example the client's documents with an **upload a document here** link. See [Documents](help:docs/index).

## Good to know

- Renaming a client also updates how it appears everywhere else (search, links, assistant cards).
- Every change is written to the audit log.
- If a save fails (for example a refused portal address), the field may simply stay open; the reason is not always shown on this page. Check the [portal address rules](help:crm/client-portal-access) or your capabilities.
- Owner is set to whoever created the client; there is no screen to change it.
