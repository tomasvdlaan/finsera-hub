---
title: One colleague's page
summary: Change a colleague's role, status and details, see their login account, projects, plate, hours, sign-ins and activity over a period.
module: shell
paths: [/settings/people/:id]
capability: core.people.manage
keywords: [colleague, person, profile, role, administrator, member, make admin, deactivate, hours, utilisation, contract, cost rate, sign-in history, activity, export hours, login account, invitation]
updated: 2026-10-23
---

Everything the owner wants to know about a colleague is on one page: who they are, what they are on, how many hours they logged, and what they did. Open it by selecting a name in [People](help:shell/people).

## The period

At the top, **Van** and **tot** date pickers set the window for the hours, sign-ins and activity on the page, with presets **Fortnight**, **30 days**, **Quarter** and **Year**. It starts as the last 14 days. The window is kept in the address, so you can send a link.

## Left side

- **The person** - name and email. These come from the identity provider and are read-only here, because they would be overwritten at the next sign-in.
- **Settings** - each saves as soon as you change it:
  - **Role** - **Member** or **Administrator**. A hint explains: an administrator "Can manage people, settings and cost rates"; a member "Can reach the work, but not settings or cost rates".
  - **Job title** - saved when you leave the box.
  - **Started** - date.
  - **Contracted hours a week** - 0 to 60. Empty shows "no contract set" in the figures, not a guess.
  - **Cost rate (€ per hour)** - what an hour of their time costs the business. Administrators only.
  - **Status** - **Active** or **Deactivated**. A deactivated colleague keeps the hours and cards they already own; they get no new work and cannot sign in.
- **Departments** - tick the chips to say where work is sent. See [Departments](help:shell/departments).
- **Login account** - read-only facts from the identity provider: status, whether the email is verified, when a password was set ("Never - invitation still open" if not), and sign-in name, with a link **Manage this account at the provider**. Useful for "why can this person not sign in?". If the provider is not configured, it says so; if no account exists for their email, it says "They cannot sign in yet."
- **On these projects** - their active projects, with the client, and "leads it" where they lead.

## Right side

- **Hours** for the period: **Logged**, **Billable** (share of logged), **Against contract** (logged against their contracted hours for the period) and **Days with hours**. Below the figures is an hours export: choose **Every line**, **Per week** or **Payroll**, optionally include cost and margin if you hold that permission, then **Download CSV**. It exports the same period shown on screen. See [Time](help:time/index).
- **On their plate** - open cards assigned to them, with blocked ones flagged and the reason, status and due date.
- **When they were here** - sessions: "was working in the platform", or "opened the client portal of …".
- **What they did** - every change they made in the period (created a card, logged time, issued an invoice, and so on), each linking to the record.

## Good to know

- **You cannot change your own role or deactivate yourself**, and the last active administrator cannot be demoted or deactivated. The platform says "Ask another admin to do that to your own account" or "That is the only administrator - promote somebody else first".
- **Sign-ins are approximate.** A row appears the first time somebody does something after 30 minutes away. The platform never sees a login itself, because the browser renews its own token.
- **The activity list covers changes to records**, not time spent reading.
- **Only administrators can open this page.** It holds contracted hours and cost rates, from which a salary could be inferred. See [Roles and permissions](help:shell/roles-and-permissions).
- Some labels on this page are in Dutch (**Van**, **tot**, and a few hints).
