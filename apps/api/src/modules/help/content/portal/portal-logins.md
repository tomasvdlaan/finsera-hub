---
title: Invite and manage portal logins
summary: Give someone at a client access to the portal, send them the link, reset a password, unlink, revoke and restore.
module: portal
paths: [/clients/:id/access]
capability: portal.admin
keywords: [invite, portal user, give access, registration link, activation, reset password, new link, revoke, restore, unlink, zitadel, client login, who can sign in]
updated: 2026-10-23
---

The **Who can sign in** panel on a client's **Portal access** tab is where you decide which people at the client can use their portal. It also holds the client's logo (see [Logo and welcome line](help:portal/portal-branding)).

## Before you start

- You need `portal.admin` (administrators only). Without it the panel loads empty with a refusal.
- The client needs a **portal address**. Until it has one the form is disabled and the panel says "Set a portal address for this client … before giving anyone access". See [Give a client a portal address](help:crm/client-portal-access).
- The person needs an address at the client. A colleague's address is refused ("is a colleague's account, so it cannot be a client portal login"), because staff can already open any portal under their own account.
- The platform does **not** send mail. It gives you a link and a ready-made message, and you send it.

## Invite someone

1. On the client, open the **Portal access** tab and find **Who can sign in**.
2. Type their address in the first field ("their.name@client.nl").
3. Optionally type their name in **Naam (optioneel)**. It is used for the greeting and in the identity provider.
4. Press **Give access**.
5. A box "Registratielink voor <address>" appears with the link and a draft message (see below). Send it.

The person is listed at once as "invited, not signed in yet". If the identity provider could not be reached or is not configured, the access still exists and a warning explains what is missing; use **Link** later to get a link.

An address that is already listed for that client is refused ("already has access"); one that was revoked is refused with "restore it instead of inviting again".

## Send the link

The box offers three ways to take the message (the message itself is in Dutch, signed from Finsera):

- **Kopieer link** copies the link only, for when you are already writing something.
- **Kopieer opgemaakte e-mail** copies the styled message, ready to paste into Outlook. The subject is shown under **Onderwerp**. If your browser cannot copy rich text it copies plain text instead.
- **Kopieer platte tekst** copies the plain text. If copying is not allowed in your browser, the text is shown in a box to select by hand.
- A preview of the mail is shown in a frame so you can see what the client will see.

The link is **single use and not stored anywhere**. Close the box (**klaar**) only after you have sent the message. If it is lost, press **Link** again; a new link makes the previous one stop working. The link sits on the platform's own portal domain, not the identity provider's, so the mail does not look like phishing to spam filters.

## What the person does

They open the link, choose a password, and sign in at their portal address. The first sign-in with that address binds the invitation to their account. See [What clients see](help:portal/what-clients-see) and [When a client cannot sign in](help:portal/client-cannot-sign-in).

## The list

Each row shows the person (a link to [their page](help:portal/portal-user-page); the address is shown underneath if a different name is set), a status, and when they were **Last seen**.

| Status | Meaning |
|---|---|
| active | Signed in at least once and can still sign in |
| invited, not signed in yet | Invitation written, not used |
| revoked <date> | Access taken away |

Buttons on a row:

- **Link** (for someone who has not signed in) or **New link** (otherwise) issues a fresh registration link. Any link sent earlier stops working.
- **Reset password** (only once they have an account) issues a link to choose a new password, in the same copy-and-send box. Any earlier reset link stops working. It is refused for someone who has never activated.
- **Unlink** (only once they have an account) releases the identity-provider account this login is tied to. The invitation stays, and the next sign-in with that address binds afresh. Use it when the person's account was re-created. You are asked to confirm.
- **Revoke** takes their access away at once, and ends all their open sessions. There is no confirmation. Revoking is recorded.
- **Restore** (on a revoked row) is the only way back. Their earlier choices of which reports they can open are remembered.

## Good to know

- One identity-provider account belongs to one client. Someone who works for two clients needs two accounts, so they can never see both clients at once.
- Changing an address is not possible; the address is what the invitation binds to. Invite the new address and revoke the old one.
- An invitation can also be claimed the old way: someone who already has a verified account at that address can sign in and be matched to the pending invitation.
- Invite, reset password, unlink, revoke and restore are recorded in the audit log against the person, with who did it. Issuing a new registration link to someone already invited is not recorded separately.
