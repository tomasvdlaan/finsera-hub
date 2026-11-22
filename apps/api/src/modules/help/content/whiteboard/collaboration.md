---
title: Work on a board together
summary: See who else is on a board, watch them draw live, and what happens if your connection drops.
module: whiteboard
paths: [/whiteboards/:id]
capability: whiteboard.read
keywords: [collaborate, live, together, peers, cursors, multiplayer, read only, reconnecting, offline, conflict]
updated: 2026-10-23
---

Everyone who opens a board is connected to the same live copy. You see their cursors and their strokes as they happen, and they see yours.

## Before you start

Watching needs `whiteboard.read`. Drawing needs `whiteboard.write`.

## What you see

- **Faces** at the top right: one per person on the board, including you ("you" shows when you hover). Each person keeps the same colour in every session.
- **Cursors** with name labels moving across the canvas, and the shapes someone has selected.
- If you are not connected, the faces are replaced by a small offline marker.

## Good to know

- If two people change the same shape at once, the most recent change to that shape wins. Different shapes never clash.
- If your connection drops, a note reads "Reconnecting — your drawing is being kept." What you draw meanwhile stays on your screen and is merged when the connection returns. Anything you drew while offline wins over older versions of the same shape.
- Read-only viewers connect too. They see everyone draw live, but nothing they do is sent.
- Your undo only undoes your own changes. Other people's work never ends up in your undo history.
- If the connection fails outright you see "The whiteboard connection failed." Reload the page.
- Cursors are shared only while you move the pointer on a board where you can draw.
- Boards open in meetings work the same way: see [the whiteboard in a meeting](help:whiteboard/meeting-whiteboard).
