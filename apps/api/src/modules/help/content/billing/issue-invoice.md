---
title: Issue an invoice
summary: Give a draft its legal number and freeze it. This cannot be undone; corrections afterwards are credit notes.
module: billing
paths: []
capability: billing.issue
keywords: [issue, number, finalize, freeze, legal, immutable, invoice number, due date, factuurnummer]
updated: 2026-10-23
---

Issuing is the one irreversible step in invoicing. The draft gets its sequential number, becomes immutable and starts counting as money owed.

## Before you start

- You need `billing.issue` (separate from `billing.write`).
- Check the lines first: [Edit the lines of a draft](help:billing/edit-draft-invoice).
- If the client's VAT treatment is **BTW verlegd** (reverse charge), the client must have a VAT number on file. Otherwise you get "Reverse charge requires the client's VAT number — add it to the client first". Add it in [CRM](help:crm/index) and try again.
- The invoice needs at least one line.

## Steps

1. Open the draft.
2. Click **Issue invoice**.
3. A dialog asks **Issue this invoice?** and says it is allocated its legal number and becomes immutable. Click **Issue invoice** to confirm, or cancel.
4. A toast says "Invoice issued" and the page now shows the number, the issue date and the due date.

## What happens

- **Number.** Format is the organisation's invoice prefix (if one is set), the year, a dash and a four-digit counter, for example `2026-0042`. Numbering is sequential with no gaps, one counter per calendar year, shared by invoices and credit notes.
- **Dates.** Issue date is today; due date is today plus the client's payment terms in days (30 if the client has none).
- **VAT.** The client's VAT number is copied onto the invoice.
- **Hours.** For an invoice, the hours it bills are stamped as invoiced. For a credit note, the hours on the invoice it reverses become billable again.
- **PDF.** The PDF is generated once and filed in Documents (category invoice) under the client. If filing fails, the invoice is still issued and the download falls back to a fresh render; the failure is only logged.
- **Event.** An `invoice.issued` event is published (insights and other modules can react) and the audit trail records it.

## Good to know

- Issuing does not send anything to the client. Download the [PDF](help:billing/invoice-pdf-and-ubl) and send it yourself.
- Issuing an invoice does not check that the organisation details (legal name, KvK, BTW, IBAN) are filled in; those print on the PDF as "—" when missing. Quotes do check this; invoices do not.
- A voided draft never used a number, so voiding leaves no gap.
- Issued invoices become visible, read-only, to the client in the portal.
- The assistant can never issue or send an invoice.
