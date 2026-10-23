---
title: Budget burn on a project
summary: The card on a project page that compares hours spent with the hours sold.
module: time
capability: time.entries.read_all
keywords: [budget, burn, project hours, hours sold, over budget, project page, budgeted hours]
updated: 2026-10-23
---

Time adds a **Budget burn** card to every project page. The project page itself belongs to [CRM](help:crm/index); Time only contributes the card.

## What it shows

- **Spent**: the hours logged against the project.
- Underneath, either "of … sold" when the project has a budget in hours, or "no budget set on this project".
- When there is a budget, a bar fills toward it and turns to the danger colour once spending passes it. When there is no budget there is no bar, because a bar against an invented target would look more authoritative than the facts.

Clicking the card opens the tracker.

## Where the budget comes from

The budget is a field on the project (budgeted hours, with an optional amount and default rate). Set it on the project, not here. See [CRM](help:crm/index).

## Who sees it

The figures come from a request that needs `time.entries.read_all`, which only administrators hold. Everyone else sees an error on the card instead of numbers. The assistant's `time_project_hours` tool uses the same rule.

## Good to know

- The totals include every person's hours on the project, billable or not.
- The server also works out billable hours, invoiced hours, hours on a draft, hours not yet invoiced and their value at the project's default rate. Those figures are available to the assistant when you ask "how much is left to invoice on X?", but they are not drawn on the card today.
- Hours against a client with no project do not count toward any project.
