---
title: Edit the lines of a draft invoice
summary: Change descriptions, hours and rates, add or remove lines on a draft, and save them as one set.
module: billing
paths: []
capability: billing.write
keywords: [edit invoice, lines, description, rate, hours, add line, remove line, draft]
updated: 2026-10-23
---

While an invoice is a draft, the **Lines** section is an editable table. Issued invoices cannot be edited; use a [credit note](help:billing/credit-note) instead.

## Steps

1. Open the draft (see [Invoice list](help:billing/invoice-list)).
2. In **Lines**, edit the **Description**, **Hours** and **Rate €** boxes of any row. The **Amount** column updates as you type (a preview only).
3. Click **+ add line** to add an empty row (1.00 hours at €0.00), or **remove** at the end of a row to drop it.
4. Click **Save lines**. The button is disabled until you change something and reads **Saving…** while it works.
5. The totals row (**Subtotal · BTW · Total**) shows the figures from before your edits, marked "(before edits)", until you save. After saving they are recalculated on the server.

## Rules the screen enforces

- Every line needs a description ("Line 2 needs a description").
- Hours must be a number other than zero; commas are accepted as decimal separator. Negative values are accepted.
- The rate is in euros, not cents, and must be a number.
- An invoice needs at least one line ("An invoice needs at least one line").
- Lines are saved as a whole set: the old lines are replaced by what is on screen.

## Good to know

- A line created from hours shows "bills N time entries" under its description. That link is kept invisibly through every edit, so changing a description never frees the hours.
- If you **remove** a line that bills hours and save, those hours become billable again. Hours still on a line stay claimed.
- The VAT rate cannot be edited per line: the whole invoice follows the client's VAT treatment at the time the draft was created. See [VAT, rounding and numbering](help:billing/vat-and-rounding).
- Totals are always computed server-side, so what you see after saving is what will be issued.
- Leaving the page with unsaved changes loses them; there is no autosave.
