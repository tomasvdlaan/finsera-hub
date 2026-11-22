---
title: Choose who sees a report or document
summary: Limit a report or a shared document to some of a client's people, or open it to everyone at the client again.
module: portal
paths: [/clients/:id/access, /clients/:id/portal]
capability: portal.admin
keywords: [visibility, visible to, restrict, only some people, everyone, report, document, who may open, people picker, artefact]
updated: 2026-10-23
---

By default everyone at a client who has a portal login sees every report and shared document of that client. You can limit one report or one document to named people. Invoices and quotes are different: those are switched on or off per person on [their page](help:portal/portal-user-page).

## Where the control is

- For a **report**: the **Visible to** column of the **Custom content** table on the client's **Portal access** tab.
- For a **document**: the **Visible to** column of the **Shared documents** table on the [portal preview](help:portal/preview-a-portal) (**View their portal** on the client's page). A document shows there once it has been shared with the client.
- From the other direction, per person: the **Reports and documents** card on [one portal login](help:portal/portal-user-page).

All of them change the same data.

## Before you start

You need `portal.admin` (administrators only).

## Limit something to some people

1. In the **Visible to** list choose **Only some people**.
2. In the dialog **Who may open this?**, tick the people. People whose access was revoked are shown as "revoked", keep any tick they had, and cannot be newly ticked.
3. Press **Save**. **Save** stays disabled until at least one person is ticked ("Choose at least one person, or share it with everyone at this client").

Nothing is written until **Save**. **Cancel**, Escape or clicking outside leaves everything as it was, even if the list was moved to **Only some people**.

The row then shows who it is limited to: a name if it is one person, otherwise a count, as a link that reopens the dialog.

## Open it to everyone again

Choose **Everyone** in the **Visible to** list. This saves at once, and the earlier choice of people is kept in case you limit it again.

## Good to know

- A report or document can never be stored as limited to nobody; the server refuses it. This stops one from being hidden with no trace on screen of who was meant to have it.
- A limited report or document disappears from the person's lists, and they cannot open it by typing the address either.
- Staff looking at a portal (the preview, or signing in at the client's address with their own account) see everything, including limited items, so the person who limited one can still see it.
- The preview shows all of the client's documents with their visibility, not what one person sees. To check one person's view, look at their ticks on [their page](help:portal/portal-user-page).
- Every change is written to the audit log against the client, with the mode and the people.
- Deleting a report also removes its visibility settings.
