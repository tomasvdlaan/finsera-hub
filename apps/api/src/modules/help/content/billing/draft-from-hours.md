---
title: Create an invoice draft from hours
summary: Turn the unbilled, billable hours on a project into a draft invoice you can review and edit.
module: billing
paths: []
capability: billing.write
keywords: [draft, hours, unbilled, new invoice, create invoice, bill project, timesheet]
updated: 2026-10-23
---

This is how invoices start. The platform collects the billable hours on one project that no invoice has claimed yet and writes them into a **draft**. Nothing is sent or numbered; you review the draft first.

## Before you start

- You need `billing.write`.
- The project needs an **hourly rate**. Without one you get "The project has no hourly rate — set one before invoicing". Set it on the project in [CRM](help:crm/index), or apply it from a [rate card](help:sales/apply-rate-to-project).
- There must be unbilled hours: logged, marked billable, with a duration (a timer still running does not count). Otherwise you get "No unbilled hours on this project".
- Hours from a week that is waiting for approval, or was sent back, are left out until that week is approved. Weeks that were never submitted are not blocked.

## Steps

1. Go to **Money → Invoices**.
2. In the second dropdown (which reads **Draft from hours…**) pick the project. All projects are listed, for every client.
3. Click **Create draft**. The button reads **Drafting…** while it works.
4. The new draft appears at the top of the list as **Draft invoice**. The page does not jump to it; click it to open it.

## What the draft contains

- One line per person: **Consultancy — <person's name>**, quantity = that person's total minutes divided by 60 (two decimals), unit price = the project rate.
- The client's VAT treatment as it is on the client *right now*. It is copied onto the draft, so changing the client later does not change this draft.
- A link between the invoice, the client and the project.
- The hours it bills are **claimed** by the draft: they will not appear in a second draft.

## Good to know

- Review before issuing: check the lines, descriptions and hours. See [Edit the lines of a draft](help:billing/edit-draft-invoice).
- If you void the draft, the hours go back to billable. See [Void a draft](help:billing/void-draft).
- You can also ask the assistant to draft an invoice for a project; it produces the same kind of draft and cannot issue it.
- Creating a draft is recorded in the audit trail.
