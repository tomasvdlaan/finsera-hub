---
title: Invoicing overview
summary: What the invoicing module does, the lifecycle of an invoice, and who is allowed to do what.
module: billing
paths: []
keywords: [invoices, factuur, billing, credit note, creditnota, btw, vat, money]
updated: 2026-10-23
---

Invoicing turns billable hours into invoices and keeps the legal paper trail: sequential numbers, frozen documents, credit notes for corrections and a UBL file for your accounting package. It lives under **Money** in the top bar, on the **Invoices** tab.

## The life of an invoice

| Status | What it means | What you can do |
|---|---|---|
| **draft** | Work in progress. No number yet. Only colleagues see it. | Edit lines, preview a concept PDF, issue it, or void it. |
| **issued** | Numbered and frozen. Counts as money owed to us. | Mark paid, create a credit note, download PDF and UBL. |
| **paid** | Marked as paid. | Download PDF and UBL. |

A voided draft disappears from every list. A credit note goes through the same three statuses, with its own number.

## Pages and tasks

- [The Money hub](help:billing/money-hub) — the one-screen summary and the tab strip.
- [Invoice list](help:billing/invoice-list) — find, filter and open invoices.
- [Create a draft from hours](help:billing/draft-from-hours)
- [The invoice page](help:billing/invoice-page) — what each part of an invoice screen shows.
- [Edit the lines of a draft](help:billing/edit-draft-invoice)
- [Issue an invoice](help:billing/issue-invoice) — the irreversible step.
- [Mark an invoice paid](help:billing/mark-paid)
- [Correct an issued invoice with a credit note](help:billing/credit-note)
- [Void a draft](help:billing/void-draft)
- [Download the PDF or UBL file](help:billing/invoice-pdf-and-ubl)
- [VAT, rounding and numbering](help:billing/vat-and-rounding) — the exact rules.

## Who can do what

| Capability | Lets you |
|---|---|
| `billing.read` | See invoices, open them, download PDF and UBL. |
| `billing.write` | Create drafts from hours, edit draft lines, void drafts, mark invoices paid, create credit notes. |
| `billing.issue` | Issue an invoice (allocate its legal number). Held separately from `billing.write` on purpose. |

The buttons are shown to everyone who can open the page. If you press one you are not allowed to use, the screen shows a red message such as "Missing capability 'billing.issue'" and nothing changes. Ask an administrator for the capability.

## The assistant and invoices

The assistant can list invoices (`billing_list_invoices`) and can create a **draft** from the unbilled hours of a project (`billing_draft_from_hours`), which you then review. It cannot issue or send an invoice: that is permanently off limits to it. In a chat, an invoice appears as a small card with a link to open it; there are no actions on the card.

## Good to know

- Issuing does not email anything. The platform numbers and freezes the invoice; you download the PDF and send it yourself.
- Invoices for a client also appear on the client page in the **Invoices** card (see [Invoice list](help:billing/invoice-list)).
- Issued invoices are visible, read-only, to the client in the portal. Drafts never are. See [the portal](help:portal/index).
- Where the hours come from: [Time](help:time/index). Where the client's VAT treatment and payment terms are kept: [CRM](help:crm/index).
