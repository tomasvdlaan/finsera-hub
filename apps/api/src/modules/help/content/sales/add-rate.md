---
title: Add a rate to a rate card
summary: Record a new hourly rate for a role from a given date, which is how an indexation is recorded.
module: sales
paths: []
capability: sales.contracts.write
keywords: [add rate, indexation, price increase, new tariff, effective date, role]
updated: 2026-10-23
---

## Steps

1. On [Rate cards](help:sales/rate-cards), click **+ add rate** under the card.
2. In **Add a rate**, fill:
   - **Role** (default "Consultant")
   - **Rate per hour (€)** (default 35.00; euros with two decimals)
   - **In force from** (date, default today)
3. Click **Add rate**. A toast says "<role> rate added".

## Good to know

- Needs `sales.contracts.write`. The rate must be positive ("A rate must be positive").
- Existing rows are never rewritten. A new rate with a later date takes over from that date; the old one stays visible, so "what did we charge in 2025?" always has an answer.
- If you add the same role with the same date again, the rate on that row is **overwritten** instead of duplicated.
- A rate dated in the future shows without the **current** badge until its date arrives.
- Adding a rate changes nothing on projects or invoices. To use it: [Apply a rate to a project](help:sales/apply-rate-to-project).
