---
title: Find a meeting
summary: Read the meetings list, filter it, search what was discussed, and use the last-30-days figures.
module: meetings
paths: [/meetings]
capability: meetings.read
keywords: [search meetings, list, filter, recorded, with clients, earlier, this week, notulen zoeken, hours in meetings]
updated: 2026-10-23
---

The **Meetings** page lists every meeting note you may see, newest first, with a search box and a few figures beside it.

## The list

The card titled **Meetings** is split into **This week** (the last seven days, not the calendar week) and **Earlier**. Each row shows:

- the date as a small badge, and the title (a trailing date in a ceremony's name is dropped, because the badge already says it),
- tags: **Recorded** if it was transcribed, the client's name, and **Final** if it was marked done,
- the first real sentence of the notes, or "No notes written — nothing was captured in this room." when the note is still empty,
- **Actions** (the number of action points, or "N open" while some are undecided) and **Length** (how long the room was open; a dash if no room was ever used),
- faces (initials) of the attendees.

Click a row to open the [note](help:meetings/meeting-note).

## Filter

Above the list: **All**, **Recorded** (only meetings that have a transcript) and **With clients** (only notes linked to a client). If nothing matches you see "No meetings match that filter."

## Search what was discussed

1. In the **Search what was discussed** card, type a question or keywords, for example "what did we promise about the migration?".
2. Press **Search**. Each hit shows the title, the date, whether it matched **by word** or **by meaning**, and a snippet with the matched words in bold.
3. Empty the box to go back to the hint text.

Search covers note titles and bodies. **Transcripts are deliberately left out**, because a long transcript would bury the note it belongs to. To search what was literally said, ask the assistant (see [The meeting assistant](help:meetings/meeting-assistant)). Matching by meaning only works when embeddings are configured; otherwise you get word matches only. At most ten results are shown.

## Last 30 days

The **Last 30 days** card adds up the time spent in rooms over the past thirty days: total hours, the number of meetings, and a bar per kind (**Stand-ups**, **Planning, review & retro**, **Client conversations**, **Everything else**). It says how many meetings never opened a room, and how much time "produced no written notes". Only meetings held in a room count towards the hours; notes written up afterwards have no length.

## Good to know

- You only see notes you are allowed to see; an invisible note looks exactly like one that does not exist. See [Who can see a meeting](help:meetings/who-can-see-a-meeting).
- **Earlier** shows at most the twelve most recent older meetings. To reach anything older, use search, or open the client's own page, which lists its recent meetings (see [Meetings on your dashboard and on a client page](help:meetings/meeting-widgets)).
- If one of the page's lists fails to load it shows empty instead of breaking the whole page.
