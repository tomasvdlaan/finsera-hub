---
title: Documents
summary: What the Documents module is for, how documents are filed, who can do what, and where each task is explained.
module: docs
paths: []
keywords: [documents, files, contracts, library, sharepoint, dms, uploads, filing]
updated: 2026-10-23
---

Documents is the platform's filing cabinet for contracts, quotes, reports and anything else tied to a client or project. Every document is searchable by what is inside it, keeps all its versions, and can optionally be shared with its client in the portal.

## The pages

| Page | What it is for | Guide |
|---|---|---|
| **Documents** (`/docs`) | List, search, filter, upload | [Find and search documents](help:docs/documents), [Upload a document](help:docs/upload) |
| A document (`/docs/documents/:id`) | Read the file, see details, versions, ask it questions, activity | [Read a document](help:docs/document-viewer) |
| **Unfiled** (`/docs/unfiled`) | Files in the library that have no record yet | [File a document that was put in by hand](help:docs/unfiled) |

## Tasks

- [Search inside documents](help:docs/documents)
- [Upload a document](help:docs/upload) and [add a new version](help:docs/versions)
- [Ask a document a question](help:docs/ask-document)
- [Read the summary and extract the terms](help:docs/document-terms)
- [Share a document with its client](help:docs/share-with-client)
- [Keep a SharePoint file and its search text in step](help:docs/sharepoint)
- [File something that was dropped into the library](help:docs/unfiled)

## Who can do what

| You want to | You need |
|---|---|
| View, search, preview, download, check a file against SharePoint, ask a document | `docs.read` |
| Upload documents and versions, extract terms, re-index, open in Word/Excel, share with a client, file unfiled files | `docs.write` |
| Archive a document | `docs.delete` |

## The assistant

The assistant can search documents (by words and by meaning), list documents for a client or project, and pull the passages of one document that best answer a question, for example its notice period. It reads only. It never uploads, files, shares or archives: those are deliberate human acts.

## Good to know

- A document must belong to a client or a project when uploaded. Files filed as "Finsera (no client)" (templates, quotes for prospects) come in through [Unfiled](help:docs/unfiled).
- Nothing is overwritten. A new version is added next to the old ones, which stay downloadable.
- Where the bytes live: files are kept in SharePoint when the platform is connected to it (organised under the client and project), otherwise on the platform itself. Some actions only make sense for SharePoint files and are only shown for them.
- Text is read from the file when it is uploaded and used for search. Formats that cannot be read are only searchable by title.
- The maximum upload is 25 MB.
- There is no archive button on any Documents screen. Archiving exists in the system but has to be done by whoever administers it.
- Documents also appear as a **Documents** card on client and project pages, with an **upload a document here** link. See [Upload a document](help:docs/upload).
- Clients and projects are managed in [Clients and projects](help:crm/index); the client's view of shared documents is in the [portal guides](help:portal/index).
