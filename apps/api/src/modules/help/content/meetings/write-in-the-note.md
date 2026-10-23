---
title: Write in the note
summary: Use the note editor, paste images, and use the Ticket, Blocker and Decision buttons in the room.
module: meetings
paths: [/meetings/:id]
capability: meetings.write
keywords: [editor, notes, toolbar, formatting, bold, heading, table, image, paste, checklist, ticket, blocker, decision, collaborative]
updated: 2026-10-23
---

The **Notes** section of a meeting is a shared document. It looks like a word processor: a toolbar above a page. It saves by itself and shows what anyone else, or the assistant, is writing as they write it.

## Before you start

- You need `meetings.write` to edit; the note must be one you can see.
- You can type while the connection is down. A line above the editor says "Reconnecting… what you write now will be saved when it comes back." and nothing you type is lost.

## Steps

1. Open the note ([The meeting note page](help:meetings/meeting-note)) or the [room](help:meetings/run-the-room).
2. Click in the page and write. Markdown shortcuts work: `##` for a heading, `-` for a bullet, `- [ ]` for a checkbox.
3. Use the toolbar for formatting, left to right:
   - headings **H1**, **H2**, **H3**;
   - **Bold**, **Italic**, **Strikethrough**, **Highlight**, **Code**;
   - **Bullet list**, **Numbered list**, **Task list**, **Quote**;
   - **Text colour** and **Highlight colour** (a colour picker; a small × appears beside each when the text at the cursor has a colour, and removes it), and **Clear formatting**;
   - **Horizontal rule**, **Insert table** (3 by 3 with a header row), **Link**, **Insert an image**;
   - **Undo** and **Redo**.
4. To add a link, select text, press **Link**, type the address and press **Apply link**. Leave the address empty and apply to remove the link.

## Add an image

Paste a picture (for example a screenshot) straight into the note, drag it in, or press **Insert an image** and pick one or more files. Images are uploaded and inserted in the order you added them. An image over 10 MB, or a file that is not an image, is refused with a message under the editor.

## Ticket, Blocker and Decision (in the room)

When you write in the [room](help:meetings/run-the-room), three extra buttons sit at the end of the toolbar. Each one asks a question, does something real, and writes a line into the note.

- **Ticket** asks "What needs doing?" and adds an action point (proposed, not yet a task) and a checkbox line in the note. Press **Add it**.
- **Blocker** asks "What is in the way?" Fill in **Blocked on**; optionally choose **Which card**. Choosing a card also marks that card blocked on the board. **Just note it** only writes the line. Press **Record it**.
- **Decision** asks "What was decided?" and writes a quote line starting with **Decision:**. Press **Write it down**.

Cancelling any of the three leaves the note exactly as it was. The line is inserted after the block your cursor is in, never inside a list or quote. These buttons are not on the plain note page; they only exist in the room.

## Good to know

- The page shows a word count under the writing.
- A note has **no version history**. Deleted text cannot be brought back, except with **Undo** while you are still in the editor.
- Notes are stored as Markdown. Anything the format cannot express is not kept, which is why the toolbar offers only what it can store (there is no underline).
- The assistant writes into the same document. It writes under its own heading, **Notes from the meeting**, and will not overwrite a section a person has written in; it appends below instead. See [The meeting assistant](help:meetings/meeting-assistant).
- If you edit the note on the page while a recording stops, both are merged; nothing you typed is overwritten.
