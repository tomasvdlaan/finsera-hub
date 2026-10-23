---
title: Send a quote
summary: Number a draft quote and freeze it as the version the client has. This cannot be undone.
module: sales
paths: []
capability: sales.quotes.write
keywords: [send quote, number, freeze, offerte versturen, issue, immutable]
updated: 2026-10-23
---

"Send" here means "this is now the version the client has". The platform numbers and freezes the quote and files its PDF; it does **not** email it. Download the PDF and send it yourself.

## Before you start

- You need `sales.quotes.write`.
- The quote needs at least one line.
- A time-and-materials quote needs an **Hourly rate (€)**, otherwise: "A time-and-materials quote needs an hourly rate — it becomes the project rate when accepted".
- The organisation details (legal name, KvK, BTW, IBAN) must be filled in, otherwise: "Fill in the organisation details … before sending — they print on the quote". See [organisation settings](help:shell/index).

## Steps

1. Open the draft quote.
2. Click **Send quote**.
3. In **Send this quote?** read that it gets its number and freezes, then click **Send quote**.
4. A toast says "Quote sent". The header now shows the number (for example `Q2026-0003`), and the buttons change to **Mark accepted**, **mark rejected**, **create revision**, **download PDF**.

## What happens

- Number allocated: `Q` + year + four-digit counter.
- Status becomes **sent**; issue date is today. Valid-until stays as you set it.
- The PDF is generated and filed in Documents. If filing fails the quote is still sent and the download renders it fresh.
- A `quote.sent` event is published and the audit trail records it.
- The quote becomes visible, read-only, in the client portal.

## Good to know

- Irreversible. To change anything afterwards, [create a revision](help:sales/revise-quote).
- The assistant can never send a quote.
