---
title: Find clients and move them through the pipeline
summary: Use the Clients page as a list or a pipeline, add a client, and change which stage a client is at.
module: crm
paths: [/clients]
capability: crm.clients.write
keywords: [client list, add client, new client, lead, prospect, stage, status, pipeline, gone quiet, last meeting, unbilled]
updated: 2026-10-23
---

The **Clients** page shows every client with what is at stake with them. It has two views, **List** and **Pipeline**, switched with the buttons top right.

## Before you start

Reading the page needs `crm.clients.read`. Adding a client and changing a stage need `crm.clients.write`. The page also pulls in projects, quotes, board cards, meetings and unbilled hours from other modules, so some numbers can be empty if you cannot read those.

## The strip at the top

- **Active**: how many clients are at the stage Active.
- **Open pipeline**: the total of quotes that are still draft or sent.
- **Unbilled**: logged work not yet invoiced, summed over all clients' projects.
- **Gone quiet**: only appears when it is above zero. It counts Active clients whose last meeting was more than 21 days ago, or who have never had one.

## Stages

Every client is at one of five stages:

| Stage | Meaning on screen |
|---|---|
| **Lead** | Nothing agreed yet |
| **Proposal** | A quote is out |
| **Active** | Work is happening |
| **Dormant** | Quiet, not closed |
| **Lost** | Did not come off |

Any stage can be changed to any other. There is no required order.

## Steps: add a client

1. At the bottom of the **List** view, type the name in **Add a client** (the box says a name is enough).
2. Press Enter or click **Add**.

The client starts as a **Lead**, with you as owner. Everything else (contacts, billing, website) can be filled in later on [the client's page](help:crm/client-profile).

## Steps: change a stage

1. In the **List** view, use the drop-down in the right-hand column of the client's row, or in the **Pipeline** view use the drop-down at the bottom of the client's card (its options read "Move to Lead", "Move to Proposal" and so on).
2. Pick the new stage. It saves at once and the client moves.

You can also change it on the client's own page, under **About**. A stage change is recorded on the client's timeline.

## Steps: read the list

Each row in **List** shows:

- the client name (click to open) and its projects;
- **Last meeting**: days since the last meeting linked to the client, or "Never". It turns to a warning above 21 days;
- **Unbilled**: the value of unbilled work, or a dash;
- **Open with them**: an open quote and its status, otherwise the number of open board cards and how many are blocked, otherwise "Nothing yet".

Above the rows, the filter buttons (**All**, then one per stage that has clients) narrow the list. The **Pipeline** view shows one column per stage with a card per client, showing only the facts that client has (quoted, unbilled, open cards, "Silent N days").

## Good to know

- "Last meeting" means a meeting, nothing else. Hours logged against a client are not counted as contact.
- There is no search box. Use the stage filters, or ask the assistant to search by name.
- The page loads the first 100 clients by name.
- Cards cannot be dragged in the Pipeline. Use the drop-down.
- Archived clients do not appear. See [Archive a client](help:crm/archive-client).
- Back to [Clients and projects](help:crm/index).
