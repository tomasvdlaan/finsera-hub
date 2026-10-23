---
title: Client portal
summary: What the client portal is, how staff manage it, the pages in this module, and who can do what.
module: portal
paths: []
keywords: [portal, klantportaal, client login, invite, tickets, reports, rapporten, access, zitadel, sign in]
updated: 2026-10-23
---

Every client can have a **portal** of its own at an address that is theirs (for example `duce.finsera.nl`). In it a client sees their projects, the tasks you chose to share, quotes (and can accept them), invoices with their PDFs, shared documents and reports, and a **Tickets** page where they ask for things. The portal is a separate application from this platform, so a client's browser never receives anything internal.

This module is the *staff side*: giving a client's people a login, deciding what each of them sees, adding reports, answering tickets and looking at the portal as the client does. The portal owns logins and nothing else. Everything a client sees belongs to another module and is read through a list of fields that module has declared portal-visible.

## Pages in this module

Give access

- [Give a client a portal address](help:crm/client-portal-access) (in CRM): the address and welcome line. A client needs an address before anyone can be invited.
- [Invite and manage portal logins](help:portal/portal-logins): invite, send a link, reset a password, revoke, restore.
- [One portal login](help:portal/portal-user-page): a person's name, what they see, sign-ins and the identity provider's log.
- [Choose who sees a report or document](help:portal/restrict-who-opens-an-item)
- [Logo and welcome line](help:portal/portal-branding)

Content and conversation

- [Custom content (reports)](help:portal/custom-content): add a report hosted elsewhere to a client's portal, test it, switch it on.
- [Client tickets](help:portal/client-tickets): the inbox of what clients asked, and how to answer, assign, close and turn one into a task.
- [Portal tickets and reports on a client page and in chat](help:portal/portal-cards-and-assistant)

Checking and supporting

- [Preview a client's portal](help:portal/preview-a-portal): the read-only, audited view from the client page.
- [What clients see](help:portal/what-clients-see): every tab of the real portal, in the client's own words, so you can support them.
- [When a client cannot sign in](help:portal/client-cannot-sign-in): what each refusal means.

## Who can do what

| You can | Needs |
|---|---|
| Invite, revoke or restore a login; send links; set what a person sees; add, switch on or off and remove reports; set the logo; preview a portal; assign tickets | `portal.admin` (administrators only) |
| Read tickets, reply, add internal notes, close, reopen and turn into a task | `portal.tickets` (every colleague by default) |

`portal.admin` is the one capability that hands data to someone outside the business, so members do not hold it by default. Answering a question a client already asked is delivery work, so tickets are open to everyone.

## Good to know

- You never email a client from here: invitation and password links are produced for you to send yourself (usually by mail from Outlook), and replies to tickets are shown in the client's portal.
- Everything a client does in the portal that reads data is written to the audit log, and so is everything you do here.
- The assistant can add a report page to a client's portal, switched off. It cannot read a client's words. See [Portal tickets and reports on a client page and in chat](help:portal/portal-cards-and-assistant).
- Clients' messages are shown to you as quotations, never as instructions.
