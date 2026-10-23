---
title: Edit a draft quote
summary: Change the title, introduction, validity, hourly rate, notes and lines of a draft quote.
module: sales
paths: []
capability: sales.quotes.write
keywords: [edit quote, quote lines, hourly rate, valid until, introduction, notes, unit, fixed price]
updated: 2026-10-23
---

Only drafts can be edited. A sent quote is changed by a [revision](help:sales/revise-quote).

## Header fields (**The offer** section)

Each row is click-to-edit: click **Edit** next to the value, type, and confirm. Fields save one at a time.

- **Title**
- **Introduction**: the scope in words the client reads before any numbers.
- **Valid until**: typed as a date, `YYYY-MM-DD`. The screen does not check the format, so type it carefully. New drafts default to 30 days ahead.
- **Hourly rate (€)**: in euros (for example `135` or `135,00`), not cents. When the quote is accepted and a project is created, this becomes the project's hourly rate. Clearing it leaves the rate empty.
- **Notes**

## Lines

1. In **Lines**, edit **Description**, **Unit** (**hours**, **days** or **fixed**), **Quantity** and **Price €**. The **Amount** column is a preview.
2. **+ add line** adds a row (hours, 1.00, €0.00). **remove** deletes a row.
3. Click **Save lines**. It is disabled until something changed. The totals row shows "(before edits)" until you save, and then the server's recalculated figures.

Rules: every line needs a description; quantity must be a number other than zero; price must be a number; a quote needs at least one line ("A quote needs at least one line").

## Good to know

- Lines are saved as a whole set, replacing the previous lines.
- Changing lines does **not** recompute the hourly rate. Check **Hourly rate (€)** yourself: sending a time-and-materials quote without a rate is refused.
- VAT follows the client's treatment from when the draft was created. See [VAT, rounding and numbering](help:billing/vat-and-rounding).
- Next: [Send a quote](help:sales/send-quote).
