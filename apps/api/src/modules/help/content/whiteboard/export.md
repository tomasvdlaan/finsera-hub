---
title: Save a board as a picture
summary: Download a whiteboard as a PNG or SVG image to paste into a document or send to someone.
module: whiteboard
paths: [/whiteboards/:id]
capability: whiteboard.write
keywords: [export, download, png, svg, image, save, share board, print]
updated: 2026-10-23
---

Download a board as an image from the toolbar at the top of the board.

## Before you start

The **PNG** and **SVG** buttons are part of the toolbar, which is only shown to people who can draw (`whiteboard.write`). People with read-only access do not get the toolbar and so cannot use these buttons.

## Steps

1. Open the board and, if needed, click **Fit to content** to check everything is on it.
2. Click **PNG** for a picture, or **SVG** for a scalable drawing.
3. Your browser downloads the file, named after the board's title.

## Good to know

- The export contains the whole board, not just what is on screen, and includes a white background.
- PNG is made at double size so it stays legible when pasted into a document without being enormous.
- Nothing is uploaded: the image is produced in your browser.
- The export is a picture. Text in it cannot be searched, and the board stays the editable original.
- Characters in the title that are not allowed in file names are replaced with an underscore.
- For the text on a board in words, ask the assistant: it can read the text and labels (not shapes or drawings).
