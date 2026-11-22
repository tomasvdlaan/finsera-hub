---
title: Add a card
summary: Create a card from the board in one line, using shortcuts for priority, assignee, label, estimate and type.
module: scrum
paths: [/board]
capability: scrum.tasks.write
keywords: [new task, create card, quick add, shortcuts, priority, assignee, label, estimate, bug, add task]
updated: 2026-10-23
---

The **+ Task** panel on the board creates a card from a single line of text. It also understands a few shortcut words.

## Steps

1. On the board, click **+ Task** (or press **n**).
2. Type the title in **New task**.
3. Optionally change the type in the **Task type** picker (story, bug, chore, spike).
4. Click **Add**.

The card lands at the bottom of the first column of the board (To do by default). The field is cleared so you can add the next.

## Shortcut words

Type them anywhere in the line. They are removed from the title:

| Write | Meaning |
|---|---|
| `!low` `!normal` `!high` `!urgent` | Priority |
| `@anna` | Assignee: matches the start of any word in a person's name |
| `#website` | A label (free text) |
| `~2h` `~90m` `~1,5h` | Estimate |
| `bug` (or `story`, `chore`, `spike`) as the **last** word | Type |

Example: `Fix login redirect !high @anna #auth ~2h bug`.

Under the field you see what was understood, as the title in bold and a chip for each shortcut. What is left is exactly the title you will get. A shortcut that is not recognised stays in the title: for example an `@name` that matches nobody.

## Good to know

- **The type word only works as the last word**, and only when there is more than one word. "Fix the bug in checkout" stays a story with that title.
- A type word in the line wins over the **Task type** picker.
- While **This sprint** is selected on a board with a running sprint, the new card goes straight into that sprint. Otherwise it goes to the backlog.
- You cannot set a description or due date here. Open the card for those, see [Open and edit a card](help:scrum/edit-a-card).
- **Add** is disabled until there is a title.
- Assigning works only for people who have signed in once.
- The assistant can create cards too, with a sprint, type and assignee. See [the Scrum overview](help:scrum/index).
- Creating a card publishes `task.created` and links the card to its project.
