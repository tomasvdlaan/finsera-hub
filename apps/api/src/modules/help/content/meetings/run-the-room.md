---
title: Run a meeting in the room
summary: Use the full-screen meeting room with its strip, notes stage, whiteboard and dock, and end the meeting properly.
module: meetings
paths: [/meetings/:id/room]
capability: meetings.write
keywords: [room, live meeting, stage, whiteboard, dock, strip, end and review, rejoin, timebox, board, stand-up]
updated: 2026-10-23
---

The room is where you run a meeting while it happens. It takes the whole screen: the note on a page in the middle, a band of glanceable facts above it, and a dock along the bottom that holds everything else. You get there from [Start a meeting](help:meetings/start-a-meeting), from **Open the room** / **Rejoin the room** on a [note](help:meetings/meeting-note), or from **Open the room** on the dashboard's Next meeting card.

## Before you start

- You need `meetings.write`.
- If a recording is already running for this meeting, the room picks it up when you open it, even after a refresh.

## The top bar

- The back arrow (**Leave the room**) returns to the note. **Leaving does not end a recording.** A recording keeps running while you browse elsewhere, and the [recording bar](help:shell/recording-bar) at the top of the page says "Recording", with the time, the number of segments and the cost, and a **Back to the meeting** link.
- The title, the meeting type, a **done** tag if it is finished, the project (a link) or a red "no project linked", and the sprint with "day X of Y" (or "ended <date>, not closed").
- Attendee initials. A faded initial means that person has not consented to being recorded (hover for the name).
- **End & review** while recording, **Mark done** otherwise.

## The strip

A band under the title, always visible:

- **Stage**: **Note** or **Whiteboard**. It only appears if the whiteboard module is installed. See [the whiteboard](help:whiteboard/index).
- **Agenda · X of Y**: segments for covered, current and not yet, and the title of the current item (the first not covered). Click it to open the agenda tab.
- **Running**: the elapsed clock, against the meeting type's timebox, with an **over** tag when passed. Only while recording.
- **Board**: how many cards are open on the project's board and how many are **blocked**, or "no project linked". Click to open the board tab.
- **Waiting on you**: how many suggestions and action points need a decision. Click to open the assistant tab.

## The stage

One thing at a time. **Note** shows the editor, with **Ticket**, **Blocker** and **Decision** buttons added to the toolbar (see [Write in the note](help:meetings/write-in-the-note)). While the assistant is writing, a tag "✦ assistant writing" appears. **Whiteboard** shows the meeting's whiteboard across the whole area; the note is still reachable from the dock's **Note** tab.

## Suggestions

When the assistant suggests an action point, decision, agenda coverage or note, one suggestion at a time rises in front of the dock with a single button to object (**Not that**, or **Not yet** for agenda) and, for agenda items, **Mark covered**. Leaving it alone keeps it. "N more waiting" opens the full list. See [The meeting assistant](help:meetings/meeting-assistant).

## The dock

Closed, the dock shows whether anything is being heard and by what, the last line spoken, "N waiting", the running cost, and **Start recording**. Press the arrow to open it. Tabs:

- **Assistant** — what the assistant is doing and asking, plus **Ask about this meeting**.
- **Transcript** — everything heard so far in this session, with times.
- **Agenda** — tick items covered.
- **Board** — blocked cards first, then each column's open cards with their priority, due or overdue date and a blocked tag. Cards link to the task. With no project it says to link one on the note.
- **Note** — only while the whiteboard has the stage.
- **People** — who is on the list, with **consented**, **declined** or **not asked**, and "was in the call". A red line names anybody who joined the call without having agreed to be recorded.
- **Start recording** / **Recording** — see [Record a meeting](help:meetings/record-a-meeting).

## End the meeting

- **End & review** (while recording): stops the recording, writes the summary into the note, files the assistant's open action suggestions as proposed action points, and takes you to the note to go through them.
- **Mark done** (when not recording): tries to mark the note done, then goes to the note.

Good to know about **Mark done** in the room: if action points are still undecided, finishing is refused, and the room does not say so; you simply land on the note, which is still not done. Use **Mark done** on the note page, which asks the question.

## Good to know

- Stopping a recording that heard nothing writes nothing: no transcript and no changes to the note. The end time is still stamped.
- Timeboxes are advisory. Nothing stops at the limit.
- The room opens with the note's own project board. Link a project on the note to see its board and to have action points land there.
