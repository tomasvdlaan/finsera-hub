---
title: Create and find projects
summary: Add a project for a client with the right billing model, and filter the project list by status.
module: crm
paths: [/projects]
capability: crm.projects.write
keywords: [new project, add project, billing model, time and materials, fixed fee, retainer, budget, rate, engagement, project list]
updated: 2026-10-23
---

The **Projects** page lists every project and is where new ones are created. The billing model is chosen per project: time and materials, fixed fee or retainer.

## Before you start

- Viewing needs `crm.projects.read`; creating needs `crm.projects.write`.
- The project needs a client. If there are no clients yet, add one on [Clients](help:crm/clients) first. **Add project** stays disabled until a name and client are chosen.

## Steps: create a project

1. At the top, type the **Project name** and pick the **Client** (the first client is preselected) and the **Billing model**.
2. Fill in the fields that appear for that model:
   - **Time and materials**: **Rate €/hr**, **Budget hours**, and optionally **Budget cap €**.
   - **Fixed fee**: **Agreed price €** (required).
   - **Retainer**: **Amount €** (required) and **Period** (monthly, quarterly or annual).
3. Click **Add project**.

Amounts can be typed with a comma or a point (`1500,50`). The new project starts with the status **Prospective** and you as owner. The form clears and the project appears in the list.

## Steps: find a project

- Use the **Filter by status** drop-down: **All statuses**, **Prospective**, **Active**, **On hold**, **Completed**, **Cancelled**.
- Each row shows the name (link), a badge for the billing model, the client, the status, and the retainer amount per period or the budget. On the right, small faces show who is on it (the first three, then "+N"), or "nobody yet".

## Good to know

- A fixed fee without an agreed price, or a retainer without both amount and period, is refused with a message above the list.
- A number that cannot be read (letters, for example) is treated as empty, so check the refusal message if a required amount seems ignored.
- Rate and budget hours are optional on time and materials; leaving them out is allowed.
- The list shows the first 100 projects by name.
- Projects are not archived or deleted from the screen. To end one, set it to **Completed** or **Cancelled** on [its page](help:crm/project-detail).
- The billing model cannot be changed after creation from the screen.
- Without `crm.projects.write` you still see the form, but adding is refused with a "Missing capability" message.
