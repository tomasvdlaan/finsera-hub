---
title: Archive a client
summary: Take a client out of lists and pickers while keeping its invoices, quotes and history.
module: crm
paths: [/clients/:id]
capability: crm.clients.write
keywords: [archive, delete client, remove client, lost client, hide client]
updated: 2026-10-23
---

Archiving is how a client is retired. It is not a delete: nothing the client generated is lost.

## Before you start

You need `crm.clients.write`. If the client simply did not buy, set the stage to **Lost** instead (see [stages](help:crm/clients)). That keeps them on the Clients page.

## Steps

1. Open the client.
2. Click **Archive** at the top right.
3. In the dialog "Archive (client name)?", click **Archive client**.

You are taken back to **Clients** and a confirmation appears.

## What it does

- The client disappears from the Clients page and from the pickers when creating new work.
- Invoices, quotes and history are kept.
- The change is written to the audit log.

## Good to know

- There is no restore button in the app. Treat this as irreversible from the screen.
- Projects of an archived client are not archived with it. They still appear on the Projects page, but their client name shows as a dash because the client is no longer in the list.
- Archive is separate from the stage drop-down, and sits apart from it so it is not clicked by accident.
- Contacts have their own [Remove](help:crm/contacts).
