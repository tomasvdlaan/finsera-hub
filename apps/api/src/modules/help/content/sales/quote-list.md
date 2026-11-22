---
title: Quote list
summary: See all quotes, filter by status, and see how much is out with clients.
module: sales
paths: [/money/quotes]
capability: sales.quotes.read
keywords: [quotes, offertes, list, filter, status, expired, pipeline]
updated: 2026-10-23
---

**Money → Quotes** lists every quote, newest first.

## Steps

1. Open **Money** and choose the **Quotes** tab.
2. Read the summary line (shown when any quote is **sent**): the total value out with N clients, and "some past their validity date" if any has expired. The total uses each quote's total including VAT.
3. Use the **Status** dropdown: **All statuses**, **draft**, **sent**, **accepted**, **rejected**.
4. Click a quote number to open [the quote page](help:sales/quote-page). Drafts have no number and read **Draft**.

## What each row shows

Number, status, an **expired** badge (sent and past its valid-until date), a **vN** badge for revisions (v2 and up), then title, client and total. Sent quotes also show "valid to <date>".

To start a new quote use the form above the list: [Create a quote](help:sales/create-quote).

## Good to know

- **expired** is derived from today's date. The status stays **sent** until someone accepts or rejects it.
- A superseded (older) version of a revised quote stays in the list as **sent**; see [Revise a sent quote](help:sales/revise-quote).
