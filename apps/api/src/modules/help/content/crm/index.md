---
title: Clients and projects
summary: What the Clients and Projects pages are for, who can do what, and where each task is explained.
module: crm
paths: []
keywords: [crm, customers, prospects, pipeline, engagements, accounts]
updated: 2026-10-23
---

Clients is the platform's master list of who Finsera works for, from first conversation to finished engagement. A prospect and a customer are the same record at different stages. Projects hang off a client and carry the billing model that time, billing and reporting use later.

Both pages sit together in the rail under **Clients** and **Projects**, and each has a switch at the top to jump to the other.

## The pages

| Page | What it is for | Guide |
|---|---|---|
| **Clients** (`/clients`) | List or pipeline of every client, change a client's stage, add one | [Find clients and move them through the pipeline](help:crm/clients) |
| A client (`/clients/:id`) | Everything about one client, in four tabs | [A client's page](help:crm/client-profile) |
| **Projects** (`/projects`) | Every project with its billing model, budget and team | [Create and find projects](help:crm/projects) |
| A project (`/projects/:id`) | Status, dates, commercials, team, discussion | [A project's page](help:crm/project-detail) |

## Tasks

- [Add a client](help:crm/clients) and [change its stage](help:crm/clients)
- [Edit a client's details and notes](help:crm/client-profile)
- [Add or remove a contact](help:crm/contacts)
- [Fill in billing and VAT details](help:crm/client-billing)
- [Give a client a portal address](help:crm/client-portal-access)
- [Discussion, links and timeline on a client](help:crm/client-activity)
- [Archive a client](help:crm/archive-client)
- [Create a project](help:crm/projects) and [edit its commercials](help:crm/project-detail)
- [Decide who works on a project](help:crm/project-team)

## Who can do what

| You want to | You need |
|---|---|
| See clients and contacts | `crm.clients.read` |
| Create or edit clients and contacts, change stage, archive a client | `crm.clients.write` |
| See projects and who is on them | `crm.projects.read` |
| Create or edit projects, change project status | `crm.projects.write` |
| Put people on a project, make someone lead, take someone off | `crm.projects.assign` (administrators only) |

The buttons and fields are shown even if you lack the capability for them, apart from the project team controls, which are hidden unless you can assign. Saving without the capability is refused with a "Missing capability" message.

## The assistant

The assistant can search clients, give an overview of one client (details, contacts and projects), and list projects. It can also create a new lead (a client with the stage **Lead**) and create a project for a client. Those two are classed as draft writes, and anything the assistant creates is marked as assistant-initiated in the audit log. It cannot edit or archive clients and projects, and it cannot change who is on a project.

## Good to know

- Money is stored in whole euro cents and shown in euros.
- Client and project pages also show cards contributed by other modules (documents, quotes, hours and so on), depending on what is installed and what you may read.
- Clients and projects are never deleted from the screen. Clients can be archived; projects are ended by setting their status to **Completed** or **Cancelled**.
- A hidden internal client and project ("Finsera" / "Internal") may be created automatically the first time somebody records internal work. They do not count in reporting.
- The portal side of a client (address, who may sign in, what they see) is covered in the [portal guides](help:portal/index).
