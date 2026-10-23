---
title: Apply a rate card rate to a project
summary: Write the rate currently in force for a role onto a project, so future invoice drafts use it.
module: sales
paths: []
capability: sales.contracts.write
keywords: [apply rate, project rate, hourly rate, set project rate, rate card]
updated: 2026-10-23
---

This is the only action on the rate-card page that changes what gets invoiced.

## Steps

1. On [Rate cards](help:sales/rate-cards), find the row with the **current** badge for the role.
2. Click **apply to project**.
3. In **Apply the <role> rate**, choose the **Project**. For a client's card only that client's projects are listed; for house rates all projects are.
4. Click **Apply rate**. A toast confirms "<role> rate applied to <project>".

## What happens

- The project's hourly rate is set to the current rate (as of today) for that role.
- It is recorded in the audit trail with the card, role, rate and date.
- If there are no projects to choose from you get "No projects for this client".

## Good to know

- Needs `sales.contracts.write`. The change is made through [CRM](help:crm/index), so CRM's own rules for editing a project apply too.
- Drafts already created keep their rates. New drafts from hours use the project's rate ([Create a draft from hours](help:billing/draft-from-hours)).
- The project keeps this rate until it is changed again; later rate-card edits do not follow automatically.
- Accepting a quote also sets a project's rate, from the quote's hourly rate ([Mark a quote accepted](help:sales/accept-quote)).
