---
title: When a client cannot sign in
summary: What each refusal in the client portal means and what to do about it, from lost links to re-created accounts.
module: portal
paths: []
capability: portal.admin
keywords: [cannot sign in, geen toegang, niet uw portaal, link expired, forgot password, reset, unlink, revoked, troubleshooting, inloggen mislukt, activation]
updated: 2026-10-23
---

When a client rings because they cannot get in, start by asking what the screen says. The portal is in Dutch; this page translates each message and says what to check. Everything below needs `portal.admin` (administrators only) on the client's **Portal access** tab, in **Who can sign in** (see [Invite and manage portal logins](help:portal/portal-logins)).

## What the screen says

| Message | What it means | What to do |
|---|---|---|
| **Geen toegang** — "U bent ingelogd, maar dit account heeft geen toegang tot het klantportaal." | They signed in at the identity provider, but we have no usable invitation for that account: never invited, revoked, or the portal role was never granted. | Check their row on the client. **Restore** if revoked. If there is no row, **Give access**. If the row exists but they still see this, press **Link** or **New link**: that grants the portal role again. |
| "Dit account heeft geen toegang tot dit klantportaal." (on the portal's own page, with **Uitloggen**) | The login is revoked, or this address belongs to another client. | Same as above. |
| **Niet uw portaal** — "…toegang tot een ander klantportaal, niet tot <address>." | Their account is invited to a different client. | Send them to the right address. One account belongs to one client; someone working for two clients needs a second account, with a different email address. |
| **Geen portaal** — "Er is voor u nog geen klantportaal ingericht." | The client has no portal address (it was cleared). | Set the portal address on the client. See [Give a client a portal address](help:crm/client-portal-access). |
| **Portaal niet beschikbaar** — "het klantportaal is op dit moment niet goed ingesteld" | The platform could not check the sign-in at all: a configuration problem, not a permission. | Not something you can fix on the client; tell an administrator. In a development setup the page also shows the technical reason. |
| **Inloggen verlopen** — "Probeer het opnieuw." | The one-time hand-over between addresses expired or came from another browser. | They press **Inloggen** again, in the same browser. |
| **Inloggen mislukt** | The identity provider returned an error or no code. | Try again; if it persists, check the log under **At the identity provider** on [their page](help:portal/portal-user-page). |
| **Link onvolledig** — "Deze activatielink is niet compleet. Vraag ons om een nieuwe." | The link was cut off (often by an email program). | Press **New link** and send it again, preferably with **Kopieer opgemaakte e-mail** or the plain text. |

## Specific cases

**They lost the registration link or it does not work.** Press **Link** (before first sign-in) or **New link**. Only the newest link works; sending a new one invalidates the last.

**They forgot their password.** Press **Reset password** on their row (available once they have activated) and send the link. If they have never activated, the answer is the registration link instead.

**Everything says "no access" although the invitation is right.** If their identity-provider account was deleted and re-created, the login still points at the old account. Press **Unlink** and confirm; the invitation stays and their next sign-in binds to the new account.

**The address was typed wrong.** An address cannot be edited. **Revoke** the wrong row, then invite the right address.

**The same address was invited for two clients.** At the first sign-in the oldest invitation is claimed. The second client's invitation is left unused; use a different address for it.

**Nobody can sign in to a brand-new client.** The client needs a portal address first; the invite form is disabled until it has one.

## Where to look

- The row's status: **active**, **invited, not signed in yet** or **revoked** and **Last seen**.
- Their page: **Sign-ins** shows the sessions that did start, and **At the identity provider** shows failed attempts and password changes the platform itself cannot see.
- If the page that does not load is a report, see [Custom content](help:portal/custom-content): **test** tells you whether the source answers.

## Good to know

- A revoked login cannot receive links until it is restored.
- Ending a single session (**End**) signs one browser out without taking access away.
- Staff never need an invitation: they sign in at the client's address with their own account.
