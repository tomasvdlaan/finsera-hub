---
title: Mark a quote rejected
summary: Record that the client declined a sent quote, with an optional reason.
module: sales
paths: []
capability: sales.quotes.write
keywords: [reject quote, declined, lost, afgewezen, reason]
updated: 2026-10-23
---

## Steps

1. Open the sent quote and click **mark rejected**.
2. In **Mark this quote rejected**, optionally fill **Why was it rejected? (optional)**. The reason is kept with the quote so future pricing has context.
3. Click **Mark rejected**. A toast says "Quote marked rejected". Cancelling does nothing.

## Good to know

- Needs `sales.quotes.write`. Only sent, undecided quotes can be rejected.
- Not reversible from the screen. If the client changes their mind, [create a revision](help:sales/revise-quote) of a quote that is still sent, or start a new quote.
- A `quote.rejected` event is published with the reason, and the audit trail records it.
- Rejected quotes count towards the conversion rate in [Reporting](help:reporting/overview).
- A sent quote cannot be deleted; rejecting is how you close it out.
