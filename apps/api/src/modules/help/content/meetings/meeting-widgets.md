---
title: Meetings on your dashboard and on a client page
summary: The dashboard cards Recent meetings, Came out of a meeting and Next meeting, the Meetings card on a client page, and the meeting card in chat.
module: meetings
paths: []
keywords: [dashboard, widget, recent meetings, next meeting, came out of a meeting, client page, chat card, open the room]
updated: 2026-10-23
---

The Meetings module adds three cards you can place on your dashboard, one to every client's page, and a card the assistant shows when it cites a meeting. You arrange the dashboard as described in [Arrange your dashboard](help:shell/arrange-dashboard).

## Recent meetings

Dashboard card showing the latest notes you may see, newest first, each a link with its date. A setting, **How many to show**, chooses between 3 and 15 rows (default 5). The card's title links to the **Meetings** page. Empty state: "No meetings yet." Needs `meetings.read`.

## Came out of a meeting

Dashboard card for action points that were proposed and never decided: "N proposed, none decided". It shows the first four, oldest meeting first, each with the note it came from and its due date.

- **Make a card** puts the point on the board (see [Action points](help:meetings/action-points)).
- If the note has no project, the row first asks **Which project?** in a small list. Choosing one links the note to that project, then **Make a card** appears.
- **Drop** dismisses the point straight away, with no question.

Empty state: "Every action point from a meeting has been decided on." Needs `meetings.write`.

## Next meeting

Dashboard card showing the next meeting note dated today or later (soonest first): "Today" or the date, and the title. **Open the room** goes straight into the [room](help:meetings/run-the-room) and **Notes** opens the note page. It is a schedule only because notes are created before the meeting happens; it does not read a calendar. Empty state: "Nothing scheduled." Needs `meetings.write`.

## Meetings on a client page

The **Meetings** card on a client's page lists up to six recent meetings with that client, each a link with its date. If there are none: "No meetings recorded — start a note." See [CRM](help:crm/index) for the client page itself.

## The meeting card in chat

When the assistant cites a meeting note, it shows a card with a "meeting" badge, the title, the date and, if any, "N action point(s) awaiting a decision", with an **open** link.

## Good to know

- Cards only appear for people with the capability named above; they are simply missing otherwise.
- A note that is restricted or on a project you are not part of never shows up in any of these. See [Who can see a meeting](help:meetings/who-can-see-a-meeting).
