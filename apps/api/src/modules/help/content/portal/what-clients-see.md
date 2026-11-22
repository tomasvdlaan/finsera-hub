---
title: What clients see
summary: Every tab of the real client portal, in the client's own (Dutch) words, so you can support a client who rings you.
module: portal
paths: []
keywords: [client portal, klantportaal, overzicht, offertes, facturen, taken, documenten, rapporten, tickets, accept quote, support, staff view]
updated: 2026-10-23
---

The client portal is a separate website for clients, at the client's own address (for example `duce.finsera.nl`). It is **in Dutch**. This page lists what a client finds there so you can answer "I cannot see my invoice" without guessing.

## Signing in and out

The client presses **Inloggen**, signs in at the identity provider, and lands on their own portal. A person whose account belongs to another client is told "Niet uw portaal"; someone with no invitation is told "Geen toegang". See [When a client cannot sign in](help:portal/client-cannot-sign-in). **uitloggen** at the top ends their session here and at the identity provider.

A session ends after 12 hours without use, or after 30 days at most.

## The tabs

A tab exists only when there is something behind it. An empty **Offertes** tab would read as neglect, so it is not shown. **Tickets** is always there.

| Tab | What is in it |
|---|---|
| **Overzicht** | A greeting ("Welkom, <first name>") and your welcome line; **Wacht op u** (quotes to review that have not expired, overdue invoices, tickets waiting on the client); **Rapportages**; **Nieuw sinds uw vorige bezoek** (invoices issued since their last visit, never shown on a first visit); **Loopt nu** (active and paused projects); **Uw contactpersoon** (the client's owner, with an email link). |
| **Projecten** | Project, status (Loopt, Gepauzeerd, Afgerond, Geannuleerd), start and end date. No budget, rates or margin. |
| **Taken** | Only cards you ticked as visible to the client (see [Show a card to the client](help:scrum/client-visibility)), grouped by project, with kind (Werk, Herstel, Onderhoud, Onderzoek), planned date and status or completion date. No description, owner or estimate. |
| **Offertes** | Quotes that were sent, accepted or rejected (never drafts). Clicking the number shows its lines. Status: Ter beoordeling, Geaccepteerd, Afgewezen, Verlopen. |
| **Facturen** | Issued and paid invoices (never drafts) with date, due date, amount, status (Openstaand, Vervallen, Voldaan) and a **PDF** button. |
| **Documenten** | Documents shared with the client, with **Downloaden**. |
| **Rapporten** | The custom content you switched on for them (see [Custom content](help:portal/custom-content)). |
| **Tickets** | Their questions to you. |

What each person sees is trimmed by their own settings: **Invoices** and **Quotes** can be off for a person, and reports and documents can be limited to named people. See [One portal login](help:portal/portal-user-page).

## What a client can do

- **Accept a quote.** On **Offertes**, an open, unexpired quote has **Accepteren**. The client confirms with "Akkoord met <amount> voor <title>?" and **Ja, accepteren**. The quote becomes accepted and the acceptance is recorded with who clicked. Until a project is created from it, the Inbox raises "<client> accepted quote …" for Sales (see [What the checks look for](help:insights/insight-rules)). There is no button to reject a quote. The server also refuses a quote that is expired or already decided.
- **Open a ticket.** On **Tickets**, **Onderwerp** (up to 200 characters), **Uw bericht** (up to 5,000, with a bar for bold, italic, code, link and list), optionally a **Project**, then **Versturen**. It appears as **Bij Finsera**. Replies to it are in the thread; when we answered, it shows **Wacht op u**. A closed ticket (**Afgerond**) cannot be replied to: "Open gerust een nieuw ticket." More than ten messages in an hour from one client is refused until later. See [Client tickets](help:portal/client-tickets).
- **Download** invoice PDFs and shared documents.

Nothing else is editable. Clients cannot change projects, tasks or their own details.

## When you look at their portal yourself

Any colleague can sign in at a client's address with their own account (not on the bare login address, which belongs to nobody and tells you to open a client's portal from the client page). You see everything, including items limited to some people, and a bar says (in Dutch) that you are looking as a staff member and that the client's actions are switched off: no **Accepteren**, no ticket form. Everything you read is recorded under your name. For a lighter check without signing in, use [Preview a client's portal](help:portal/preview-a-portal).

## Good to know

- Everything in the portal is a read of data owned by other modules, restricted to fields they declared portal-visible. If a field is not shown, it is not available to clients.
- Every read by a client is written to the audit log.
- If a client says a tab is missing, there is probably nothing behind it, or that person's access to it is switched off.
