---
title: A project's page
summary: Change a project's status and dates, read and edit its commercials, and see its team, discussion and timeline.
module: crm
paths: [/projects/:id]
capability: crm.projects.write
keywords: [project detail, project status, on hold, completed, cancelled, rate, budget, retainer, fixed fee, start date, end date, rename project]
updated: 2026-10-23
---

A project's page shows where a piece of work stands and what was agreed for it. Open one from the **Projects** page, from its client's page, or from the assistant.

## Before you start

Viewing needs `crm.projects.read`; changing anything needs `crm.projects.write`. The controls show for everybody, and a refused save shows its reason in red under the commercials.

## What is on the page

- The header: the project name and a link to its client. (The "Projects" back link in the header is currently broken; use the **Projects** item in the rail.)
- A **status** drop-down and a badge with the billing model.
- Editable rows: **Name**, **Starts on**, **Ends on**.
- **Commercials**: what was agreed, and editable fields for it.
- **Team**: see [Decide who works on a project](help:crm/project-team).
- Cards from other modules (hours burned against budget, documents and so on, depending on what is installed).
- **Discussion**, **Links** and **Timeline**, which work as described in [Discussion, timeline and links](help:crm/client-activity).

## Statuses

**Prospective**, **Active**, **On hold**, **Completed**, **Cancelled**. Any status can be changed to any other, and the change is saved when you pick it. A new project starts as Prospective.

## Steps: edit a row

1. Click **Edit** on **Name**, **Starts on** or **Ends on**.
2. Type the value. Dates are typed as `YYYY-MM-DD`.
3. Press Enter or click **Save**; Escape or **Cancel** leaves without saving. Clearing a date and saving removes it.

## Steps: edit commercials

The fields shown depend on the billing model:

| Model | Editable fields |
|---|---|
| Time and materials | **Rate €/hr**, **Budget cap €**, **Budget hours** |
| Fixed fee | **Rate €/hr**, **Agreed price €**, **Budget hours** |
| Retainer | **Retainer €** |

Type the euro amount (comma or point) and save.

## Good to know

- Emptying **Rate €/hr**, **Budget cap €**, **Agreed price €** or **Budget hours** does not remove the stored number: as the system works today, only a new value replaces an old one. A retainer's period cannot be changed here.
- A fixed fee must keep an agreed price and a retainer an amount and period; changes that break this are refused.
- Moving the status records a "status changed" event, which other parts of the platform (timeline, insights) can react to.
- The billing model cannot be changed from the screen.
- There is no archive or delete for a project; use **Completed** or **Cancelled**.
- The portal shows the client only the project's name, status and dates, never the rate or budget.
