---
title: Filter and group the board
summary: Narrow the board to a person, type, priority, label or problem cards, and split it into lanes.
module: scrum
paths: [/board]
capability: scrum.tasks.read
keywords: [filter, group, swimlane, lanes, assignee, blocked, overdue, stale, subtasks, label, search board]
updated: 2026-10-23
---

Filters and lanes help you read a board with many cards. They only change what you see.

## Filter

1. Click **Filters** in the toolbar (or press **f**). The panel opens with the first picker focused.
2. Use any of:
   - **Anyone** / **Unassigned** / a person (**Filter by assignee**)
   - **Any type** (**Filter by type**)
   - **Any priority** (**Filter by priority**)
   - **Any label**: only offered when the cards in view carry labels
   - **Blocked**: cards with a blocking reason
   - **Overdue**: unfinished cards past their due date
   - **Sitting 5d+**: unfinished cards that have been in their column five days or more
   - **Subtasks**: also show subtasks as cards
3. Click **Clear** to remove all filters. **Esc** also clears them when no panel is open.

The **Filters** button shows how many are on. If nothing matches you see "Nothing matches those filters."

## Group into lanes

Use the **Group** picker: **No lanes**, **By person**, **By priority**, or **By type**. Each lane repeats all the columns for its subset.

- **By person** shows an avatar and name per lane, with **Unassigned** last.
- **By priority** goes from urgent down to low. **By type** follows story, bug, chore, spike.
- Empty priority and type lanes are left out. The number beside a lane name is how many cards it has.

## Good to know

- Nothing is saved. Reloading or leaving the page resets filters and lanes, on purpose: a forgotten filter makes the board lie.
- Filters apply to the cards already in the current view (**This sprint**, **Backlog** or **Everything**). See [Backlog](help:scrum/backlog).
- A column's WIP count ignores filters. When a filter hides cards in a limited column it reads "2 / 3 · 1 shown".
- Subtasks are hidden by default because they live on their parent card.
- There is no free-text search on the board. Use the global search for finding a card by name.
- Column estimates (sum of hours) reflect the cards shown.
