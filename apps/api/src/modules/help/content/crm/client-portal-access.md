---
title: Give a client a portal address
summary: Set the client's own portal address and welcome line from the Portal access tab.
module: crm
paths: [/clients/:id/access]
capability: crm.clients.write
keywords: [portal, portal address, slug, subdomain, welcome line, client login, invite, portal access]
updated: 2026-10-23
---

Each client can have a portal of its own at a name that is theirs: the address `duce` becomes `duce.finsera.nl`. The address is set on the **Portal access** tab of [a client's page](help:crm/client-profile).

## Before you start

You need `crm.clients.write` to set the address and welcome line. The panels below them (who may sign in, and which pages the client sees) belong to the portal module and are explained in the [portal guides](help:portal/index).

## Steps: set the address

1. Open the client and click the **Portal access** tab.
2. In **Their address**, click **Edit** next to **Portal address**.
3. Type the short name, for example `duce`, and press Enter or **Save**.

Once an address exists, a **Welcome line** row appears. Edit it the same way: it is one sentence from you that the client sees on the front page of their portal.

To remove the address, clear the field and save.

## The rules for an address

- 2 to 40 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit.
- Capitals are lowercased for you.
- Names the platform itself uses are refused: hub, www, portal, api, app, mail, smtp, imap, admin, auth, login, static, cdn, status, dev, test, staging, finsera.
- Each address can belong to one client. If it is taken the refusal names the client that has it.

## Good to know

- A client with no address cannot be invited to sign in. The portal refuses, because a login with nowhere to go is a support ticket.
- Changing the address breaks links the client already has (the page says so).
- The header of the client's page shows the address as a link once it is set.
- A refused address (taken, reserved, wrong shape) may not show its message on this tab. If the field will not take, check the rules above.
