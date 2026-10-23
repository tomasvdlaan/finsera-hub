---
title: Terminate a contract
summary: Record that a signed contract has ended early, with an optional reason.
module: sales
paths: []
capability: sales.contracts.write
keywords: [terminate, cancel contract, end contract, opzeggen, beëindigen]
updated: 2026-10-23
---

## Steps

1. Open the signed contract and click **terminate** (red text link).
2. In **Terminate this contract**, optionally fill **Reason (optional)**. The dialog notes that the notice period still applies.
3. Click **Terminate**. A toast says "Contract terminated". Cancelling does nothing.

## Good to know

- Needs `sales.contracts.write`. Only signed, not-yet-terminated contracts can be terminated.
- Irreversible from the screen.
- Termination only **records** it. It does not calculate or enforce the notice period, and no event is published for it; the audit trail keeps the reason.
- A terminated contract stops showing urgency badges.
- Drafts are deleted, not terminated: [The contract page](help:sales/contract-page).
