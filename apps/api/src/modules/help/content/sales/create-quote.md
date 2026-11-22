---
title: Create a quote
summary: Start a new draft quote for a client from the quote list.
module: sales
paths: []
capability: sales.quotes.write
keywords: [new quote, create quote, offerte maken, draft, proposal]
updated: 2026-10-23
---

## Steps

1. Go to **Money → Quotes**.
2. In the form above the list, choose the client in the **Client** dropdown (it starts on the first client).
3. Type what the quote is for in **What is the quote for?** (the quote title).
4. Click **New quote** (it reads **Creating…** while it works). The button stays disabled until a client and a title are set.
5. You land on the new draft. Continue with [Edit a draft quote](help:sales/edit-draft-quote).

## What the new draft contains

- The title you typed.
- **One placeholder line**: the title as description, quantity 1.00, unit hours, price €35.00. It exists so the quote is valid from the start. Edit or replace it.
- An hourly rate of €35.00, taken from that placeholder line (the rate is only inferred when all hourly lines agree). Change it on the quote page before sending.
- **Valid until** = today plus 30 days.
- Billing model time-and-materials. There is no control for another billing model on screen.
- The client's VAT treatment, copied from the client now.

## Good to know

- The assistant can also draft a quote (`sales_draft_quote`) from a described scope; check its prices, which are only estimates.
- Drafts can be freely edited or [deleted](help:sales/delete-draft-quote).
