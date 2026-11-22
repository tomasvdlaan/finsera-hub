---
title: Invoice list
summary: Find and filter invoices, see what is outstanding, and read the badges.
module: billing
paths: [/money/invoices]
capability: billing.read
keywords: [invoices, list, outstanding, overdue, filter, status, factuur, client page]
updated: 2026-10-23
---

**Money → Invoices** lists every invoice and credit note, newest first, with a summary line of what is outstanding.

## Steps

1. Open **Money** in the top bar and choose the **Invoices** tab.
2. Read the line at the top (only shown when something is issued and unpaid): the total **outstanding** across N invoices, with "some overdue" when any is past its due date.
3. Use the **Status** dropdown to show **All statuses**, **draft**, **issued** or **paid**.
4. Click an invoice number to open [the invoice page](help:billing/invoice-page). Drafts have no number yet, so they read **Draft invoice** or **Draft credit note**.

## What each row shows

The number (or Draft label), a status badge, an **overdue** badge when it is issued and past its due date, then client name, total, the VAT treatment (**21% BTW**, **BTW verlegd** or **buiten EU**) and, for issued invoices, the due date.

## The client page

On a client's page, the **Invoices** card lists that client's invoices (the six newest), including drafts, with the outstanding amount. If there are none it links back to this list. The card is only shown to people with `billing.read`.

## Good to know

- The list shows at most the 200 most recent invoices.
- Voided drafts never appear.
- The outstanding total adds up issued invoices and issued credit notes, so a credit note (a negative amount) reduces it.
- The page also holds the **Draft from hours…** control: see [Create a draft from hours](help:billing/draft-from-hours).
- There is no button here to create an empty invoice or one with hand-typed lines; drafts come from hours.
