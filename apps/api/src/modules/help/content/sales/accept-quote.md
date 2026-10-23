---
title: Mark a quote accepted
summary: Record that the client accepted a sent quote, and choose whether a new project is created or the work attaches to an existing one.
module: sales
paths: []
capability: sales.quotes.write
keywords: [accept quote, won, accepted, create project, attach project, deal, akkoord]
updated: 2026-10-23
---

Use this when the client has agreed to a **sent** quote (by email, phone or in person).

## Steps

1. Open the sent quote and click **Mark accepted**.
2. What you see depends on the client's projects:
   - **Client has no other projects:** a dialog **Accept this quote?** says a new project named after the quote is created, carrying the quote's rate and budget. Click **Accept and create project**.
   - **Client has projects:** a dialog **Accept this quote** asks **Attach the work to**. Choose **New project — <quote title>** (the default) or one of the existing projects, then click **Accept quote**.
3. A toast says "Quote accepted". The status becomes **accepted**, and **view the project** appears.

## What happens

- A new project, if chosen, is created with: the quote title as name, status active, the quote's billing model, the quote's hourly rate as the project rate, and the quote total **excluding VAT** as the project budget.
- Choosing an existing project only links the quote to it; the project's rate and budget are not changed.
- A link "became project" is recorded, a `quote.accepted` event is published, and the audit trail records it.

## Good to know

- Needs `sales.quotes.write`. Only sent, undecided quotes can be accepted.
- The decision cannot be undone from the screen.
- The internal accept does not check the validity date: you can accept an expired quote. When a client accepts through the portal, an expired quote is refused and no project is created.
- Accepting does not create an invoice; invoices come from hours ([Create a draft from hours](help:billing/draft-from-hours)).
