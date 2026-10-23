---
title: Paste screenshots and put links on shapes
summary: Draw over a screenshot, and attach a link to any shape so it opens a task, client or page.
module: whiteboard
paths: [/whiteboards/:id]
capability: whiteboard.write
keywords: [screenshot, paste image, picture, drag image, link, url, shape link, embed, youtube]
updated: 2026-10-23
---

A board can hold pictures, and any shape can carry a link. Both are done with the drawing engine's own controls.

## Before you start

You need `whiteboard.write` to add pictures. Anyone who can open the board sees them and can follow links.

## Steps: add a picture

Use any one of these:

1. Paste a copied screenshot onto the canvas (Cmd+V on a Mac, Ctrl+V on Windows).
2. Drag an image file onto the canvas.
3. Choose the **Image** tool in the toolbar and pick a file.

Then draw over it with the other tools.

Others on the board see the picture a moment later: only a small reference travels live, and their browser fetches the image itself.

## Steps: attach a link to a shape

1. Select the shape.
2. Click the link (chain) button the drawing engine shows for the selection and paste the address.
3. Click the link icon on the shape to follow it.

A link to a page in this platform (for example a task) opens inside the app without leaving the board's tab. A link to an outside site behaves like any other link.

## Good to know

- Only images are accepted, up to 10 MB each. Larger ones, or other file types, are refused.
- Pasting the same screenshot again does not store a second copy.
- Images are part of the board. They are not filed in [Documents](help:docs/index).
- Pasting a YouTube, Figma or similar address does not embed that page in the board. It stays a link, on purpose, so the board does not load other websites.
- If a picture fails to load for someone it shows as a placeholder; it retries on the next change to the board.
- Anyone holding a picture's direct address can open it without signing in, because the address cannot be guessed but is not otherwise protected. Do not paste anything onto a board that you would not want to leak through a shared URL.
