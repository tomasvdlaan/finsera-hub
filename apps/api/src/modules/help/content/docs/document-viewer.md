---
title: Read a document
summary: Open a document to read the file, see its details, download it, and reach versions, questions and activity.
module: docs
paths: [/docs/documents/:id]
capability: docs.read
keywords: [document page, preview, viewer, download, details, indexed, pdf, word, spreadsheet, activity, history]
updated: 2026-10-23
---

A document's page puts the file in the middle and everything the platform knows about it in a panel at the side. It takes the whole window so a page of a contract is readable.

## Before you start

You need `docs.read`. Some buttons need `docs.write` and are explained in their own pages.

## What you see

**Header**: back link **← Documents**, file type, the title (with its type, such as contract), then client, version ("v2 current"), size and upload date. On the right:

- **Open in Word** (or **Excel**, **PowerPoint**) and **Check SharePoint** and **Re-index**, shown only for files stored in SharePoint. See [SharePoint](help:docs/sharepoint).
- **Download**: downloads the file you are looking at.

**Centre**: a preview of the version shown. PDFs and images are drawn by the browser, Word files are rendered with their page layout, spreadsheets show as tables (the first 200 rows of each sheet; download for the rest), text and markdown show as text. Formats that cannot be previewed show a short reason.

**Side panel**, four tabs: **Details**, **Versions**, **Ask**, **Activity**.

## Details tab

- **Read from the document**: a short summary, labelled as written by a model. See [Summary and terms](help:docs/document-terms).
- A fact list: **Type**, **Value** (if extracted), **Client** and **Project** (links), **File**, **Indexed** (when the text was last read, or "No text could be read"), **In SharePoint** (when it last changed there, and by whom), and **Payment** and **Notice** days when extracted.
- Warning notes in red when something is out of step: terms read from an earlier version, the file changed in SharePoint since it was read, or the file is no longer in SharePoint.
- For documents filed under a client, the sharing line and button. See [Share with the client](help:docs/share-with-client).

## Other tabs

- **Versions**: [versions and adding a new one](help:docs/versions).
- **Ask**: [ask the document a question](help:docs/ask-document).
- **Activity**: a read-only list of what happened to the document (uploads, versions, sharing and so on), with who and when.

## Good to know

- Opening a file in Word or Excel needs your own SharePoint access, which the platform's permissions say nothing about.
- Title, client, project and category cannot be edited here.
- There is no archive button here; see [Documents](help:docs/index).
