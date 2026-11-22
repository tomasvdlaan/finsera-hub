---
title: People
summary: The list of everyone who has signed in - role, departments, title, contracted hours, cost rate and status - and how to edit or deactivate someone.
module: shell
paths: [/settings/people]
capability: core.people.manage
keywords: [colleagues, staff, team, users, roles, admin, member, deactivate, reactivate, hours per week, cost rate, job title, add person, invite]
updated: 2026-10-23
---

**People** lists everyone who has signed in to the platform and what the business records about them. Open it from your avatar menu.

## The table

Columns: **Name** (with email, linking to their [own page](help:shell/person-page)), **Role** (Admin or Member), **Departments**, **Title**, **Hours/week**, **Cost rate** (hourly), **Status** (**Active** or **Deactivated**) and the row's buttons. Deactivated colleagues are shown greyed.

A role is shown here but **changed on the colleague's own page**, where the question "what should this person reach?" belongs.

## Steps

### Edit a colleague's details
1. On their row select **Edit**. A form opens under the table.
2. Fill in any of **Job title**, **Started** (date), **Contracted hours a week** (1 to 80), **Cost rate an hour**.
3. Select **Save**.

Leave **Contracted hours a week** empty if you do not know it: load widgets then show hours without a bar instead of measuring against a guess. The cost rate is what an hour of their time costs the business; only administrators see it.

### Choose departments
1. Select the badges in the **Departments** cell (or **none**) to open a checklist.
2. Tick or untick. Each change saves at once. See [Departments](help:shell/departments).

### Deactivate or reactivate
1. Select **Deactivate** on their row and confirm: "Deactivating signs them out and refuses their next sign-in. Their hours and tasks stay attached to them. Continue?"
2. To bring them back, select **Reactivate** on the same row.

## Who can do this

Everything on this page needs the capability `core.people.manage`, which only administrators hold. A member who opens the page sees an error instead of the list.

## Good to know

- **There is no "add person" button, on purpose.** A person exists here once they have signed in, because the record is tied to their identity provider login. Creating one by hand would make a second record when they did sign in, splitting their hours. To add a colleague, give them the `internal` role at the identity provider; they appear the first time they sign in. See [Signing in and out](help:shell/sign-in).
- **Role and department are different things.** A role decides what somebody may *do*. A department only decides whose inbox work is *sent* to. See [Roles and permissions](help:shell/roles-and-permissions).
- You cannot deactivate or demote **yourself**, and you cannot remove the **last active administrator**. The platform tells you to ask another admin or promote somebody first.
- Deactivation is reversible. Nothing is deleted.
