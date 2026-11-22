---
title: Correct an issued invoice with a credit note
summary: Reverse an issued invoice by creating a credit note, then issue it and, if needed, re-bill the hours.
module: billing
paths: []
capability: billing.write
keywords: [credit note, creditnota, correction, reverse, cancel invoice, refund, re-bill]
updated: 2026-10-23
---

Issued invoices cannot be edited or voided. If one is wrong, you create a **credit note**: a new document with the same lines negated, referring to the original.

## Before you start

- You need `billing.write` to create the credit note and `billing.issue` to issue it.
- The button only appears on invoices with status **issued** (not on drafts or paid ones).

## Steps

1. Open the issued invoice and click **create credit note**.
2. You land on a new draft titled **Draft credit note**. Its lines read **Credit — <original description>** with the same hours and a negative rate. A **credits an invoice** link points back to the original.
3. Optionally adjust the lines (see [Edit the lines of a draft](help:billing/edit-draft-invoice)), for example for a partial credit.
4. Click **Issue invoice** and confirm. It receives the next number in the same sequence as invoices. See [Issue an invoice](help:billing/issue-invoice).
5. To bill the work again correctly, create a new draft from hours: [Create a draft from hours](help:billing/draft-from-hours).

## What happens

- When the credit note is **issued** (not when drafted), the hours that the original invoice billed become billable again. An abandoned credit-note draft changes nothing.
- The credit note shows as a negative amount in totals and revenue, so a credited month reads correctly.
- The original invoice keeps its own status; it is not marked "credited". It stays in the outstanding total until you mark it paid, and the issued credit note offsets it as a negative amount until that is marked paid too.

## Good to know

- The credit note has the same VAT treatment as the original.
- A draft credit note can be voided like any draft ([Void a draft](help:billing/void-draft)); it is then removed.
- Creating the credit note twice is not blocked by the screen once the first is still a draft or issued; check the invoice list first to avoid crediting the same invoice twice.
