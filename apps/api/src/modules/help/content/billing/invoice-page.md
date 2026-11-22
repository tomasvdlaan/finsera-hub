---
title: The invoice page
summary: A tour of a single invoice or credit note screen, and which buttons appear in which status.
module: billing
paths: [/money/invoices/:id]
capability: billing.read
keywords: [invoice, detail, buttons, status, overdue, credit note, timeline, lines]
updated: 2026-10-23
---

Open any invoice from the [list](help:billing/invoice-list), the client page or a chat card to see it in full.

## What is on the page

- **Header.** The invoice number (or **Draft invoice** / **Draft credit note**) and a link to the client.
- **Badge row.** Status, an **overdue** badge when issued and past its due date, the VAT treatment, and, on a credit note, a link **credits an invoice** to the original.
- **Buttons.** Depend on status, see below.
- **Lines.** An editable table while a draft; a read-only table with Subtotal, **BTW 21%** or **BTW 0%**, and Total once issued. A VAT legend (for example "BTW verlegd / VAT reverse charged") shows when the treatment needs one.
- **Timeline.** The history of the invoice: who drafted, edited, issued it and so on.

## Buttons by status

| Status | Buttons |
|---|---|
| draft | **Issue invoice**, **void draft**, **preview PDF (concept)** |
| issued | **Mark paid**, **create credit note**, **download PDF**, **download UBL** |
| paid | **download PDF**, **download UBL** |

Each is described on its own page: [Issue](help:billing/issue-invoice), [Void](help:billing/void-draft), [Mark paid](help:billing/mark-paid), [Credit note](help:billing/credit-note), [PDF and UBL](help:billing/invoice-pdf-and-ubl). To change lines: [Edit the lines of a draft](help:billing/edit-draft-invoice).

## Good to know

- Once issued, the line list is read-only and a note says "This invoice is immutable — corrections require a credit note". That is enforced in the database, not just on screen.
- Errors from an action (for example a missing capability) appear in red under the buttons.
- An issued invoice shows "Issued <date> · due <date>".
