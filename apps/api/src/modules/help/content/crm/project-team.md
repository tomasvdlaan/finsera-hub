---
title: Decide who works on a project
summary: See who is on a project, and as an administrator put people on it, make one the lead, or take them off.
module: crm
paths: [/projects/:id]
capability: crm.projects.assign
keywords: [team, assign, members, lead, project lead, put on project, remove from project, staffing, allocate]
updated: 2026-10-23
---

The **Team** section of [a project's page](help:crm/project-detail) says who is on the project. Everybody who can see the project can read it, because knowing who to ask is part of doing the work. Changing it is reserved for administrators.

## Before you start

Changing the team needs `crm.projects.assign`, which is administrators only. Without it the section shows the names and nothing else: there are no disabled buttons, because the controls are simply not offered.

## Steps: put somebody on a project

1. Under **Put somebody on it**, open the drop-down and choose a colleague. It only lists people who are not on the project yet.
2. They are added at once as a contributor.

## Steps: make somebody the lead

1. Click **make lead** next to their name.

A project has at most one lead. Promoting someone moves the current lead back to contributor in the same step. The lead is marked "leads it" and always listed first.

## Steps: take somebody off

1. Click **remove** next to their name.
2. Confirm **Take them off** in the dialog.

## Good to know

- Removing someone changes who is on the work from now on only. The hours they logged and the cards assigned to them are untouched, which is also what the dialog says.
- People who are no longer active cannot be added ("That person is no longer active"). Anyone already on the project keeps their place.
- Adding someone who is already on the project does nothing harmful.
- Each add and remove is written to the audit log.
- Names link to the person's page under people in Settings.
- Being on a project is how the board, assignee pickers and a person's own page learn what they work on.
- The Projects list shows the first three team members as small faces, with "+N" for the rest.
