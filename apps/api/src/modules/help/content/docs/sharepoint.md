---
title: Keep a SharePoint file and its search text in step
summary: Check whether a SharePoint file has changed, re-index it, and open it in Word or Excel.
module: docs
paths: [/docs/documents/:id]
capability: docs.write
keywords: [sharepoint, check, re-index, sync, out of date, stale, open in word, excel, missing file, edit]
updated: 2026-10-23
---

When the platform is connected to SharePoint, documents live there and colleagues can also change them directly in Word, Excel or Teams. Nothing watches for those changes. Instead the platform tells you when it last looked, and you refresh it yourself. These buttons are in the header of [a document's page](help:docs/document-viewer) and only appear for files stored in SharePoint.

## Before you start

- **Check SharePoint** needs `docs.read`.
- **Re-index** and **Open in Word / Excel / PowerPoint** need `docs.write`.

## Steps: is it current?

1. Click **Check SharePoint**. This is a cheap look at SharePoint and does not read the file.
2. On the **Details** tab, the **In SharePoint** line shows when and by whom it last changed there. If that is later than **Indexed**, a red note says search and Ask still use the older text.

## Steps: catch the text up

1. Click **Re-index**. The button is highlighted when the file is known to be out of date.
2. If the file changed, a new version is added, labelled **picked up from SharePoint**, and its text is read again. If it did not change, nothing new is created (a file that never got indexed is indexed now).

## Steps: edit the file

1. Click **Open in Word**, **Open in Excel** or **Open in PowerPoint** (depending on the file).
2. The file opens in a new tab in the Office web app.

If it cannot open, a message says why instead of opening a tab that fails.

## Good to know

- "Out of date" is only as fresh as the last **Check SharePoint** on that document. The list on the Documents page uses the same stored stamp, and search results carry an **out of date** marker.
- If the file was deleted or moved out of the library the page says so ("no longer there"). Nothing here is deleted: the record, text and history stay and search keeps working from what was read. Checking again clears the note if the file returns.
- Opening in Word needs your own SharePoint access, which is separate from platform permissions. Only Word, Excel and PowerPoint formats get the button, and not if the file is missing.
- For files stored on the platform instead of SharePoint, the check button does not appear and a file cannot be stale. **Open in…** is not available.
- Whenever a version is added from SharePoint, a "document synced" event is recorded.
