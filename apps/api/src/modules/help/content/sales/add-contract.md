---
title: Add a contract
summary: Record a new contract in the register as a draft, then fill in its terms.
module: sales
paths: []
capability: sales.contracts.write
keywords: [add contract, new contract, record, register, nda, dpa, raamovereenkomst, sow]
updated: 2026-10-23
---

The register records contracts; it does not generate them. Add the contract here and attach the signed document by its ID.

## Steps

1. Go to **Money → Contracts**.
2. In the form above the list pick the **Client**, then the **New contract type** (**Raamovereenkomst**, **Opdrachtbevestiging**, **NDA**, **Verwerkersovereenkomst** or **Overig**), and type a **Contract title**.
3. Click **Add contract** (disabled until client and title are set). You land on the new draft.
4. Fill in the terms: [The contract page](help:sales/contract-page).
5. When it is signed in real life, [mark it signed](help:sales/sign-contract).

## Good to know

- Needs `sales.contracts.write`.
- The assistant can record a contract from an uploaded document (`sales_draft_contract_terms`), as an **unsigned draft**, stating only terms actually found in the document. Review it before signing.
- A link to the client is created automatically; a document linked later is also linked ("signed document").
- A draft can be deleted from its page (see [The contract page](help:sales/contract-page)).
