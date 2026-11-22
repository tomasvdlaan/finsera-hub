# Help documentation — how it works and how to keep it true

The platform documents itself in the platform: **Help** in the app, and the assistant answers
"how do I…" questions from the same pages. Two kinds of page feed it.

| Kind | Where it comes from | Can it go stale? |
|---|---|---|
| **Reference** — every page in the rail, every capability and who holds it, every action the assistant can take, every event, every dashboard block | Generated at runtime from the module manifests (`ManifestRegistry`). Nobody writes it. | No. It *is* the manifest. |
| **Guides** — what the page is for, how to do each task, what the screen does, who may do it, what to watch out for | Markdown files in `apps/api/src/modules/help/content/<module>/` | Yes, which is why the tests below exist. |

## Layout

```
apps/api/src/modules/help/content/
  index.md                 start here: what the platform is, how to find things
  <module>/index.md        one overview per module (crm, time, docs, scrum, billing, sales,
                           reporting, insights, meetings, portal, whiteboard, shell, help)
  <module>/<task>.md       one page per task or screen
```

`shell` is the pseudo-module for everything that is not a module: the assistant, the agenda,
settings, people, costs, the command bar, sign-in.

## Page format

```markdown
---
title: Log your hours
summary: One sentence, plain words. Shown in search results.
module: time
paths: [/time]
capability: time.entries.write_own
keywords: [timer, timesheet, hours, track]
updated: 2026-10-23
---

Intro: what this is for, in one or two sentences.

## Before you start
## Steps
1. …
## Good to know
```

- `module` — a manifest name, or `shell`. Required.
- `paths` — the app routes this page documents (`/time`, `/clients/:id`). Required for any page
  that describes a screen. Used by the coverage test.
- `capability` — the manifest capability needed to do this. Omit if everyone can. If it is
  `adminOnly` the page shows an "administrators only" note automatically.
- `keywords` — words a colleague would type that the page itself does not use ("hours" for a
  page titled "Timesheet").
- `updated` — ISO date you last checked the page against the product. Bump it when you verify,
  not only when you edit.

## Writing rules

1. **Document what the screen does, not what it ought to do.** Read the component. If a
   button is there, name it by its label; if a rule exists (a status that locks editing, an
   amount that rounds), say so. Do not invent a flow you have not found in the code.
2. **One task per page, steps numbered, UI labels in bold** exactly as they appear.
3. **Say who can do it.** Name the capability, and say in words what happens to someone
   without it (button missing? page refuses?).
4. **Say what is irreversible.** Sending an invoice, archiving, deleting, approving a week.
5. **No screenshots.** They rot first. Describe where things are ("top right of the
   timesheet").
6. **Link other pages with `[text](help:<module>/<page>)`**; the viewer resolves them.
7. Plain language for a colleague who has never seen the system. English.

## Keeping it true

Three guards, in order of strength:

1. **Reference pages are generated.** Add a nav entry, a capability, an AI tool, an event or a
   dashboard widget to a manifest and it appears in Help on the next start.
2. **`help.content.spec.ts` fails the build** when
   - a module (or `shell`) has no `index.md`,
   - a non-hidden navigation path or entity URL is not covered by any page's `paths`,
   - a page names a capability no manifest declares, or a `help:` link that points nowhere,
   - front matter is missing or malformed.

   A new screen therefore cannot ship without at least a page that claims its route.
3. **Definition of done.** The pull-request template asks: *did this change what a colleague
   can do or sees? Then the Help page changed too.* The test cannot read prose; this is the
   part that needs a person.

When you change behaviour a guide describes, edit the guide in the same commit and bump
`updated`. When you delete a feature, delete its page — the coverage test will tell you
which routes lost their page.

## Search and the assistant

Help search is in-process keyword search (title and keywords weigh most, then headings, then
body) over every guide section and every generated reference section. The assistant gets two
read-only tools, `help_search` and `help_read`; its system prompt tells it to use them for any
question about *how to use the platform* and to say which page it read. Both tools are
permission-neutral — everybody may read Help — and they return text only, so they cannot
change anything.

If search ever stops being enough (a hundred-plus pages, or people asking in different words
than the pages use), the upgrade is embeddings through the existing `EmbeddingService` and
pgvector, indexing the same sections. Not needed yet.
