---
title: Quotes and contracts on the client page
summary: The Quotes and Contracts cards that appear on a client's page, and what they tell you.
module: sales
paths: []
keywords: [client page, widget, quotes card, contracts card, dpa, sub-processors, card]
updated: 2026-10-23
---

Sales adds two cards to each client's page (see [CRM](help:crm/index)). They can be placed like any other card on the page.

## Quotes card

- Shows the amount **awaiting a decision** (sent quotes, total including VAT) and how many are **won** (accepted).
- Lists the client's six newest quotes with number, status, an **expired** badge, title and total. Click one to open it.
- When there are none: "No quotes yet — open quotes", linking to [Quote list](help:sales/quote-list).
- Shown to people with `sales.quotes.read`.

## Contracts card

- First line: **DPA signed** (with the sub-processors answer if recorded) or **No signed DPA on file**. This matters because whether AI providers may process the client's data hangs on it.
- Lists all of the client's contracts with type, status and urgency badge.
- When there are none: "Nothing recorded — add a contract", linking to [Contract list](help:sales/contract-list).

## Good to know

- The Contracts card is gated by `sales.quotes.read` on the page, but the contracts it loads need `sales.contracts.read`. Someone with only the quotes capability sees the card, but the load is refused and it reads "Nothing recorded" even when contracts exist.
- Invoices have their own card: [Invoice list](help:billing/invoice-list).
