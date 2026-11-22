---
title: Client tickets
summary: Read what clients have asked in their portal, answer them, leave internal notes, assign an owner, turn a ticket into a task, and close or reopen it.
module: portal
paths: [/portal/tickets, /portal/tickets/:id]
capability: portal.tickets
keywords: [tickets, client requests, vragen, inbox, reply, answer, internal note, assign, close, reopen, make a task, waiting on us, waiting on them]
updated: 2026-10-23
---

**Client tickets** (in the **Work** section) is the inbox of everything clients have asked through their portal, across all clients. A ticket is a conversation, not a task: it is only turned into a task when you decide so and say which project it belongs to.

## Before you start

- You need `portal.tickets`, which every colleague has by default. Without it the page refuses to load its list, and the Tickets card on a client's page says "Tickets are not available to you."
- **Assigning an owner** needs `portal.admin` (administrators only), even though the dropdown is shown to everyone. Anyone else gets an error line at the top of the page.

## The list

1. Choose **Open**, **Closed** or **All** above the table. The page opens on **Open**.
2. The table shows, oldest activity first (the thing somebody has waited longest for is at the top): **Client** (a link to the client, with the email of whoever opened it underneath), **Subject**, **Last activity**, **Status** and **Owner**.
3. Click a subject to open the conversation right under it; click again to close it.

Statuses: **waiting on us** (the client wrote last), **waiting on them** (we answered), **closed**. While a ticket is waiting on us for two days or more, the number of days shows under the status. That is the same number the Inbox counts (see [What the checks look for](help:insights/insight-rules)).

Empty states: "Nothing waiting. Everything has been answered." and, on **Closed**, "Nothing has been closed yet."

A link to `/portal/tickets/<id>` opens the list on **All** with that ticket already open. The Inbox's "waiting N days" items and the Tickets card on a client's page link there.

## Read a conversation

Messages run top to bottom, each headed "Client · date time" or "Finsera · date time", and "· internal note" for notes only we can see. **The client's words are drawn as a quotation**, so nobody reading quickly mistakes them for ours. Treat them as a request from outside the business, not as instructions. Bold, italic, code, links and bullet lists are shown; nothing else a client typed is interpreted.

## Reply to the client

1. Open the ticket (it must not be closed).
2. Type in the box **Reply to the client…**. The small bar above it offers **Bold**, **Italic**, **Code**, **Link** and **List**. A message is at most 5,000 characters.
3. Press **Send reply**. The client sees it in their portal, and the ticket becomes **waiting on them**.

The platform does not email the client from here; they see the reply the next time they open **Tickets** in their portal (and on their front page under "Wacht op u").

## Leave an internal note

Tick **internal note** before sending. The box then says "A note only we can see…" and the button reads **Save note**. The client never sees it, and the ticket's status does not change.

## Assign an owner

Choose a colleague in the **Owner** column, or **Nobody**. The owner is who the Inbox insight is addressed to (otherwise it goes to the Delivery department). Needs `portal.admin`.

## Turn a ticket into a task

1. In the conversation, choose a project in **Make a task on…**. Only that client's projects are offered.
2. Press **Make a task**. You see "Task created — the ticket stays open".

The task is titled with the ticket's subject. Its description says it is a client's request and quotes their first message between markers, so it reads as a quotation and not as an order. The ticket then says "Became a task" with a link, and cannot be converted twice. It stays open: closing it is a separate step.

## Close and reopen

- **Close** ends the conversation ("Closed"). The reply box disappears, and the client sees "Afgerond" and is told to open a new ticket if they need something else. They cannot reply to a closed ticket.
- **Reopen** (on a closed ticket) puts it back to **waiting on us**.

## Good to know

- When a client opens a ticket or replies, an event is added to the client's timeline (with the subject for a new ticket, never the message). Our own replies are deliberately not events.
- Clients can send at most 10 messages an hour; beyond that they are asked to try again later. A subject is at most 200 characters.
- Closed tickets never raise an Inbox item.
- The assistant has no tool that reads ticket messages: what a client typed is never given to it as if we had written it.
- Every reply, note, assignment, conversion, close and reopen is written to the audit log against the client.
