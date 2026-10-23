---
title: The quote page
summary: A tour of a single quote screen and which buttons appear in which status.
module: sales
paths: [/money/quotes/:id]
capability: sales.quotes.read
keywords: [quote, offerte, detail, status, buttons, version, supersedes, project]
updated: 2026-10-23
---

Open a quote from the [list](help:sales/quote-list), the client page or a chat card.

## What is on the page

- **Header.** The number (or **Draft quote**), a link to the client, and, on a revision, a link **supersedes vN** to the previous version.
- **Badge row.** Status; **past its validity date** when sent and expired; **version N** for revisions; and **view the project** once an accepted quote has a project.
- **The offer.** Title, introduction, valid-until, hourly rate and notes. Editable while a draft, read-only text afterwards.
- **Lines.** Editable table while a draft; afterwards a table with description, quantity with unit (**uur**, **dagen**), price and amount, then Subtotal, **BTW 21%** or **BTW 0%**, and Total. Fixed-price lines show "—" for quantity and price.
- **Timeline.** History of the quote.

## Buttons by status

| Status | Buttons |
|---|---|
| draft | **Send quote**, **delete draft**, **preview PDF (concept)** |
| sent | **Mark accepted**, **mark rejected**, **create revision**, **download PDF** |
| accepted / rejected | **download PDF** |

Tasks: [Edit a draft quote](help:sales/edit-draft-quote), [Send](help:sales/send-quote), [Accept](help:sales/accept-quote), [Reject](help:sales/reject-quote), [Revise](help:sales/revise-quote), [Delete a draft](help:sales/delete-draft-quote).

## The PDF

A draft gives a live **concept** render (`concept-offerte.pdf`). A sent quote gives the PDF stored at the moment of sending (`offerte-<number>.pdf`), filed in [Documents](help:docs/index) under the client.

## Good to know

- Once sent, the page says the quote "is immutable". That is how the version the client read stays exactly as they read it.
- Errors from an action show in red under the buttons.
