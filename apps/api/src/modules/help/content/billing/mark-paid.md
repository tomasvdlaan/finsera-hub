---
title: Mark an invoice paid
summary: Record that an issued invoice has been paid, which takes it out of the outstanding total.
module: billing
paths: []
capability: billing.write
keywords: [paid, payment, received, outstanding, settle, betaald]
updated: 2026-10-23
---

When the money arrives, mark the invoice as paid so it stops counting as owed and stops showing as overdue.

## Before you start

- You need `billing.write`. Only **issued** invoices show the button.

## Steps

1. Open the issued invoice.
2. Click **Mark paid**. There is no confirmation dialog.
3. The status badge changes to **paid** and the buttons reduce to the downloads.

## What happens

- The paid time is set to the moment you click. There is no field for the actual payment date or amount.
- An `invoice.paid` event is published and the audit trail records it.
- The invoice leaves **Owed to us**, the **overdue** badge and the receivables charts. It starts counting in "Who pays late" (days between the due date and the day you clicked).

## Good to know

- There is no button to undo it from the screen. Click only when the payment has really arrived.
- Because the paid date is the day you click, "Who pays late" is only as accurate as how promptly you mark invoices paid.
- Credit notes also have a **Mark paid** button once issued; it just removes them from the outstanding total.
- See also [Reporting overview](help:reporting/overview).
