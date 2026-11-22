---
title: Start a meeting
summary: Open a room for a stand-up, planning, review or any meeting, or write up one that already happened.
module: meetings
paths: [/meetings]
capability: meetings.write
keywords: [new meeting, create note, start room, stand-up, blank meeting, name it first, just a note, notulen]
updated: 2026-10-23
---

The top of the **Meetings** page is where every meeting begins. One click opens a room straight away; a small form lets you name the meeting and attach a client first.

## Before you start

- You need `meetings.write`. Without it the buttons are still shown, but creating a note is refused.
- Decide what the meeting is *about*. For a sprint ceremony pick a sprint or project in the **About** list; for a client conversation use **Name it first** and choose the client.

## Start a ceremony in one click

1. On **Meetings**, find the **Start a room** bar.
2. In the **About** list, choose the sprint or project the meeting is about. If there is exactly one running sprint it is already selected; if there is no sprint and only one project, that project is. Choose **Nothing in particular** if it belongs to neither. Sprints that have not started show "(not started)"; finished sprints are not offered.
3. Press one of the ceremony buttons: **Daily stand-up**, **Sprint planning**, **Sprint review** or **Retrospective**. Each shows its timebox in minutes.
4. A note named "<ceremony> — <today's date>" is created with you as the first attendee, and you land in the [room](help:meetings/run-the-room).

Choosing a sprint also links the note to that sprint's project. A note with no project cannot find a board, so action points from it go to the internal project instead (see [Action points](help:meetings/action-points)).

## Start a meeting that is not a ceremony

- **Blank meeting** opens a room now, named "Meeting at HH:MM", with nothing prefilled. Rename it later if it deserves a name.
- **Name it first** opens a form:
  1. Type what the meeting is about under **What is this meeting about?**
  2. Optionally choose a client (the default is **No client**). If that client has exactly one project, the note is linked to it automatically.
  3. Press **Open a room** to go into the room, or **Just a note** to write up a meeting that already happened without opening a room.
  4. Alternatively press a client template button (for example **Client check-in**, **Project kick-off**, **Discovery / intake**) to create the note with that template's skeleton and agenda. These buttons open the room.

The form buttons stay disabled until the title is filled in.

## What a new note contains

A note starts from its template: a skeleton of headings, an agenda, and sometimes prefilled facts. If earlier meetings about the same project (or client) left commitments open, they are added under **Since last time** and an agenda item "What we said we would do" is put first. See [Meeting types](help:meetings/meeting-templates).

## Good to know

- **Just a note** is the right choice for yesterday's meeting. Opening a room stamps a start time and a length on the note, which would be wrong for a meeting that is over.
- If a recording is running anywhere (this browser or a bot in a call), a bar at the top of the page shows it with a **Go to the room** link.
- A button shows **Opening…** while the note is being created; all start buttons are disabled meanwhile.
- If creating fails (for example you lack the capability) the error appears in red under the page title.
