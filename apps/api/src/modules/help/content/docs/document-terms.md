---
title: Read the summary and extract the terms
summary: What the automatic summary is, and how to have the type, value and key terms read out of a document.
module: docs
paths: [/docs/documents/:id]
capability: docs.write
keywords: [summary, extract terms, value, notice days, payment terms, doc type, ai, model, contract value]
updated: 2026-10-23
---

On the **Details** tab of [a document's page](help:docs/document-viewer), the box **Read from the document** holds two things a model has read from the file. They are marked as model output because they can be wrong, and they sit beside facts a person typed.

## Before you start

Extracting terms needs `docs.write`. A model must be configured on the platform and the document must have readable text.

## The summary

Two or three sentences on what the document is. It is written automatically when the text is read, at upload and whenever a version is re-read, provided the text is at least about 200 characters. If no summary exists the box says nothing has been read yet: either no text could be extracted or no model is configured.

## Steps: extract the terms

1. On the Details tab, click **Extract the terms** (it reads **Extract again** once done). The button appears once the document has a summary.
2. Wait a moment. The fact list then fills in with what the document states:
   - **Type** (quote, invoice, contract, report, letter or similar)
   - **Value**: the headline total excluding VAT
   - **Payment** and **Notice** in days

Fields the document does not plainly state stay empty. A missing value means "not stated", not zero.

## Good to know

- Terms are only extracted when you ask. The reason: a wrong number is something people repeat to a client.
- Terms are tied to the version they were read from. After a new version they are shown as out of date with a note ("These terms were read from an earlier version"); click **Extract again**.
- The **Value** and **Type** also feed the Documents list: the value on the card and the type in the **Every kind** filter.
- Each extraction is written to the audit log.
- If no model is configured, or no text could be read, the click is refused with a message saying so.
