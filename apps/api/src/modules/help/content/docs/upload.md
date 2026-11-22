---
title: Upload a document
summary: File a new document against a client or project, from the Documents page or from the client or project page.
module: docs
paths: [/docs]
capability: docs.write
keywords: [upload, file something, add document, attach file, contract upload, category, title, 25 MB]
updated: 2026-10-23
---

Uploading creates a document with its first version, reads the text for search, and files it under a client and optionally a project.

## Before you start

You need `docs.write`. The form is visible to everyone who can open the page; without the capability the upload is refused with a "Missing capability" message.

## Steps: from the Documents page

1. Scroll to the **File something** card at the bottom of **Documents**.
2. Click the file chooser and pick the file.
3. Optionally type a **Title**. If you leave it empty the file name is used.
4. Choose the **Client**. Optionally choose a **Project**; the list shows only that client's projects.
5. Optionally type a **Category** (for example contract or proposal).
6. Click **Upload**.

You must choose a client or a project, otherwise you see "Pick a client or a project — a document with no home is unfindable." The page then shows your document in the list.

## Steps: from a client or project page

On [a client's page](help:crm/client-profile) or [a project's page](help:crm/project-detail), the **Documents** card lists what is filed there.

1. Click **upload a document here**.
2. Choose the file, optionally type a title, and click **Upload**. (This short form has no category field.)

The client or project is already decided, so you are not asked for it.

## What happens

- The file is stored (in SharePoint under the client and project when connected, otherwise on the platform).
- Its text is read and indexed for search. If a model is configured and there is enough text, a short summary is written automatically.
- A "document uploaded" event is recorded and the document shows on the client's and project's timelines.

## Good to know

- The limit is 25 MB per file and empty files are refused.
- A SharePoint name clash is resolved by SharePoint renaming the file; the document keeps the name that was actually stored.
- Files whose text cannot be read (some scans and formats) are only searchable by title.
- The title, category, client and project cannot be edited afterwards from the screen.
- To replace the content of a document, add a [new version](help:docs/versions) instead of uploading again.
