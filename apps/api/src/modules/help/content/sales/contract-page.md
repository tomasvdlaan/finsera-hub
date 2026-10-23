---
title: The contract page
summary: Edit the terms of a draft contract, read a signed one, and see which buttons apply.
module: sales
paths: [/money/contracts/:id]
capability: sales.contracts.read
keywords: [contract, terms, start date, end date, notice period, auto-renew, sub-processors, document id, dpa]
updated: 2026-10-23
---

## What is on the page

- **Header.** Title, link to the client, type badge, status and urgency badge (see [Contract list](help:sales/contract-list)). If a document ID is set, **view the signed document** opens it in [Documents](help:docs/index).
- **Buttons.** Draft: **Mark signed** and **delete draft**. Signed: **terminate**. Terminated: none.
- **Terms.** Editable while a draft; a read-only summary after signing.
- **Timeline.** History of the contract.

## Edit the terms of a draft

Rows are click-to-edit (**Edit** next to the value):

- **Title**
- **Client reference**: their contract number, if they use one.
- **Starts on**: `YYYY-MM-DD`. Required to sign.
- **Ends on**: `YYYY-MM-DD`, or blank for open-ended.
- **Notice period (days)**: a number.
- **Auto-renews**: **no** / **yes**. Choosing yes sets renewal to 12 months and shows **every (months)** to change it; choosing no clears it.
- **Permits sub-processors**: only on **Verwerkersovereenkomst** (DPA) contracts: **not recorded**, **yes**, **no**, **unclear**.
- **Document ID**: paste the ID of the signed PDF from Documents.
- **Notes**

Dates are free text on screen and not checked for format; use `YYYY-MM-DD`.

## Read a signed contract

A summary shows **Runs** (start → end, with "N days left" or "ended N days ago"), **Notice** (days and "give notice by <date>"), **Renewal** ("Rolls over every N months unless notice is given" or "Does not auto-renew"), sub-processors on a DPA, their reference and notes. A line states when it was signed and that the terms are immutable.

## Good to know

- Signed terms cannot be edited. An amendment is recorded as a **new contract**.
- **delete draft** removes a draft immediately, with no confirmation, and cannot be undone. Signed contracts cannot be deleted; terminate them.
- On a DPA, the sub-processors answer matters: the screen notes that it determines whether AI providers may process this client's data. The client page shows it too ([Quotes and contracts on the client page](help:sales/client-page-widgets)).
- Tasks: [Mark a contract signed](help:sales/sign-contract), [Terminate a contract](help:sales/terminate-contract).
