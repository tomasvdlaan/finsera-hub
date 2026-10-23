---
title: The meeting assistant
summary: What the assistant does during a recorded meeting, how to answer its suggestions, tune how forward it is, and what it can do for you in chat.
module: meetings
paths: [/meetings/:id/room, /meetings/:id]
capability: meetings.write
keywords: [assistant, agent, suggestions, wake word, note-taker, agenda drift, context finder, eagerness, speak aloud, chatty, ask about this meeting, behaviours]
updated: 2026-10-23
---

While a meeting is being [recorded](help:meetings/record-a-meeting), an assistant listens, writes notes, and suggests things. It never changes a board or a record on its own: everything it proposes waits for a person.

## What it does on its own

Four behaviours, all switched on when a note is new:

| Behaviour | What it does | Can speak aloud? |
|---|---|---|
| **wake word** | Answers when somebody addresses it by name ("Finsera", "Vinsera", "Finsara", "assistent"), using the same tools as the chat assistant: quotes, invoices, contracts, hours, past notes. It answers in one short spoken sentence, in the language of the question. If only its name is said it answers "Ja?". | Yes |
| **note taker** | Writes structured notes into the note as the meeting goes on, under the heading **Notes from the meeting**, revising them rather than only adding. | No |
| **agenda drift** | Watches whether the meeting is still on its agenda, and proposes which items have been covered. | Yes |
| **context finder** | Looks up documents that bear on what was just proposed, and shows them next to the suggestion as **On file about this**, without being asked. Links open the document in a new tab. | No |

The note taker only replaces text that is empty, still the template's blank form, or its own. If a person wrote in a section, it adds below instead. It never ticks an agenda item itself.

## Answer a suggestion

Suggestions come in four kinds: **Action point**, **Decision**, **Worth noting** and **Agenda**.

- In the [room](help:meetings/run-the-room) one suggestion at a time appears in front of the dock. Press **Not that** to object; press nothing to keep it. For an agenda suggestion the buttons are **Mark covered** and **Not yet**.
- The dock's **Assistant** tab lists everything waiting, oldest first, with the time each arrived. Proposed action points there offer **Not that** and **Make it a card**.
- Notes are not asked about: they go straight into the note.

What happens to what you leave alone: kept decisions are written under **Decisions** when the recording stops, and kept action points become proposed [action points](help:meetings/action-points) tagged **suggested**. Only agenda coverage can be "accepted" in the live view, because only that does something immediately.

The **Assistant** tab also shows **Where we are** (a running summary), **Decisions heard** and **Left open**. The decisions are written into the note when the meeting ends; correct them there if it misheard.

## Switch behaviours on and off

1. In the room: open the **Assistant** tab and press **what it is doing**. Tick or untick each behaviour, and tick **may speak aloud** to let it talk. A behaviour that could speak shows **silent** while speaking is off.
2. On the note page: open **Recording**. The list is the same, with a description for each.

Speaking aloud only works when a bot is in the call, and is off by default, because a talking bot is a much bigger presence in a client's call. With speaking off, a behaviour that would have spoken stays silent and only proposes quietly; that includes the wake word, so it will not answer questions aloud.

On the note page there is also a **chatty (testing)** box while recording. It lets the bot join in freely: it waits at least 8 seconds between replies and stays silent when it has nothing useful to add. It is a testing aid.

## How forward it is

The note page's **Recording** section has **How forward it is**, with three dials, each **reserved**, **balanced** or **eager**:

- **Writing in the note** — how much it records and how readily it edits.
- **Suggesting work** — how sure it must be before proposing an action point or a decision.
- **Speaking up** — how readily it interrupts. Disabled while **may speak aloud** is off.

A line under each dial says what the chosen level means. The settings are kept with the note, so a meeting you record every week starts where you left it. New notes start from their meeting type's values (for example a stand-up is reserved about notes; a kick-off is eager about notes and action points), otherwise notes are balanced and actions and speech are reserved.

## Ask about this meeting

In the room's **Assistant** tab, **Ask about this meeting** is a small chat about this note. Type, for example, "What did we agree last time?" and send. The thread stays while you move between tabs, and starts afresh for another meeting. If the assistant writes into the note, the room refreshes around it.

## What the assistant can do for you in chat

When you ask the main assistant (see [the assistant](help:shell/assistant)), it can:

- search meeting notes by word and meaning, and list notes for a client or project;
- read a note's headings and text;
- read what was actually said, with speaker names and times, optionally for one keyword. This reads at most 400 turns by default (1000 at most), keeping the beginning, and says if it truncated. An empty result means that meeting was not recorded;
- write Markdown into a note: it appends by default, or replaces one named section. This is recorded in the audit log as written by the assistant. A note has no version history, so replacing a section destroys the old text;
- propose action points from a note. They are recorded as proposed, tagged **suggested**, and never become tasks until you decide.

It cannot create a meeting, finish one, change attendees, or turn a point into a task.

## Good to know

- The assistant needs a recording to do anything live. Without one the Assistant tab says "Nothing recorded. Start recording and it will take notes, watch the agenda and look things up."
- The note taker, agenda drift and context finder check about once a minute while recording, and are skipped while paused. The wake word reacts to each sentence as it is said.
- It uses the same permissions you have: it cannot look up anything you may not open.
- Text the assistant writes into a note is recorded in the audit log, with the text itself, as written by the assistant.
