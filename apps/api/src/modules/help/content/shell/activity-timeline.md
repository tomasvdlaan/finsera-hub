---
title: Activity and history
summary: See what has happened to a record and to anything linked to it, and ask the assistant what happened in a period.
module: shell
paths: []
capability: core.activity.read
keywords: [timeline, history, activity log, audit, what changed, who did, what happened, activity_recent, since, last week, events]
updated: 2026-10-23
---

The platform keeps a log of changes: a card moved, an invoice issued, a note written, hours logged. You can read it per record, per person, or over a period.

## Where to see it

- **On a record.** Cards, projects, clients, sprints, quotes, contracts, invoices and meeting notes have a **Timeline** section: newest first, each line with what happened (the event name, for example `task.completed`), the record it concerns, who did it and when. It includes events on records linked to this one. A person from outside, such as a client using the portal, is named as such rather than as "system".
- **On a colleague's page.** **What they did** lists every change they made in the period. See [One colleague's page](help:shell/person-page).
- **Through the assistant.** Ask "what happened this week?", "what did Galang do yesterday?", "has anything moved on the CRM side?" or "what is the story on this invoice?". The assistant reads the activity log for these (its `activity_recent` and `activity_for` abilities) rather than reconstructing a story from current state. See [The assistant](help:shell/assistant).

## Steps

### Ask about a period
1. Open the assistant.
2. Ask with a time in it: "what changed on the board since Monday?".
3. Narrow it by person, kind of record or event if you want.

### See one record's story
1. Open the record and scroll to **Timeline**. With nothing yet it says "No activity yet."

## Who can do this

The assistant's activity abilities need `core.activity.read`, which every member holds. The log can never show more than you could open yourself: each row is filtered by what you may see, so a timeline can only reorder what you could already reach. For example, hours logged by colleagues are not shown to a member.

## Good to know

- The timeline shows up to 50 entries on a record. The assistant returns up to 200 for a period.
- **The log covers changes to records**, not reading or searching.
- An event about a record that has since been deleted still shows, marked as deleted.
- Comments are logged too, but their text is not in the timeline; see [Comments and mentions](help:shell/comments).
