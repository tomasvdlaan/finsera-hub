---
title: Share a document with its client
summary: Let the client see a document in their portal, or stop sharing it.
module: docs
paths: [/docs/documents/:id]
capability: docs.write
keywords: [share, portal, client can see, unshare, stop sharing, visibility, client access]
updated: 2026-10-23
---

A document filed under a client is private to Finsera until you share it. Sharing is what makes it visible to that client in their portal.

## Before you start

- You need `docs.write`.
- The document must be filed under a client. Documents filed only under a project, or at Finsera level, show no sharing line.

## Steps

1. Open the document and stay on the **Details** tab.
2. Find the line near the bottom. It reads either "Not shared with the client" or "(Client) can see this in the portal".
3. Click **Share with client**, or **Stop sharing** if it is already shared.

## Good to know

- Both directions are written to the audit log, because this is the action that makes a file leave the building.
- The client sees it only inside the portal, through the platform. No SharePoint link is created, so a client never gets a door into the library. The portal still applies its own rules about which of the client's people see what; see the [portal guides](help:portal/index).
- What the client sees about a shared document is its title, category and date, plus the file itself.
- Moving or re-filing a document under another client is not possible from the screen.
