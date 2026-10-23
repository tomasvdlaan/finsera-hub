---
title: Glossary
summary: The platform's own vocabulary - entity, capability, widget, card, sprint, rate card, artefact, portal user and more - in a line or two each.
module: shell
paths: []
keywords: [glossary, terms, definitions, vocabulary, what does mean, jargon, words, entity, capability, widget, sprint, rate card, artefact, insight, manifest, flow]
updated: 2026-10-23
---

## Platform words

- **Entity** - any record that has a name and an address in the platform: a client, a project, a card, a document, an invoice, a meeting note. Because every one is registered in the same place, the [command bar](help:shell/command-bar) can find all of them, and comments, links and history work on all of them.
- **Module** - a self-contained area of the platform, such as Clients, Time or Meetings. The pages outside the modules are the shell. See [The platform itself](help:shell/index).
- **Manifest** - the declaration each module makes of what it contains: its record types, pages, permissions, events, dashboard widgets and assistant abilities. [Platform modules](help:shell/platform-modules) and Help's Reference section are generated from them.
- **Capability** - one named permission, such as `billing.issue`. See [Roles and permissions](help:shell/roles-and-permissions).
- **Administrator-only** - a capability that members do not hold by default. Only administrators have it.
- **Role** - **Member** or **Administrator**.
- **Department** - a label that decides whose inbox work is sent to. Not a permission. See [Departments](help:shell/departments).
- **Hub** - a page that gathers related pages behind a strip of tabs, such as **All work** and **Money**.
- **Widget** - a block you can put on [Today](help:shell/today), or a block that appears on a record's page. Each module contributes its own.
- **Placement** - one widget on your dashboard, with its own size and settings. The same widget can be placed twice.
- **Starter layout** - the dashboard you have until you change it.
- **Command bar** - the **⌘K** box.
- **Event** - a record of something that happened ("task completed", "invoice sent"). Events feed the timelines and the assistant's answers about what happened.
- **Timeline** - the list of events on one record. See [Activity and history](help:shell/activity-timeline).
- **Link** - a connection between two records. See [Links between records](help:shell/links).
- **Mention** - naming a colleague with **@** in a comment, which lands in their Inbox. See [Comments and mentions](help:shell/comments).
- **Build** - the version number and commit of the platform you are running, shown at the foot of **Organisation**.

## The assistant

- **Assistant** - the AI helper behind **✦**. See [The assistant](help:shell/assistant).
- **Tool / ability** - one thing the assistant can do, such as "list invoices". Each module declares its own.
- **Risk class** - how careful the platform is with an ability: `read`, `write:draft`, `write:commit` or `restricted`. See [What the assistant can and cannot do](help:shell/assistant-limits).
- **Card (in an answer)** - a record the assistant shows inline so you can open it. Not to be confused with a board card.
- **Saved answer** - an answer you starred. See [Saved answers](help:shell/assistant-saved-answers).

## Work and money words

- **Client** and **project** - who we work for, and the engagements under each client. See [Clients and projects](help:crm/index).
- **Card** (or **task**) - a unit of work on a project's **board**. See [The board](help:scrum/index).
- **Board** - a project's columns of cards. **Flow** is the view of how long work takes and where it waits.
- **Sprint** - a time-boxed run of work on a project, with planned start and end dates.
- **Waiting (on a client)** - a card that is stuck with somebody outside the business. Shown on **All work** and **Today**.
- **Blocked** - a card with a stated reason it cannot move.
- **Time entry** and **timesheet** - a block of logged hours, and a week of them that can be submitted and approved. See [Time](help:time/index).
- **Quote**, **contract**, **invoice** - the commercial documents. See [Sales](help:sales/index) and [Invoicing](help:billing/index).
- **Rate card** - what an hour costs, and since when. Applying a rate to a project is a separate, deliberate step. See [Sales](help:sales/index).
- **Draft** - a quote or invoice that exists but has not been issued or sent.
- **Credit note** - an invoice with a negative amount that reverses part of an earlier invoice.
- **Insight** - something the platform noticed and nobody has dealt with: an overdue invoice, an unanswered quote, a stuck card. These fill the **Inbox**. See [Inbox](help:insights/index).
- **Action point** - something agreed in a meeting. An assistant proposal stays "proposed" until you accept it, and then becomes a card. See [Meetings](help:meetings/index).
- **Stand-up** - the daily meeting template the command bar can start for you.

## Client portal words

- **Portal** - the area clients sign in to, at their own address. See [The client portal](help:portal/index).
- **Portal user** - a client's login to the portal. It is a record in its own right, with its own page and sign-in history. Only administrators can invite or revoke one.
- **Artefact** - something shared with a client in the portal: a document or a custom page. Each can be visible to everyone at that client or only to chosen people.
- **Client tickets** - requests clients open from the portal.
