---
title: Versions of a document
summary: See every version of a document, view or download an old one, and add a new version.
module: docs
paths: [/docs/documents/:id]
capability: docs.write
keywords: [version, v2, new version, replace file, old version, history, revision, upload new version]
updated: 2026-10-23
---

Nothing in Documents is overwritten. Each upload of a changed file adds a version and the earlier ones stay available. Versions are on the **Versions** tab of [a document's page](help:docs/document-viewer).

## Before you start

Viewing and downloading versions needs `docs.read`. Adding a version needs `docs.write`.

## Steps: look at an older version

1. Open the **Versions** tab. The number beside it shows how many exist once there are two or more.
2. Click **Show** on a version to preview it in the centre pane. The row then says "showing".
3. Click **Download** on any row to download that version's file.

## Steps: add a new version

1. At the bottom of the **Versions** tab, under **Add vN**, click the file chooser and pick the file.
2. Click **Upload new version**.

The page jumps back to the newest version, which becomes the current one.

## How versions come about

Each row says where it came from:

- no note: uploaded here;
- **picked up from SharePoint**: somebody changed the file in SharePoint and the platform caught up (see [SharePoint](help:docs/sharepoint));
- **filed from the library**: the file was already in the library and adopted (see [Unfiled](help:docs/unfiled)).

## Good to know

- For SharePoint files a new version replaces the content of the same SharePoint file, so it becomes a SharePoint version and links people pinned in Teams keep pointing at the current document.
- The text is re-read for search and the "Read from the document" summary is rewritten. Extracted terms stay tied to the version they were read from and are marked as stale until you [extract again](help:docs/document-terms).
- A new version does not change the title, client or project.
- The 25 MB limit applies to each upload.
