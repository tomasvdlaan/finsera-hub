---
title: Help - search, browse and reference
summary: How to use Help - the search box, the module list, the page view with its contents on the side, the generated Reference section, and asking the assistant.
module: help
paths: [/help]
keywords: [help, documentation, docs, manual, guide, how do i, search help, reference, wrong page, feedback, support, where is]
updated: 2026-10-23
---

Help is the platform's built-in manual. It lives at `/help`. It answers "how do I…", "where is…" and "who may…" questions about the platform itself, in two kinds of page.

## Two kinds of page

- **Guides.** Written pages for each module and for the platform itself: what a screen is for, the steps for each task, who may do it, and what to watch out for. This page is one.
- **Reference.** Pages that nobody writes: they are generated from the running system, so they cannot be out of date. They sit under **Reference**:
  - the **pages in the rail** (every screen and its address),
  - **permissions** (every capability, its description, and whether it is administrator-only - see [Permissions reference](help:reference/permissions)),
  - **assistant abilities** (everything the assistant can do, with its risk class),
  - **events** (what the platform records when things happen),
  - **dashboard blocks** (every widget you can put on [Today](help:shell/today)).

## The Help page

A page at `/help` with:

- **A search box** at the top.
- **A module list**, to browse guides module by module.
- **A page view** with a **table of contents on the side**, listing the headings of the page you are reading.

## Steps

### Find an answer by searching
1. Open Help and type a few words into the search box, such as "approve timesheet" or "who can see costs".
2. Results show a page title and a one-line summary. Titles and keywords weigh most, then headings, then the text.
3. Open a result and use the contents on the side to jump to a section.

### Browse
1. Pick a module in the list. Each module starts with an overview page that links to its other pages.
2. Start with [Start here](help:index) if you do not know where to look.

### Look up the exact rule
1. Open **Reference** and choose permissions, assistant abilities, events, pages or dashboard blocks.
2. Use it when you need the precise list; use guides when you need to know how to do something.

### Ask the assistant instead
1. Open the assistant (**✦**) or the [command bar](help:shell/command-bar) and ask in your own words: "how do I log hours?".
2. For how-to questions, the assistant searches Help and answers from the page it finds, and says which page it used so you can open it. If no page covers the question, it says so rather than guessing.

## Who can read it

Everybody who is signed in can read all of Help. It has no private pages and changes nothing. Guides about something only administrators can do (such as [People](help:shell/people)) say "administrators only" at the top.

## If a page is wrong

Guides are written by hand and checked against the product by the people who change it. If a page describes a button, a label or a rule that you cannot find or that behaves differently, tell an administrator, naming the page's title (and the address you were on). Most of the time the difference is a permission, which you can check against [Roles and permissions](help:shell/roles-and-permissions). The Reference pages are generated, so a mismatch there means the system itself has changed or you lack access.

## Good to know

- Guides are not a replacement for the screens: they say what a screen does, but the screen is always authoritative.
- Links inside a guide look like ordinary links and open the other page inside Help.
- Reference pages show the system as it is right now, including things you personally may not be allowed to use.
