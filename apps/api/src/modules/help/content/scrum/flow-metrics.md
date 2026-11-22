---
title: Read the flow figures
summary: What cycle time, the slow half, waiting on the client, cards in flight and finished-per-week mean, and when they are too thin to trust.
module: scrum
paths: [/board/flow]
capability: scrum.tasks.read
keywords: [flow, cycle time, lead time, throughput, aging, waiting on client, percentile, p85, median, reopened, metrics]
updated: 2026-10-23
---

The **Flow** tab (`/board/flow`) shows how work really moves, measured from the moves between columns rather than from what a card says now. Pick the project in the picker top right. Which columns count as work, waiting or finished comes from each column's **Flow** setting, see [Change the columns](help:scrum/columns-and-definitions).

## The three headline figures

- **Cycle time**: half of the finished cards were done within this time, from first starting work.
- **The slow half**: 85 in 100 cards finish inside this time.
- **With the client**: how many cards sit in a "Waiting on someone else" column right now, and how much waiting has been recorded and over how many spells.

## Below them

- **In flight now**: unfinished cards, oldest first. The age counts from the first time work started, so bouncing a card back and forth between columns does not reset it. A card with no column history is marked "at most", measured from its creation.
- **Waiting on the client**: how many cards, and total recorded waiting across N spells. "One long wait and four short ones are different problems."
- **Finished per week**: a bar per week, with the counts listed. Reopened cards are counted once, in the week they first landed.
- **Start to finish**: cycle time in words. Waiting on the client is included on purpose.
- **Asked to done**: from creation to done, so it includes time spent in the backlog.

## When it is too thin

A percentile over a handful of cards is just one of the cards. With fewer than **eight** finished cards the page lists them (each time is a link to the card) instead of a median, and says "Too few to put a median on".

- Cycle time shows "—" and "N finished so far — too few to take a median from".
- On an empty board: "Nothing on this board yet. Flow is measured from cards moving."

## Good to know

- Cards from before the board kept a history have no column timings. The page says how many and still counts them for **Asked to done**. Nothing is invented.
- "Came back" (reopened) counts cards finished and then moved out of a done column.
- Times come from column moves. Editing a card's text changes no figure.
- The assistant gives the same figures when you ask "are we getting faster?" or "what is stuck?".
- Several of these figures also exist as [dashboard blocks](help:scrum/dashboard-widgets).
