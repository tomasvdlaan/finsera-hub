---
title: What the assistant can and cannot do
summary: The assistant acts with your permissions; some of its abilities only read, some change things, and some are never offered. Why it can be trusted, and where it cannot.
module: shell
paths: []
keywords: [assistant, permissions, risk, confirm, confirmation, draft, write, read, restricted, safe, limits, can it send invoice, delete, tools, abilities]
updated: 2026-10-23
---

The assistant works through a fixed list of abilities (tools) that each module declares. It cannot do anything that is not on that list.

## It acts as you

For every question, the assistant is given **your** permissions:

- It is only offered the abilities you may use. If you lack a permission, that ability does not exist for you.
- Records you may not read are not shown to it, and it is told not to speculate about them.
- Anything it changes is changed as you, the same as if you had done it yourself. Changes to records appear in [Activity and history](help:shell/activity-timeline).
- There is no separate "assistant account" with extra access.

See [Roles and permissions](help:shell/roles-and-permissions).

## Four kinds of ability

Each ability has a risk class, set by the module that owns it. The platform enforces it, not the AI model.

| Risk class | What happens | Examples |
|---|---|---|
| `read` | Runs straight away and changes nothing. | Searching clients, listing invoices, reading meeting transcripts, reporting figures, the activity log |
| `write:draft` | Runs straight away and makes a change, then shows you the result to review. | Logging hours, stopping your timer, creating or moving a card, creating a project or a lead, drafting a quote or an invoice from hours, writing into a meeting note, proposing action points |
| `write:commit` | Held back until you have explicitly confirmed. | None of the current abilities use this class. |
| `restricted` | Never offered to the assistant at all. | **Sending** an invoice, **sending** a quote |

The full, current list is generated from the system in the Reference section of Help (assistant abilities). See [Help: search, browse and reference](help:help/index).

## What this means in practice

- **Things it drafts are real records.** A drafted quote or invoice exists in the platform as a draft. Nothing is issued or sent until you do that yourself on its own page. Open and check the draft first.
- **Several actions happen immediately.** If you say "move the dataset task to review" or "log 90 minutes on Dashboard", it does it and tells you. Check what it reports, and undo it yourself on the page if it is wrong.
- **It cannot delete records**, issue or send invoices, send quotes, sign contracts, change roles or settings, or touch another colleague's permissions.
- **Meeting proposals need your yes.** Action points it proposes from a meeting stay proposed until you accept them.
- **It does not invent clients, hours or amounts.** If a tool finds nothing it should say so.
- **It does not give up your data to others.** Conversations are visible to you only.
- **It can be wrong.** It summarises; the platform's records are the truth. Open the cards it cites.

## Good to know

- A tag marked **(skipped)** under an answer means an ability was asked for but not run.
- Money is held in euro cents and durations in minutes; the assistant converts for you.
- Administrators choose which AI models answer, see [Choose the AI models](help:shell/ai-models).
