---
title: Draw on a board
summary: The drawing tools, how to rename a board, undo, change the background and fit the board to the screen.
module: whiteboard
paths: [/whiteboards/:id]
capability: whiteboard.write
keywords: [draw, shapes, rectangle, ellipse, arrow, text, sticky note, eraser, undo, rename board, background colour, toolbar, fit to content]
updated: 2026-10-23
---

A board takes the whole window so there is room to draw. Everything you draw is saved and shared as you go.

## Before you start

You need `whiteboard.write` to draw, rename or change anything. With only `whiteboard.read` the board is read-only (a **read only** badge in the top bar).

## The top bar

- **← Whiteboards** takes you back to the library.
- The title. Click it to rename (see below).
- Small coloured faces on the right show who is on the board. See [working together](help:whiteboard/collaboration).

## Steps: draw

The toolbar has one button per tool. Hover for its name:

| Tool | Use |
|---|---|
| **Select** | Pick, move and resize things |
| **Draw** | Freehand pen |
| **Rectangle**, **Ellipse**, **Diamond** | Shapes |
| **Arrow**, **Line** | Connect or point |
| **Text** | Write text, for labels and notes |
| **Image** | Add a picture. See [screenshots and links](help:whiteboard/images-and-links) |
| **Eraser** | Remove things |

1. Choose a tool.
2. Click or drag on the canvas.
3. Select a shape to see its style options (stroke, fill, width, opacity, layer order), which appear in the drawing engine's own panel.

Also in the toolbar:

- **Fit to content** brings everything into view.
- **PNG** and **SVG** download the board. See [save a board as a picture](help:whiteboard/export).

## Steps: undo

Undo and redo are in the bottom-left corner of the canvas, and the usual keyboard shortcut (Cmd+Z on a Mac) works. Undo only undoes your own work, never other people's.

## Steps: rename a board

1. Click the title in the top bar.
2. Type the new name and press Enter (or click elsewhere). Escape cancels.

An empty title is ignored. The new name shows in the library, search and the assistant.

## Steps: change the background colour

Changing the canvas background colour is the one canvas setting left switched on. It is offered in the drawing engine's style panel at the left of the canvas when nothing is selected. The colour is saved with the board and shared with everyone on it.

## Good to know

- Nothing needs saving. If you lose your connection a notice reads "Reconnecting — your drawing is being kept." and your strokes are sent when the connection returns.
- If you lack the write capability, clicking the title does nothing, and the toolbar is not shown.
- Pasted video or website links are not turned into embedded pages. A link stays a link. See [screenshots and links](help:whiteboard/images-and-links).
- The drawing engine's own menu and options for opening or saving a drawing file, exporting, and switching the theme are switched off, as are its shape library and welcome screen. The board is the file, and the theme follows the platform.
- Zoom controls sit next to undo and redo in the bottom-left corner.
