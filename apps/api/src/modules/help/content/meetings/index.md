---
title: Meetings
summary: What the Meetings module is for, the pages in it, and who can do what.
module: meetings
paths: [/meetings]
keywords: [meetings, notes, minutes, stand-up, standup, notulen, room, recording, agenda, action points]
updated: 2026-10-23
---

Meetings keeps one **note** per meeting: the written notes, the agenda, who was there, the action points that came out of it and, if it was recorded, the transcript. A meeting can be run from a full-screen **room** while it happens, with an assistant that listens, takes notes and suggests action points. Nothing the assistant suggests becomes a task unless a person decides so.

You find it under **Meetings** in the **Work** section of the left menu.

## Pages in this module

Start and find meetings

- [Start a meeting](help:meetings/start-a-meeting): the buttons at the top of the Meetings page, and what each one creates.
- [Meeting types and what they start with](help:meetings/meeting-templates): stand-up, planning, review, retrospective, client check-in, kick-off, discovery.
- [Find a meeting](help:meetings/find-a-meeting): the list, the filters, search and the "last 30 days" figures.

One meeting

- [The meeting note page](help:meetings/meeting-note): what is where, and how a note moves from preparing to done.
- [Write in the note](help:meetings/write-in-the-note): the editor, images, and the Ticket, Blocker and Decision buttons.
- [Agenda and people](help:meetings/agenda-and-people): agenda items, attendees, giving a colleague access.
- [Action points](help:meetings/action-points): propose, assign, turn into a task, dismiss, carry over.
- [Plan the sprint from a meeting](help:meetings/plan-the-sprint): create a sprint from a planning note.
- [Who can see a meeting](help:meetings/who-can-see-a-meeting): the visibility rules.

Running a meeting live

- [Run a meeting in the room](help:meetings/run-the-room): the full-screen room, its strip and its dock.
- [Record a meeting](help:meetings/record-a-meeting): bot, microphone or browser tab; pause and stop; what it costs.
- [The meeting assistant](help:meetings/meeting-assistant): suggestions, what it does on its own, how forward it is, and how to ask it things.
- [Read a transcript](help:meetings/transcripts): what was said, kept apart from the note.

Elsewhere

- [Meetings on your dashboard and on a client page](help:meetings/meeting-widgets).

## Who can do what

| You can | Needs |
|---|---|
| Open the list, read notes, transcripts and search | `meetings.read` |
| Create, edit and delete notes; manage agenda, attendees and action points; record; use the room | `meetings.write` |

Every colleague has both by default. Having `meetings.read` is not enough to see every note: a note can be limited to a project team or to named people. See [Who can see a meeting](help:meetings/who-can-see-a-meeting).

## Good to know

- Action points and the assistant's suggestions are **proposals** until someone presses **Make it a task** (note page) or **Make it a card** (room). That is deliberate: a point nobody decided on never reaches a board.
- An undecided action point is noticed by the [Inbox](help:insights/index) after three days.
- The assistant can also search, read and write in meeting notes when you ask it in chat. See [The meeting assistant](help:meetings/meeting-assistant).
