---
title: Platform costs
summary: What the platform spends at its AI and meeting providers in a period, split by module, provider and model, plus the failures log.
module: shell
paths: [/settings/costs]
capability: core.costs.read
keywords: [costs, spend, ai cost, tokens, openrouter, balance, budget, usage, bill, provider, failures, assistant failed, error log, download]
updated: 2026-10-23
---

**Platform costs** shows what the platform spends on AI and meeting-recording providers. It is for administrators and is opened from the avatar menu.

## This is a meter, not an invoice

The platform prices each call itself from its own record of what it called, against a rate card. That is how it can say *which part* of the platform spent the money, which a provider's invoice cannot. Expect a few percent of difference from the real invoice. Read the split and the trend, not the last cent.

## What is on the page

- **Period** - **From** and **To** dates at the top. It opens on the first of this month through today.
- **This period** - **Spent**, **Calls**, **Tokens in**, **Tokens out**, **Served from cache** (share of reading that came from the prompt cache), and, if a gateway account is connected, the **OpenRouter balance**. The balance is in US dollars, is not tied to the period, and turns urgent under $1, with a warning that "gateway models will start failing".
- **Models** - choose which AI model answers. See [Choose the AI models](help:shell/ai-models).
- **By module**, **By provider**, **By model** - a bar per row against the largest, with the cost and number of calls.
- **Assistant failures** - the most recent failed answers with the error name, HTTP status, time, model, number of tool calls, and the start of the question asked. **Download all** saves them as a JSON file.

## Steps

### Look at a different period
1. Change **From** and/or **To**. The figures reload.

### Investigate a run of assistant failures
1. Read **Assistant failures**. A run of the same error is usually a model that has been retired, a gateway account out of credit, or a choice made in **Models**.
2. If someone else needs to look at them, select **Download all**.

## Who can do this

Administrators only (`core.costs.read`). The numbers are attributed per person and per question, so showing them to everyone would reveal how a colleague works. The menu entry is hidden from members and the page refuses them.

## Good to know

- Amounts are in euros, to four decimals when under a euro (most rows are fractions of a cent).
- The failures log includes the question that provoked each failure, so treat the download as sensitive.
