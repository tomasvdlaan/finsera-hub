---
title: Download an invoice as PDF or UBL
summary: Preview a draft as a concept PDF, download the stored PDF of an issued invoice, or export UBL for your accounting package.
module: billing
paths: []
capability: billing.read
keywords: [pdf, ubl, xml, export, download, accounting, boekhouding, concept, preview]
updated: 2026-10-23
---

## Steps

1. Open the invoice.
2. For a draft, click **preview PDF (concept)**. For an issued or paid invoice, click **download PDF**.
3. For an issued or paid invoice you can also click **download UBL**. Drafts have no UBL button.
4. The file downloads in your browser. If the server refuses, a red message such as "403 Forbidden" appears under the buttons.

## Which file you get

- **Draft:** a live render stamped **CONCEPT — geen factuur** (concept — not an invoice), file name `concept-factuur.pdf`. It changes as you edit.
- **Issued or paid:** the original PDF stored at the moment of issue, so it is exactly what was sent and does not change if the layout code changes later. Name: `factuur-<number>.pdf`, or `creditnota-…` for a credit note. If storing failed at issue, you get a fresh render of the frozen invoice instead.
- **UBL:** UBL 2.1 XML, named `<number>.xml`, which Dutch accounting packages can import. Only issued invoices export; a draft returns "Only issued invoices export as UBL".

## Good to know

- You need `billing.read`.
- The PDF is deliberately plain: sender details (legal name, address, KvK, BTW, IBAN, invoice e-mail) come from the organisation settings, then the client, lines, VAT breakdown, due date and notes. Missing organisation details print as "—".
- The stored PDF is also in [Documents](help:docs/index), filed under the client.
- Nothing is emailed for you.
