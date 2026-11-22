---
title: Portal tickets and reports on a client page and in chat
summary: The Tickets card on a client's page, the card the assistant shows for a report, and asking the assistant to add a report to a client's portal.
module: portal
paths: []
capability: portal.admin
keywords: [assistant, add page, report card, tickets card, client page, chat, portal_add_page, timeline, events]
updated: 2026-10-23
---

The portal module shows up in three smaller places besides its own screens: a card on every client's page, a card in assistant answers, and one assistant action.

## The Tickets card on a client's page

On a client's page, a **Tickets** card lists that client's open tickets: the subject (a link to the conversation in [Client tickets](help:portal/client-tickets)), the status ("waiting on us", "waiting on them"), the date of the last activity and, after two days waiting on us, the number of days. Empty: "No open tickets." The card only appears for people with `portal.tickets`; if the list cannot be read it says "Tickets are not available to you."

## The report card in chat

When the assistant cites a custom content page (for example right after adding one), it shows a card: a "report" badge, the title, the client and the address (or "no portal address"), and "redirect" for a redirecting page. A **not visible yet** badge appears while the page is switched off. Two links: **open** (the client's own view of it, in a new tab) and **custom content** (the panel on the client's **Portal access** tab where the switch is). The card is shown only to people allowed to see portal pages.

## Ask the assistant to add a report

With `portal.admin`, ask the assistant in chat, for example "add the Q3 report at https://… to DocHorse's portal as rapportage-q3". It will look the client up first, then add a page.

- The page is created **switched off**. The assistant's answer says "Not visible to <client> yet. Turn it on under Custom content on their page in hub." A person has to press **enable**. See [Custom content](help:portal/custom-content).
- You give a **slug** (the short address, such as `rapportage-q3`), a **title** (what the client sees in Rapporten), the **source URL**, and optionally whether to serve it here (proxy, the default) or redirect.
- The same rules as the form apply: the client must have a portal address, the address must not be one the portal already uses, the source must be https and public.
- **Do not give the assistant a Vercel bypass secret.** It is typed on the page's own form, never in a conversation. A page added by the assistant has no secret, so if the source is protected, add the secret by removing and re-adding the page on the screen, or make the source reachable.
- The assistant can only add. It cannot switch a page on, change it, remove it, invite someone, or read what a client wrote in a ticket. That last limit is deliberate: nothing a client typed should ever be read by the assistant as if we had written it.

## What shows on a client's timeline

Three portal events land on the client's timeline (see [the timeline](help:shell/activity-timeline)): somebody **opened the portal** (the client, or one of us looking); a client **opened a ticket** (with its subject); and a client **replied** on a ticket. Our own replies are not events.

## Good to know

- Reporting has a ticket view with status, days waiting, who opened it and who owns it, and no message text.
- Adding a page, by hand or through the assistant, is written to the audit log against the client.
