---
title: The top bar and moving around
summary: What the bar across the top does, what the avatar menu holds, how hubs and tabs work, and what happens to old addresses.
module: shell
paths: []
keywords: [menu, navigation, top bar, anchors, sections, avatar, account menu, hub, tabs, not found, 404, old link, bookmark, rail, sidebar]
updated: 2026-10-23
---

The platform is navigated from a single bar across the top of every ordinary page. It shows nine places you go to without first going somewhere else; everything else is reached from a hub, from search, or from your avatar menu.

## The nine places

In order: **Today**, **Inbox**, **Agenda**, **Board**, **Time**, **Clients**, **Money**, **Meetings**, **Docs**.

- The one you are on is filled in.
- **Inbox** shows a red count when something is waiting for you: open items the platform has noticed, plus people who have mentioned you and whom you have not read yet. If the Inbox cannot be counted, the bar simply shows no number.
- A place whose module is not installed is left out.

## On the right of the bar

1. **The clock.** It reads **Start a timer** when nothing is running. Selecting it takes you to the **Time** page, where you start one. While a timer runs it shows the elapsed time and the project name, and a ■ button stops it from any page. See [The clock in the top bar](help:shell/clock).
2. **Search (⌕, ⌘K).** Opens the [command bar](help:shell/command-bar).
3. **Assistant (✦).** Opens [the assistant](help:shell/assistant).
4. **Your avatar.** The first letter of your name. It opens a menu, described below.

## The avatar menu

At the top it shows your name and role (**admin** or **member**). Then:

- **Organisation** - your company details, see [Organisation settings](help:shell/organisation-settings).
- **People** - see [People](help:shell/people). Administrators only in practice: the page refuses members.
- **Platform costs** - only shown to administrators, see [Platform costs](help:shell/costs).
- **Platform modules** - see [Platform modules](help:shell/platform-modules).
- **Sign out**.

If the platform cannot tell who you are (for example when it refuses your account), only **Sign out** is offered, because the other pages would only show errors.

## Hubs and tab strips

Not every page has a place in the bar. Related pages sit behind a hub that shows a strip of tabs, so the whole section reads as one place:

- [All work](help:shell/work-hub) carries a tab strip for the **Work** section: **Meetings**, **Board**, **All work**, **Client tickets** and **Whiteboards**.
- **Money** is the hub for invoices, quotes, contracts and rate cards. See [The Money hub](help:billing/money-hub).

You can always reach any page, and any record by name, with **⌘K**.

## Old addresses still work

Addresses used to be named after the module that stored the record (for example `/crm/clients`). They now name the thing itself (`/clients`). Old links, bookmarks and addresses in older assistant answers are forwarded to the new address automatically, with their query kept.

## Not found

If there is no page at an address you get **Not found**, with **Go back to the start**, which takes you to [Today](help:shell/today). The address may have been renamed, or the link may be stale.

## Good to know

- Meeting rooms and whiteboards open in a full-screen view without the top bar, so they have the whole window. Use your browser's Back or the page's own way out to return. **⌘K** still works from inside a meeting room.
- A page that needs data the platform cannot load shows a red **API error** line at the top; if the navigation itself could not load, some sections may be missing until you reload.
- The page you are on is also the browser tab's title.
