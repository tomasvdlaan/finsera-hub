---
title: Find and search documents
summary: Browse filed documents, filter by client and kind, and search inside the text of every document.
module: docs
paths: [/docs]
capability: docs.read
keywords: [search documents, find contract, filter documents, document list, full text, semantic, out of date, summary]
updated: 2026-10-23
---

The **Documents** page lists everything filed, newest change first, and has a search box that looks inside the documents rather than only at their names.

## Before you start

You need `docs.read` to see the page and search.

## Steps: browse

1. Open **Documents** in the rail.
2. Optionally narrow the list with **Every client** and **Every kind**. The kind list is built from what exists (the type read from the document, or the category typed when it was uploaded).
3. Click a document card to open it.

Each card shows the file type, the kind, the headline value when one was extracted, the title, and a summary of the document. Without a summary it says "Not summarised yet." or "No text could be read from this file." The last line shows client, project, size, last change and "out of date" when relevant.

Beside the filters a count line reads, for example, "12 of 40", and may add "N with no readable text" and "N out of date at last check".

## Steps: search inside documents

1. Type in **Search inside documents…** and click **Search** (or press Enter).
2. Each result shows the title, a snippet, and a label: **words** (the words matched) or **meaning** (the words differ but the sense is close, which is a weaker claim). **out of date** appears when the file has changed since it was read.
3. Click **Clear** to return to the list.

The search covers every document (the client and kind filters do not apply to it) and shows up to ten results. Meaning search only runs when it is set up on the platform; otherwise you get word matches only.

## Good to know

- "Out of date" only reflects the last time somebody pressed **Check SharePoint** on that document. See [SharePoint](help:docs/sharepoint).
- Word search uses English word handling (for example "agreements" finds "agreement"), so documents written in Dutch match best on their exact words.
- The list shows the 200 most recently changed documents.
- A link **N unfiled** appears next to the search box only when the library holds files that have no record yet and you may file them. See [Unfiled](help:docs/unfiled).
- To add a document, use the **File something** card at the bottom: [Upload a document](help:docs/upload).
- Back to [Documents](help:docs/index).
