---
title: Fill in billing and VAT details
summary: Record what an invoice to this client legally needs, including legal name, address, KvK, VAT number and VAT treatment.
module: crm
paths: [/clients/:id/billing]
capability: crm.clients.write
keywords: [invoice details, btw, vat, kvk, legal name, payment terms, reverse charge, invoice address, invoice email, country]
updated: 2026-10-23
---

The **Billing** tab of [a client's page](help:crm/client-profile) holds what an invoice to the client needs. You read it when writing an invoice, not day to day.

## Before you start

Changing details needs `crm.clients.write`. Invoices themselves are made in [Billing](help:billing/index).

## Steps

Each field is edited the same way: click **Edit**, type, press Enter or **Save**, or **Cancel** to leave.

**Who to invoice**
- **Legal name**: as registered at the KvK. Invoices carry this name rather than the display name.
- **Invoice address**: several lines allowed.
- **Invoice email**
- **Payment terms**: type the number of days, for example `45`. Anything that is not a digit is stripped. Leaving it empty sets 30 days.

**Tax**
- **KvK**
- **VAT number**
- **Country**: a country code, `NL` by default. Empty goes back to `NL`.
- **VAT treatment**: choose one and it saves at once.
  - **Dutch client — 21% BTW**
  - **EU client — BTW verlegd** (reverse charge)
  - **Outside EU — out of scope**

## Good to know

- Reverse charge needs a VAT number. If the VAT number is empty, choosing **EU client — BTW verlegd** is refused ("Reverse charge requires the client's VAT number"). Fill in **VAT number** first, then switch.
- VAT treatment is a deliberate choice per client and is not guessed from the country.
- The default is Dutch, 21%, 30-day payment terms.
- The page does not always show why a refused change failed; the drop-down just stays on its old value.
