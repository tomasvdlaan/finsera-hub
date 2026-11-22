---
title: Whiteboards
summary: What whiteboards are for, who can open or draw on them, and where each task is explained.
module: whiteboard
paths: []
keywords: [whiteboard, drawing, sketch, canvas, board, diagram, excalidraw, stickies]
updated: 2026-10-23
---

A whiteboard is a shared, live drawing surface for sketching something out, drawing over a screenshot, or capturing what was on the wall in a meeting. Several people can draw on the same board at the same time and see each other's cursors.

It is a working surface, not a filed record, so it lives under **Whiteboards** in the **Work** part of the rail, after Meetings and the SCRUM board. Do not confuse it with the SCRUM **Board**.

## The pages

| Page | What it is for | Guide |
|---|---|---|
| **Whiteboards** (`/whiteboards`) | The library of boards and the **New whiteboard** button | [Find and start a whiteboard](help:whiteboard/boards) |
| A board (`/whiteboards/:id`) | The canvas itself, full window | [Draw on a board](help:whiteboard/board-editor) |

## Tasks

- [Start a whiteboard and find an old one](help:whiteboard/boards)
- [Draw, write and move things](help:whiteboard/board-editor)
- [Paste screenshots and put links on shapes](help:whiteboard/images-and-links)
- [Work on a board together](help:whiteboard/collaboration)
- [Save a board as a picture](help:whiteboard/export)
- [Use the whiteboard inside a meeting](help:whiteboard/meeting-whiteboard)
- [Rename a board](help:whiteboard/board-editor)

## Who can do what

| You want to | You need |
|---|---|
| Open, view and export a board; see others draw | `whiteboard.read` |
| Create a board, draw, rename, paste images | `whiteboard.write` |
| Archive a board | `whiteboard.delete` |

Without `whiteboard.write` a board opens read-only: it shows a **read only** badge, the toolbar is not offered, and the title cannot be renamed. You still see other people drawing live.

## The assistant

The assistant can list whiteboards (most recently drawn on first, optionally only those from one meeting) and read the text on one. It reads text and sticky-note labels in reading order, top to bottom and left to right, and the labels on arrows that join them. It cannot see shapes or drawings, and it cannot draw: it never writes to a board.

## Good to know

- There is also a **Recent whiteboards** block you can add to your dashboard. It shows the boards most recently drawn on; you choose how many (3 to 15, default 5).
- There is no archive button on any screen. Archiving exists in the system but must be done by whoever administers it.
- Boards are saved continuously. There is no Save button and no file to open: the board is the file.
- Boards are not shown to clients in the portal.
- Excalidraw (the drawing engine) has its own menus and shortcuts; some of them, such as opening or saving a drawing file and switching theme, are switched off here.
