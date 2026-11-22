---
title: The meeting note page
summary: What is on a meeting note, how the page changes before, during and after the meeting, and how to finish, print or delete it.
module: meetings
paths: [/meetings/:id]
capability: meetings.read
keywords: [meeting note, notulen, mark done, finalise, print, delete note, project link, status, phase, rejoin the room]
updated: 2026-10-23
---

A meeting note is the home of one meeting. The page rearranges itself depending on whether the meeting is still to come, running, being written up, or done, so the most useful part is always first.

## The header

Under the title you see facts about the meeting:

- its status (draft or final), the meeting date, and the meeting type if there is one,
- how long the room ran, and "N m over" if it passed the type's timebox,
- how many agenda items are covered,
- a link to the client, if any, and the sprint, if any,
- a **Project** list. This is how a note is linked to a project; choose **Not linked** to remove the link. A project is needed before action points go to that project's board (without one they go to the internal project).

The buttons at the top right are **Delete**, **Print**, and one of **Open the room**, **Rejoin the room** and **Mark done**, depending on the phase.

## The four phases

| Phase | When | What comes first | Main button |
|---|---|---|---|
| Preparing | Dated in the future, no room used yet | Agenda, then the notes | **Open the room** |
| Running | A room was started and not ended | Recording and the notes; a bar says "This meeting is running." | **Rejoin the room** |
| Writing up | The room ended, or the note is dated today or earlier with no room | **Follow-through** (action points), then the notes | **Mark done** (and a quieter **Open the room**) |
| Done | Marked done | Follow-through, notes, then the transcript | **Print** |

Nothing is hidden in any phase: folded sections (Agenda, People, Recording, Transcript, Discussion, Timeline) are collapsed or opened, but never removed.

## The sections

- **Follow-through** — your own action points first, what earlier meetings left open, what needs a decision, and what is settled. See [Action points](help:meetings/action-points).
- **Notes** — the editor. See [Write in the note](help:meetings/write-in-the-note).
- **Agenda** and **People** — see [Agenda and people](help:meetings/agenda-and-people).
- **Recording** — start or follow a recording and set how forward the assistant is. See [Record a meeting](help:meetings/record-a-meeting).
- **Transcript** — see [Read a transcript](help:meetings/transcripts).
- **Sprint** — a link to the sprint, or on a sprint-planning note the **Plan the sprint** form ([Plan the sprint from a meeting](help:meetings/plan-the-sprint)).
- **Discussion** and **Timeline** — comments on the meeting and its history, the same as on other records.

## Mark a meeting done

1. Press **Mark done** (shown in the writing-up phase).
2. If action points are still undecided, a confirmation asks "Mark done with N point(s) still undecided?" Choose **Mark done anyway** to continue, or cancel and decide them first.

Marking done publishes a "meeting note finalised" event and changes the status to final. It is **a signal, not a lock**: you can still edit the notes afterwards, and the screen offers no way to set it back to draft. Undecided points stay proposed and do not become tasks.

## Print

**Print** (writing-up and done phases) opens the browser's print dialog with every folded section opened, so the minutes include the agenda, people and transcript. Sections are folded again afterwards.

## Delete a note

**Delete** asks "Delete this note?" and says the transcript, agenda and any AI notes go with it. This cannot be undone. Needs `meetings.write`.

## Good to know

- The notes text is a shared document: it saves as you type and shows other people's typing live. Refreshing the page does not lose it.
- A meeting about to be marked done from the [room](help:meetings/run-the-room) goes through the same check.
- Changing the **Project** takes effect immediately.
