---
title: Ask a document a question
summary: Pull out the passages of one document that are closest to your question, such as a notice period or payment terms.
module: docs
paths: [/docs/documents/:id]
capability: docs.read
keywords: [ask, question, passages, clause, notice period, payment terms, find in document, quote]
updated: 2026-10-23
---

The **Ask** tab of [a document's page](help:docs/document-viewer) finds the parts of that one document nearest your question. It returns quotations from the document, not a written answer, so you read the actual clause.

## Before you start

You need `docs.read`. The document needs readable text (see "Indexed" on the Details tab).

## Steps

1. Open the document and click the **Ask** tab. The box is focused.
2. Type a question after "What does this document say about…", for example `notice period`.
3. Click **Ask** (or press Enter).

The passages appear as a list of quotations. If nothing came close you see "Nothing in this document came close to that."

## Good to know

- If searching by meaning is not set up on the platform, **Ask** shows the start of the document (about the first 4,000 characters) instead of the closest passages.
- Ask answers from the text as it was last read. For SharePoint files that changed since, re-index first. See [SharePoint](help:docs/sharepoint).
- To search across all documents instead, use [Search inside documents](help:docs/documents).
- The assistant can do the same thing for you in chat: it retrieves passages from one document and then writes the answer from them.
- A failed request also shows as "Nothing in this document came close to that", so try again before concluding the document has no answer.
