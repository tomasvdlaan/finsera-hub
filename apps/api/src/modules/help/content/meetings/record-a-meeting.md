---
title: Record a meeting
summary: Send a bot to a call, or listen through a microphone or a browser tab; pause, stop, and what is saved afterwards.
module: meetings
paths: [/meetings/:id/room, /meetings/:id]
capability: meetings.write
keywords: [record, recording, bot, teams, microphone, tab, transcribe, transcription, pause, stop, cost, notulist, consent, audio]
updated: 2026-10-23
---

Recording turns what is said into a transcript and lets the [meeting assistant](help:meetings/meeting-assistant) take notes and make suggestions. You can start it from the room's dock or from the **Recording** section of the note page; both do the same.

## Before you start

- You need `meetings.write`.
- **Tell the people in the meeting that it is being recorded.** The bot joins under a visible name (by default **Finsera Notulist**), but the platform no longer blocks recording until everyone has "consented", and it has no button to ask for consent. Anyone the bot sees join the call who was never recorded as consenting is flagged under **People** in the room.
- A recording needs a transcription model configured on the server (Gemini only; no other provider is allowed for meeting audio). If it is missing you see a message naming the problem and recording does not start. Sending a bot also needs the meeting-bot service to be set up; otherwise you see "RECALL_API_KEY is not set". Ask an administrator.

## Start recording

1. Open the dock's **Start recording** tab in the [room](help:meetings/run-the-room), or the **Recording** section on the note page.
2. Choose an **Audio source**:
   - **Send a bot to the call** (on the note page: "Send a bot to the meeting"). Paste the **Meeting URL** ("Paste the meeting link") and press **Send the bot**. A named bot joins the call so everyone can see it, and each person's audio arrives separately, which is what makes "who said what" reliable. Someone may need to admit it from the lobby.
   - **This microphone** ("Microphone or virtual device" on the note page). Optionally choose an **Input device** (default **Default input**). Press **Start listening**. Your browser asks for microphone permission.
   - **A browser tab** ("A browser tab (Teams in the browser)"). Press **Start listening** and share the tab with its audio.
3. Watch the status. For a bot: "Sending the bot…" or "Bot on its way", then "The bot has been sent, and is not in yet" (it may be in the lobby), then "Recording — the bot is in the call". The clock starts when the bot gets in.

Only one recording can run per meeting. A second attempt is refused with "This meeting is already being captured".

## While it runs

The panel shows the **Source**, **Started**, **Joined the call**, how many segments have been **Heard**, the **Cost**, who is **In the call**, and anything the assistant said aloud (**It said**).

- **Pause listening** stops the assistant hearing anything, for a private aside. Nothing is transcribed, stored or charged while paused, and the transcript shows a "paused" marker. **Resume listening** carries on in the same session. The browser lets go of the microphone or tab, the bot is muted where the call allows it, and anything that still arrives is dropped.
- **Share audio again** appears when "No audio reaching it". This happens after a page reload: a microphone comes back by itself, but a shared tab always needs you to share it again.
- **Stop recording** ends the recording and writes the results, without leaving the room. **End & review** in the room's top bar does the same and then takes you to the note.

You can leave the room, or the page, and the recording carries on. It stops only when you stop it, the call ends, or the bot is removed. A bar at the top of every page shows that a recording is running (see [The recording bar](help:shell/recording-bar)).

## What stopping saves

- The transcript, as its own record (see [Read a transcript](help:meetings/transcripts)), with its cost.
- A **Summary**, **Decisions** and **Open questions** under those headings in the note. If you already wrote in one of them, the machine's text is added below yours rather than replacing it. The assistant's running notes sit under **Notes from the meeting**.
- The assistant's open action suggestions, as proposed [action points](help:meetings/action-points) tagged **suggested**.
- The note's start and end time, which gives it a length on the Meetings page.

If nothing was heard, no transcript is saved and the note is unchanged; only the end time is stamped.

## Good to know

- Audio is transcribed and then discarded. It is never stored.
- The cost is shown live ("under € 0,01" for very short meetings) and recorded on the note after it ends.
- If the bot cannot join you see "The bot could not join: …" and nothing is recorded.
- A line "Last recording — Stopped: <reason>" explains a recording that stopped by itself.
- The assistant speaking aloud is only possible with the bot, and is off unless you allow it. See [The meeting assistant](help:meetings/meeting-assistant).
- Each individual sentence that fails to transcribe is lost without ending the meeting.
