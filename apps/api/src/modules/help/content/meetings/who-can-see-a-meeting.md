---
title: Who can see a meeting
summary: The rules that decide which colleagues see a meeting note, its action points and its search results.
module: meetings
paths: []
capability: meetings.read
keywords: [visibility, access, permissions, private, restricted, project team, attendees, admin, confidential, salary review]
updated: 2026-10-23
---

Not every colleague sees every meeting. The same rule is applied everywhere a note could show up: the list, the note itself, search, the open-actions lists and the "still open from before" ledger. A note you may not see looks exactly like a note that does not exist.

## The rule, in order

1. **Restricted notes** are seen only by the person who wrote the note and by people named as viewers. Not project members, and not administrators. Access is granted by naming a viewer, which is recorded with who granted it.
2. **Administrators** see every note that is not restricted.
3. A note with **no project** is seen by every colleague. A stand-up nobody linked should not quietly vanish from the team that held it.
4. A note **linked to a project** is seen by that project's team.
5. **Anyone who was in the room** sees it, whatever the project says. People are matched to the attendee list when the meeting bot sees them join, or when you add them with **Add a colleague** (see [Agenda and people](help:meetings/agenda-and-people)).
6. The **author** always sees their own note.

Seeing a note is not editing it: changing a note, its agenda and its action points needs `meetings.write`. Being on the attendee list never opens a restricted note, because attendance is guessed from a display name on a call roster, which is too weak a signal for a note that is meant to stay shut.

## What this means for you

- If you cannot find a meeting you were in, check that you are on its attendee list, or that you are on the project.
- If you link a note to a project, its team can see it. Unlinking it makes it visible to everyone, unless it is restricted.
- Action points and search results from notes you cannot see never show up for you.

## Good to know

- The platform has a restrict switch and a viewer list for notes, with an audit trail, but **there is currently no button on screen for either**. They cannot be used from the note page.
- The picture-upload address for pasted images is unguessable but not behind a login: anyone who has the exact link can open the image. Treat pasted screenshots accordingly.
