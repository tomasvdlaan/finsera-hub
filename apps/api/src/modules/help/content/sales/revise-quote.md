---
title: Revise a sent quote
summary: Create a new draft version of a quote that is already sent, leaving the original untouched.
module: sales
paths: []
capability: sales.quotes.write
keywords: [revision, revise, new version, change quote, supersedes, v2]
updated: 2026-10-23
---

A sent quote is frozen because the client has read it. To change anything you create a **revision**.

## Steps

1. Open the sent quote and click **create revision**.
2. You land on a new draft. Its title, introduction, notes, lines, hourly rate and billing model are copied; the header shows **supersedes vN** and a **version N+1** badge.
3. Edit it ([Edit a draft quote](help:sales/edit-draft-quote)) and then [send it](help:sales/send-quote). It gets its own number.

## Good to know

- Only sent quotes can be revised, and the revision button only appears while the quote is **sent** (not after accepted or rejected).
- The original is not changed and is **not** automatically rejected: it stays **sent** until you decide it. Once the client picks a version, mark the other one rejected so the pipeline numbers are right.
- The revision's **Valid until** is reset to 30 days from today.
- A "supersedes" link between the two versions is recorded.
