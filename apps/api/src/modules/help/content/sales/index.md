---
title: Quotes, contracts and rate cards overview
summary: What the sales module covers, how quotes and contracts move through their statuses, and who can do what.
module: sales
paths: []
keywords: [sales, quote, offerte, contract, rate card, tarief, agreement, proposal]
updated: 2026-10-23
---

Sales holds three things: **quotes** (offers you send to clients), **contracts** (a register of what has been agreed and when it lapses) and **rate cards** (what an hour costs, and since when). Quotes and contracts are tabs under **Money**; rate cards live under Setup.

## Quotes

| Status | Meaning |
|---|---|
| **draft** | Editable. No number yet. |
| **sent** | Numbered (`Q2026-0001`) and frozen. Waiting for a decision. |
| **accepted** | The client agreed. Optionally linked to a project. |
| **rejected** | The client declined; an optional reason is kept. |

A sent quote is never edited. A change is a **revision**: a new draft that supersedes the old one.

## Contracts

| Status | Meaning |
|---|---|
| **draft** | Terms still editable. |
| **signed** | Terms frozen. Dates and notice deadlines are tracked. |
| **terminated** | Ended early; recorded with an optional reason. |

"Expired", "ends in N days" and notice deadlines are worked out from today and shown as badges; nothing changes status by itself when a date passes.

## Pages and tasks

Quotes
- [Quote list](help:sales/quote-list)
- [Create a quote](help:sales/create-quote)
- [The quote page](help:sales/quote-page)
- [Edit a draft quote](help:sales/edit-draft-quote)
- [Send a quote](help:sales/send-quote) (irreversible)
- [Mark a quote accepted](help:sales/accept-quote)
- [Mark a quote rejected](help:sales/reject-quote)
- [Revise a sent quote](help:sales/revise-quote)
- [Delete a draft quote](help:sales/delete-draft-quote)

Contracts
- [Contract list](help:sales/contract-list)
- [Add a contract](help:sales/add-contract)
- [The contract page](help:sales/contract-page)
- [Mark a contract signed](help:sales/sign-contract) (irreversible)
- [Terminate a contract](help:sales/terminate-contract)

Rate cards
- [Rate cards](help:sales/rate-cards)
- [Add a rate](help:sales/add-rate)
- [Apply a rate to a project](help:sales/apply-rate-to-project)

Also: [Quotes and contracts on the client page](help:sales/client-page-widgets).

## Who can do what

| Capability | Lets you |
|---|---|
| `sales.quotes.read` | See quotes and download their PDFs. |
| `sales.quotes.write` | Create, edit, delete, send, accept, reject and revise quotes. |
| `sales.contracts.read` | See contracts and rate cards. |
| `sales.contracts.write` | Add, edit, sign, terminate and delete contracts; create rate cards, add and remove rates, apply a rate to a project. |

Buttons are shown to everyone who can open a page. Pressing one you are not allowed to use gives a red "Missing capability …" message and changes nothing.

## The assistant

- `sales_list_quotes`, `sales_list_contracts`: list them (read only).
- `sales_draft_quote`: drafts a quote for a client from a described scope. It is a **draft** with estimated prices you must check; it does not send.
- `sales_draft_contract_terms`: records an **unsigned** contract from terms found in an uploaded document, stating only what the document says.
- `sales_send_quote`: permanently restricted. The assistant never sends a quote.

## Good to know

- "Send" means "freeze and number"; the platform does not email the quote. Download the PDF and send it yourself.
- Sent quotes appear read-only in the client portal, and a client can accept a quote there. See [the portal](help:portal/index). Contracts are never shown in the portal.
- Invoicing is separate: [Invoicing overview](help:billing/index).
