---
title: The assistant
summary: Ask questions about your clients, hours, invoices, documents and meetings, get answers with the records they came from, and carry on a conversation.
module: shell
paths: [/assistant, /assistant/:id]
keywords: [assistant, ai, chat, ask, question, copilot, llm, conversation, stop, try again, cards, citations, new chat]
updated: 2026-10-23
---

The assistant is a page of its own (the **✦** button in the top bar). You type a question in plain words; it looks things up in the platform and answers. Everything it knows about your business comes from the platform, so answers can be checked.

## The page

- **On the left:** your conversation list with a search box, a **+** for a new conversation, and tools for sorting and filing. See [Keep your conversations tidy](help:shell/assistant-conversations).
- **In the middle:** the conversation, and at the bottom a box that says **Ask anything…** with an **Ask** button. Press Enter to send.
- **Empty page:** "Ask about a client, a project, an invoice or what was said in a meeting."

## Steps

### Ask a question
1. Open the assistant with **✦**, or press **⌘K** and use the last row (**Ask the assistant**), see [The command bar](help:shell/command-bar).
2. Type the question and select **Ask**.
3. While it works you see small tags for what it is looking at, and often a one-line note of what it is thinking about. **Show the working-out** opens the longer version. These are shown live only and are gone when you reload.
4. The answer appears word by word. Select **Stop** to cut it short; what has arrived is kept.

### Carry on
Just ask the next thing in the same conversation ("and the second one?"). The assistant remembers the thread.

### Start fresh
Select **+** (New conversation), or press **⌘⇧O** (Ctrl+Shift+O). The shortcut is ignored while you are typing in a box.

## What an answer gives you

- **Cards.** When the assistant cites a record that matters (a client, an invoice, a document) it appears as a card you can open. It cites sparingly, and only records you are allowed to see.
- **Tags under the answer** name the tools it used, so you can see what it looked at. A tag marked **(skipped)** was asked for but not run; hover to see why.
- **Actions under the answer:** **copy**; **try again** (on the latest answer only, to ask the same question again); **star** to keep it, see [Saved answers](help:shell/assistant-saved-answers); and **split here** to move everything from that answer onwards into a new conversation (not offered on the first answer).

## Asking about "this"

If you open the assistant from the command bar while looking at a record (a client, a project, a meeting note), the assistant is told which record that is, so "this client" or "this project" works without naming it. On the assistant page itself no record is implied; name what you mean.

## Good to know

- **The assistant acts as you.** It sees what you can see and can do what you can do, no more. See [What the assistant can and cannot do](help:shell/assistant-limits).
- **It can also answer how-to questions.** Ask "how do I log hours?" and it reads Help and tells you which page it used. See [Help: search, browse and reference](help:help/index).
- **Be specific about time.** For "what happened last week?" it reads the activity log. See [Activity and history](help:shell/activity-timeline).
- **A slow answer gives up after two minutes** with "That took too long and was given up on." Your question is not lost; ask again.
- **If it fails**, you see the reason in the conversation, and your question is still stored. Administrators can see recent failures under [Platform costs](help:shell/costs).
- **It tries not to guess.** If a tool finds nothing, it should say so. Always open the cited record when the answer matters, for example before sending an invoice.
- Conversations are private to you: the list only holds your own.
