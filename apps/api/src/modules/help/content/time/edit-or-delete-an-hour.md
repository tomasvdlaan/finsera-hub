---
title: Correct or delete an hour
summary: Fix a description, target, times, duration or billable flag on a logged hour, or delete it with a way back.
module: time
paths: [/time]
capability: time.entries.write_own
keywords: [edit entry, delete entry, undo, change project, billable, fix typo, untitled entry, invoiced, locked]
updated: 2026-10-23
---

Every entry in **Recent activity** on **Timesheet** (`/time`) can be corrected in place. Icons appear on the right of a row when you hover it.

## Correct an hour

1. Click the pencil icon (**Edit**) on the row. The row turns into a form.
2. Change what you need:
   - **Description**
   - The target picker (project, client or **Internal — no client**)
   - **Started at** and **Ended at**
   - **Duration**, shown only for an entry that was logged as a length with no start and end
   - **Billable**
3. Click **Save**, or **Cancel** to leave the entry as it was.

An error from the server shows next to the fields you are editing.

Shortcuts:

- An entry with no description shows **Untitled entry** and an **Add a name** button, which opens the same form.
- The **Billable / Not billable** tickbox on the row changes the flag directly, without opening the form.

## Delete an hour

1. Click the trash icon (**Delete**).
2. Confirm **Delete this entry?** with **Delete**.
3. A message **Entry deleted** appears with an undo link. Use it straight away to put the hour back.

## What is locked

- **Invoiced hours cannot be edited or deleted.** The icons are disabled and the badge reads **Invoiced**. The message from the server is "credit the invoice first". See [How hours reach an invoice](help:time/hours-and-invoicing).
- A **running** entry cannot be edited or deleted. Stop it first, see [Run a clock](help:time/run-a-clock).

## Good to know

- **Undo makes a new entry.** The deleted row is gone for good. Undo recreates an identical hour (same target, times, description, billable flag), but it is a new entry and, for example, loses its card link.
- Moving an hour to **Internal — no client** switches **Billable** off, because internal hours cannot be sold.
- Times are only changed if you touch them. Saving a description change on an entry with seconds in its times does not shave the seconds off.
- An entry with a start and end gets its duration from them, so there is no separate **Duration** field for it.
- Handing in a week does **not** lock its hours. You can still edit them until an invoice is issued, so tell your approver if you change a week you already handed in.
- You can only change your own hours here.
