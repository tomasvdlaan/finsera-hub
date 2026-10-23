---
title: Add or remove a contact
summary: Record the people you deal with at a client, and take them off when they leave.
module: crm
paths: [/clients/:id]
capability: crm.clients.write
keywords: [contact, person, email, phone, primary contact, role, add contact, remove contact]
updated: 2026-10-23
---

Contacts are the people at a client worth having a name for. They live in the **Contacts** card on the Overview tab of [a client's page](help:crm/client-profile).

## Before you start

You need `crm.clients.write` to add or remove contacts. Anyone with `crm.clients.read` can see them.

## Steps: add a contact

1. On the client's **Overview** tab, click **Add contact** at the top of the **Contacts** card. On an empty card the button says **Add the first contact**.
2. Fill in the dialog: **Name** (required), **Role** (for example finance or operations), **Email**, **Phone**.
3. Click **Add contact**.

The first contact you add to a client is marked **primary**. Contacts added after that are not.

## Steps: remove a contact

1. Click **Remove** at the right of the contact.
2. Confirm **Remove contact** in the dialog.

The contact comes off the client. Anything they were already on keeps their name.

## Good to know

- A contact is not a portal login. Letting somebody sign in to the client's portal is done on the [Portal access tab](help:crm/client-portal-access).
- The screen has no way to change which contact is primary or to edit a contact's details. To correct one, remove it and add it again. Removing the primary contact leaves the client with no primary.
- Removing is permanent from the screen; there is no undo.
- Contacts can be found and mentioned elsewhere in the platform, and always open the client's page.
