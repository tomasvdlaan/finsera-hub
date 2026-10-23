---
title: Agenda and people
summary: Add and tick off agenda items, list who is in the meeting, and give a colleague access to the note.
module: meetings
paths: [/meetings/:id]
capability: meetings.write
keywords: [agenda, attendees, participants, add colleague, access, guest, covered, present, not linked, consent]
updated: 2026-10-23
---

Two small sections on the [meeting note page](help:meetings/meeting-note) keep track of what the meeting is meant to cover and who is in it. The agenda opens by default while a meeting is being prepared or is running; **People** opens while it is being prepared.

## Agenda

1. Open the **Agenda** section. Its header shows how many items are covered (for example "2/5 covered").
2. Tick an item when it has been discussed. Untick it to undo.
3. To add an item, type in **Add an agenda item…** and press **Add**.
4. To drop an item, press **remove** next to it. This happens straight away, without a question.

Agenda items come from the meeting type (see [Meeting types](help:meetings/meeting-templates)). In the [room](help:meetings/run-the-room) you can tick items from the agenda tab, but adding or removing items only works on the note page.

The assistant can *suggest* that an item has been covered (an "Agenda" suggestion with **Mark covered** and **Not yet**), but it never ticks an item by itself.

## People

The **People** section lists everyone who was or will be in the meeting.

**Add a colleague**
1. Choose a name from **Add a colleague…**. Colleagues who are already on the list are not offered.
2. Press **Add and give access**.

This puts the meeting on that colleague's own list straight away; you do not have to share it with them. A colleague that is added twice is added once.

**Add somebody from outside**
1. Type a name in **Somebody from outside?** and press **Add**.

Guests from a client are just a name. They have no access to the platform.

**Badges next to a name**
- **present** — the meeting bot saw this person join the call.
- **has access** — they are a colleague, and this meeting is on their list too.
- **not linked** — the bot saw them but could not match them to an account, so the meeting does not appear on their list. The tip says to add them as a viewer if they should see it; use **Add a colleague** to do that.

**Remove somebody** with **remove**. If they are a colleague, or the bot saw them in the call, you are asked first: for a colleague the meeting disappears from their list until you add them again; for someone the bot saw it removes the record of who was there.

## Good to know

- When a bot is in the call, anyone it sees joining is added to the list automatically, and matched to a colleague by email, or by display name when only one colleague has that name. So the list ends up being who was actually there.
- Being on the list gives a colleague sight of the note, not the right to change it, and does not open a restricted note. See [Who can see a meeting](help:meetings/who-can-see-a-meeting).
- The list also keeps a **consent** value per person ("granted", "declined" or not asked). It is shown in the room (see [Record a meeting](help:meetings/record-a-meeting)), but there is currently no button anywhere on screen to change it.
- Adding, and removing, a colleague is written to the audit log.
