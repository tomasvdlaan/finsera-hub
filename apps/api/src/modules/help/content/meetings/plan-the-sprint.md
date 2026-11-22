---
title: Plan the sprint from a meeting
summary: Create a sprint and pull cards into it from the sprint planning note, while the meeting is running.
module: meetings
paths: [/meetings/:id]
capability: meetings.write
keywords: [sprint planning, create sprint, coming in, backlog, goal, sprint dates, definition of ready]
updated: 2026-10-23
---

A sprint planning meeting can end with a sprint on the board without leaving the note. The **Plan the sprint** section creates the sprint and moves the cards you agreed on into it.

## Before you start

- The note must use the **Sprint planning** type (see [Start a meeting](help:meetings/start-a-meeting)).
- The note must be linked to a **project** (choose one in the header **Project** list, or start the meeting with a project selected).
- The note must not already have a sprint. After a sprint exists, the section turns into a link to that sprint and the form is not offered again, so a second sprint is not created by accident.
- You also need permission to create sprints and edit cards in the project (see [Scrum](help:scrum/index)).

## Steps

1. Open the note and find **Plan the sprint** in the right-hand column.
2. Check the **Name**. It is prefilled as "Sprint N", counting the project's existing sprints.
3. Set **Starts** and **Ends**. They default to the coming Monday and the Sunday two weeks later.
4. Type the **Goal** in one sentence. It is optional.
5. Under **Coming in**, tick the cards that come into the sprint. These are the project's cards that are not yet in a sprint. If the board has a definition of ready, it is shown as "Ready means: …" above the list. An estimate in hours is shown beside each card; a ticked card without an estimate says "no estimate". Below the list you see the card count and the total estimated hours.
6. Press **Create the sprint**.

The button reads **Creating…** while it works. It creates the sprint, moves each ticked card into it one at a time, and then attaches the note to the sprint.

## Good to know

- If the backlog is empty you see "Nothing in the backlog. Cards can be pulled in later from the board."
- If something fails halfway, an error appears above the form. The steps run in order (create the sprint, move the cards, attach the note), so a sprint may already exist and some cards may already be in it while the note is not yet attached. Check the board before trying again, so you do not create a second sprint.
- Once attached, the note's header and the **Sprint** section show a link to the sprint, with its goal. Action points accepted from this note go into that sprint while it is running. See [Action points](help:meetings/action-points).
