---
title: Action points
summary: Add, assign, accept as a task, dismiss and carry over the action points that come out of a meeting.
module: meetings
paths: [/meetings/:id]
capability: meetings.write
keywords: [action items, actions, follow-through, make it a task, make it a card, dismiss, carry over, still open, proposed, to do, commitments]
updated: 2026-10-23
---

An action point is something a meeting agreed to do. It starts as a **proposal** and only becomes a task on a board when a person says so. This keeps work that was merely said out loud from silently landing on someone's board, and keeps work that was said and forgotten from feeling handled.

The place to deal with them is the **Follow-through** section of the [meeting note page](help:meetings/meeting-note). Its header shows "N to decide" while something is waiting, and "all settled" when nothing is.

## The life of an action point

| Status | Meaning |
|---|---|
| Proposed | Written down, not decided. Owner and due date can still be changed. |
| Accepted | A task now exists on the board. The task is the record from here on. |
| Dismissed | Decided against. It stays on the note but nothing will chase it. |

## Add one

1. In **Follow-through**, type in **Add an action point…** and press **Add**.
2. In the room, use the **Ticket** button on the toolbar instead (see [Write in the note](help:meetings/write-in-the-note)).

Action points can also arrive on their own: when a recording stops, the assistant's open action suggestions are filed as proposed points tagged **suggested**. See [The meeting assistant](help:meetings/meeting-assistant).

## Decide on the proposed ones

Under **Needs a decision**, each point shows its text, a **suggested** tag if the assistant heard it, and a **carried over** tag if it came from an earlier meeting.

1. Choose an owner in the list (default **Nobody yet**) and, optionally, a due date. Both save at once.
2. Press **Make it a task** to put it on the board, or **Dismiss** to drop it.

Owner and due date can only be changed *before* acceptance. After that, change them on the task.

**What Make it a task does**
- Creates a task titled with the point's text, with the owner and due date you chose and a description "From the meeting note … (date)".
- Puts it on the note's **project** board. If the note has no project, it goes to the **internal** project (made on first use) and the note itself stays unlinked.
- If the note belongs to a sprint that has not finished, the task is added to that sprint; otherwise it goes to the backlog.
- On a retrospective note the task is created as a chore with the retrospective label, so the next retrospective can ask whether it happened.
- Links the note to the task, so the task appears on the note's timeline. Pressing it twice makes one task.

## Your own points

At the top of **Follow-through**, **Yours** lists every point on this meeting assigned to you (not dismissed), with its status, due date and **open the task** once it is a task.

## Carry over what was left open

**Still open from before** lists commitments from earlier meetings about the same project (or client, if the note has no project). They are of two kinds:

- *Never decided.* Press **Carry over** to copy the point onto this meeting, where you can assign, date, accept or dismiss it. The earlier meeting's record is unchanged, and the original stops being counted as open elsewhere. Only undecided points can be carried.
- *On the board, not finished.* These show an **on the board** badge and **open the task**. They cannot be carried, because that would create the same work twice.

## Settled points

**N settled** opens a list of accepted and dismissed points with their status and, for accepted ones, a link to the task. There is no button to undo a dismissal.

## Across all meetings

- On the **Meetings** page, **Still open from past meetings** lists every proposed point from every meeting you may see, oldest meeting first. Each row has **Put on the board**, **Drop** (asks first: "It stays on the note, but nothing will chase it.") and **Open note**. A tag says **Heard by the agent** or **You wrote it**.
- The dashboard card **Came out of a meeting** does the same with **Make a card** and **Drop** (see [Meetings on your dashboard](help:meetings/meeting-widgets)).
- In the [room](help:meetings/run-the-room), the Assistant tab lists proposed points with **Not that** and **Make it a card**.

## Good to know

- **Dismiss on a note has no confirmation question**; **Drop** on the Meetings page does.
- The note page tells you to "Link this note to a project — in the header — before a point can become a task". That is no longer strictly true: without a project the task goes to the internal project. Link a project if the work belongs on a client's board.
- When you press **Mark done** with undecided points you are asked first; they stay proposed afterwards.
- A point nobody decides on for three days becomes an item in the [Inbox](help:insights/insight-rules) ("N action points from … undecided").
- The assistant can propose action points from a note when you ask it in chat; they are recorded as proposed and are never made into tasks for you.
