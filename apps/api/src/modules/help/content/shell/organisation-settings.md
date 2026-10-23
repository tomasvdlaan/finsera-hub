---
title: Organisation settings
summary: The company details that print on every invoice and quote, and the build number of the platform you are using.
module: shell
paths: [/settings]
keywords: [company details, legal name, kvk, btw, vat number, iban, invoice email, invoice prefix, payment terms, settings, build, version, reload]
updated: 2026-10-23
---

**Organisation** holds the sender details that appear on every invoice and quote. Dutch invoices are only valid with the sender's KvK and BTW numbers, so these have to be right before you issue a real invoice. Open it from your avatar menu.

## Fields

- **Legal name** - as registered at the KvK; printed on every invoice.
- **Address**
- **Postcode & city**
- **KvK number**
- **BTW number** - for example `NL…B01`.
- **IBAN** - where clients pay.
- **Invoice email**
- **Invoice number prefix** - optional; numbers look like `2026-0001`.
- **Default payment terms (days)** - how long a client has to pay unless an invoice says otherwise. Entering something that is not a number resets it to 30.

## Steps

1. Open your avatar menu and choose **Organisation**.
2. Edit the fields. All of them change together, so nothing saves until you select **Save**.
3. Select **Save**. "saved" appears next to the button.

## Who can do this

Everyone can open and read the page, but **only an administrator can save changes**. A member who selects **Save** gets an error and nothing is stored.

## Good to know

- If **legal name, KvK number, BTW number and IBAN** are not all filled in, a red notice says "Incomplete: … required before issuing a real invoice".
- **The build line** at the foot reads, for example, "Interface v128 · server v128 · built 2026-10-22 14:05". If the tab is older than the server you also see "This tab is running an older build than the server - reload to catch up". After an update, reload if a button seems to do nothing or a field is missing. When asking for help, quote this line.
- Invoices and quotes are described in [Invoicing](help:billing/index) and [Sales](help:sales/index).
