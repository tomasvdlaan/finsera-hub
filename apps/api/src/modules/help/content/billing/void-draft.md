---
title: Void a draft invoice
summary: Throw away a draft you no longer need and put its hours back in the billable pile.
module: billing
paths: []
capability: billing.write
keywords: [void, delete invoice, discard draft, cancel draft, hours billable again]
updated: 2026-10-23
---

Use this when a draft was created by mistake or needs to be started over. It only works on drafts.

## Steps

1. Open the draft invoice.
2. Click **void draft** (red text link, next to **Issue invoice**).
3. In the dialog **Void this draft?** read that the draft and its lines are discarded and the hours become billable again, then click **Void draft**.
4. A toast says "Draft voided — its hours are billable again" and you return to the invoice list.

## Good to know

- You need `billing.write`.
- Irreversible: the draft cannot be brought back. Create a new one from hours if needed.
- The hours on its lines are released immediately, so they can go on another draft.
- No invoice number is used or wasted: numbers are only allocated at issue.
- Issued invoices cannot be voided at all; use a [credit note](help:billing/credit-note).
- Voided drafts do not appear in the list, in reports or in the client page.
