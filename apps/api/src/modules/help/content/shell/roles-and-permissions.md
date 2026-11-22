---
title: Roles and permissions
summary: The two roles (administrator and member), what a capability is, which are administrator-only, and how the assistant inherits yours.
module: shell
paths: []
keywords: [role, admin, administrator, member, permission, capability, access, adminOnly, who can, forbidden, missing capability, refused, rights, assistant permissions]
updated: 2026-10-23
---

Every colleague has one of two roles. Everything you may do is decided by that role and nothing else.

## The two roles

- **Member** - the default for everybody. A member holds every capability **except** the ones marked administrator-only.
- **Administrator** - holds every capability, including the administrator-only ones.

You see your own role at the top of your avatar menu. The first person to sign in to a new platform becomes an administrator; everyone after that starts as a member. An administrator changes a role on the colleague's page; see [One colleague's page](help:shell/person-page).

## Capabilities

A capability is one named permission, for example "Draft, edit and credit invoices". Each module declares its own. Pages, buttons, widgets and assistant abilities are each tied to one. The rule, in one sentence:

> **Members hold everything not marked administrator-only. Administrators hold everything.**

There are no per-person grants in between. You cannot give one member a single extra capability; you can only make them an administrator. Because of that, the list of administrator-only capabilities is kept short and deliberate.

## What administrator-only means

A capability is marked administrator-only when its reach goes beyond the person using it: it changes things for everybody, it exposes data about *other people*, or it hands something to someone outside the business. The current ones:

| Capability | In words |
|---|---|
| `core.people.manage` | Change a colleague's role, status and recorded details; open [People](help:shell/people) |
| `core.costs.read` | See what the platform spends at its AI and meeting providers; see assistant failures |
| `core.models.manage` | Choose the AI models for everybody |
| `time.entries.read_all` | See everyone's hours |
| `time.entries.manage` | Manage another person's hours |
| `time.approve` | Approve or send back a person's week |
| `time.costs.read` | See what hours cost and the margin |
| `crm.projects.assign` | Decide who works on a project |
| `portal.admin` | Invite, revoke and restore client logins |
| `insights.read_all` | See Inbox items raised about other people |

Everything else is open to members, including the powerful-looking ones: issuing an invoice (`billing.issue`), archiving documents (`docs.delete`) and configuring boards and sprints (`scrum.board.manage`) are all member capabilities.

The authoritative, always-current list - every capability, its description, and who holds it - is generated from the system itself: [Permissions reference](help:reference/permissions).

## What you notice when you lack one

- **Menu entries and widgets** you are not allowed to use are usually not shown at all (for example **Platform costs** in the avatar menu, or dashboard widgets in the library).
- **A page you reach by address** or a button you press may refuse you with a message like "Missing capability '…'".
- **Records you may not read** do not appear in search, the activity timeline or the assistant's answers, and the platform does not even confirm that they exist.
- **Saving organisation details** is refused to members.

If something in Help is described but you cannot see it, ask an administrator whether it is one of the above.

## Roles are not departments

A **department** (Finance, Sales…) only decides whose inbox work is sent to. It grants nothing. See [Departments](help:shell/departments).

## The assistant inherits yours

The assistant has no account of its own. Each question runs as you:

- It is only offered the abilities you are allowed to use.
- It cannot read records you cannot read.
- A member's assistant cannot do what only an administrator may.

See [What the assistant can and cannot do](help:shell/assistant-limits).

## Good to know

- **Deactivating** a colleague (**People**) removes their access without deleting anything.
- You cannot demote or deactivate **yourself**, and the last active administrator cannot be removed. See [People](help:shell/people).
- Portal clients are not colleagues and have no role here; what they may see is set per client. See [The client portal](help:portal/index).
- Record-level scoping (for example, a member seeing only their own projects) does not exist yet: if a member may read clients, they may read all clients.
