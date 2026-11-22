---
title: Rate cards
summary: Keep a history of what an hour costs per role, for all clients or for one client, and see the rate in force today.
module: sales
paths: [/money/rate-cards]
capability: sales.contracts.read
keywords: [rate card, tarief, hourly rate, price list, role, indexation, indexering, house rates]
updated: 2026-10-23
---

A rate card records what an hour costs and since when. It does **not** change what invoices bill on its own: invoices use the rate on the **project**. Only [applying a rate to a project](help:sales/apply-rate-to-project) changes that.

Rate cards are found under Setup (not in the Money tab strip).

## Create a card

1. Open **Rate cards**.
2. Type a **Rate card name**, choose **House rates (all clients)** or a client in **Rate card client**.
3. Click **Add card** (needs `sales.contracts.write`; disabled while the name is empty).

## Read a card

Each card has a heading with its name and a badge (the client's name or **house**). The table shows **Role**, **Rate**, **In force from**. The rate currently in force for each role carries a **current** badge; older and future-dated rows are dimmed.

Per row: **apply to project** (current rows only) and **remove**. Below the table: **+ add rate**. See [Add a rate](help:sales/add-rate).

## Good to know

- A new card starts empty ("No rates yet."); add rates to it.
- **remove** deletes that row immediately, without confirmation. Removing the only current row can leave a role with an older rate in force, or none.
- The page lists all cards, house and client ones together.
- Anyone with `sales.contracts.read` sees cards; writing needs `sales.contracts.write`.
- Linking a card to a contract is possible only through the system interface, not on this screen.
