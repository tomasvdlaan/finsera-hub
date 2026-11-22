---
title: Platform modules
summary: A generated inventory of every module - its record types, events, permissions, assistant abilities and screens.
module: shell
paths: [/settings/modules]
keywords: [modules, manifest, inventory, capabilities list, events, ai tools, entities, reference, what is installed, platform documentation]
updated: 2026-10-23
---

**Platform modules** is a technical page, generated live from each module's own declaration. It cannot drift from the running system: if it is listed here, it exists. Open it from your avatar menu.

## What you see

- A row of counts: **Modules**, **Entity types**, **Events**, **Capabilities**, **AI tools** and **Reporting views**.
- One card per module showing its name and version, and how many entities and tools it has. Select a card to open or close it. The first module opens for you.

Inside a module, grouped blocks list:

- **Entities** - the kinds of record, with their address pattern.
- **References** - links between records that are required or optional.
- **Publishes** and **Subscribes** - events the module announces and reacts to, and who reacts.
- **Capabilities** - the permissions the module introduces.
- **AI tools** - what the assistant may do here, with its risk class (`read`, `write:draft`, `write:commit`, `restricted`) and a plain-words hint: "Runs silently.", "Runs and shows the result for review.", "Withheld until the user confirms.", "Never offered to the assistant."
- **Screens & widgets** - the module's pages and dashboard blocks.
- **Chat cards** - how its records appear inside assistant answers.
- **Reporting views** - the stable data shapes it publishes for dashboards and Power BI.
- **Portal exposure** - what clients may see; nothing is visible to clients by default.

## Good to know

- Everyone who is signed in can open this page.
- **This is a reference, not a how-to.** For task guides use [Help](help:help/index). Help's own Reference section is generated from the same source, in a reader-friendly form.
- For who holds each capability, see [Roles and permissions](help:shell/roles-and-permissions).
