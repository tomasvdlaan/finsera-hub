---
title: VAT, rounding and numbering rules
summary: The exact rules for VAT treatments, how totals are rounded, how due dates are set and how invoice numbers are allocated.
module: billing
paths: []
keywords: [vat, btw, rounding, reverse charge, verlegd, outside eu, numbering, payment terms, due date, cents]
updated: 2026-10-23
---

This page is reference. Invoices and quotes use the same calculation code, so a quote and the invoice that follows agree to the cent.

## VAT treatment

The treatment comes from the **client** and is copied when a draft invoice or quote is created.

| Treatment | Label on screen | Rate | Legend printed |
|---|---|---|---|
| domestic_21 | **21% BTW** | 21% | none |
| reverse_charge | **BTW verlegd** | 0% | "BTW verlegd / VAT reverse charged" |
| outside_eu | **buiten EU** | 0% | "VAT out of scope — customer established outside the EU" |

- Changing the client's treatment afterwards does not change existing drafts.
- Reverse charge cannot be issued without the client's VAT number.
- You cannot pick a different rate per line.

## Rounding

- Each line: quantity × unit price, rounded half-up to whole cents, once.
- VAT: lines are added up per rate first, then VAT is calculated once on that total and rounded half-up. VAT is not rounded per line.
- Rounding is symmetric around zero, so a credit note is exactly the negative of its invoice.
- Quantities have two decimals when saved from the editors.

## Due date

Issue date plus the client's payment terms in days; 30 when the client has none.

## Numbering

- Invoices and credit notes: optional organisation prefix + year + `-` + four digits (`2026-0042`). Sequential, gapless, restarting each year, allocated only at issue.
- Quotes: `Q2026-0007` style, one counter per year, allocated when the quote is sent. The code does not promise gap-free numbering for quotes (it does for invoices).

See [Issue an invoice](help:billing/issue-invoice) and [Invoicing overview](help:billing/index).
