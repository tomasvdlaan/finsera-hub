---
title: Read a transcript
summary: Find what was literally said in a recorded meeting, per recording, with speakers and times.
module: meetings
paths: [/meetings/:id]
capability: meetings.read
keywords: [transcript, what was said, verbatim, speaker, recording, backfilled]
updated: 2026-10-23
---

A recorded meeting keeps two different things: the written **note**, and a **transcript** of what was said. They are stored apart on purpose. A transcript is thousands of words of half-sentences, and mixed into the note it used to drown out the decisions the note was meant to hold.

## Steps

1. Open the [meeting note](help:meetings/meeting-note) and find the **Transcript** section. It is folded; the closed header is "Transcript". Inside, open **What was said**.
2. The first time you open it, the transcripts are loaded ("Loading…").
3. Each recording of the meeting is its own block: **Recording 1**, **Recording 2** and so on, with the start date and time, and a badge: **bot**, **browser**, or **moved from the note** (an old transcript that used to live in the note body; its start time is the note's rather than the recording's).
4. Rows show the time since the recording started, the speaker in bold (when the source knew who spoke) and the words.

The same block is under the **Start recording** tab in the room, beside the thing that captured it.

If the meeting has not been recorded you see "This meeting has not been recorded. Start a recording above and what is said ends up here, separately from your notes."

## Good to know

- A transcript is read-only; there is no way to edit or delete one on screen. Deleting the note deletes its transcripts.
- Meeting search does not look inside transcripts. To find a word in a recorded meeting, ask the assistant, which can search one meeting's transcript for a keyword. See [The meeting assistant](help:meetings/meeting-assistant).
- Transcripts are machine-produced and can mishear names and numbers. A pause is shown as a break, not as something somebody said.
- You can only open a transcript of a note you can see. See [Who can see a meeting](help:meetings/who-can-see-a-meeting).
- The cost of transcribing is shown under the **Recording** section ("Transcribed … · cost …").
