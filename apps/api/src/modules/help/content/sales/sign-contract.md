---
title: Mark a contract signed
summary: Freeze a contract's terms once it has been signed in real life. This cannot be undone.
module: sales
paths: []
capability: sales.contracts.write
keywords: [sign contract, signed, freeze terms, ondertekend, immutable]
updated: 2026-10-23
---

Marking signed does not sign anything legally; it records that the paper has been signed and locks the terms you recorded.

## Before you start

- You need `sales.contracts.write`.
- **Starts on** must be filled in, otherwise: "A signed contract needs a start date".
- Check every term, and set **Document ID** to the signed PDF if you have it.

## Steps

1. Open the draft contract and click **Mark signed**.
2. In **Mark this contract signed?** (terms freeze; an amendment becomes a new contract) click **Mark signed**.
3. A toast says "Contract marked signed". Status is now **signed** and the terms are read-only.

## What happens

- A `contract.signed` event is published (client, type, dates) and the audit trail records it.
- The contract starts counting in expiry and notice badges and in the reporting views ([Reporting overview](help:reporting/overview)).

## Good to know

- Irreversible. Terms are protected in the database too. Fixing a wrong date later means recording a new contract and terminating the old one.
- See [Terminate a contract](help:sales/terminate-contract).
