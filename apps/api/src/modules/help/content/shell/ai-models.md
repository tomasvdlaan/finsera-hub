---
title: Choose the AI models
summary: Pick which AI model answers questions and which does the quick background work, and see what each choice costs.
module: shell
paths: [/settings/costs]
capability: core.models.manage
keywords: [model, ai model, llm, claude, openrouter, reasoning, quick work, cheaper, provider, settings, change model, gpt]
updated: 2026-10-23
---

The platform uses two AI model "slots". Which model fills each is an administrator's choice, made in the **Models** card on [Platform costs](help:shell/costs).

## The two slots

- **Reasoning** - answers questions, reads documents, writes meeting notes.
- **Quick work** - live meeting extraction, wake words, conversation titles.

## Steps

1. Open your avatar menu, choose **Platform costs**, and find the **Models** card.
2. Open the list under **Reasoning** or **Quick work**.
3. Pick a model. Each option shows what one typical answer costs, for example "Model name - €0,0031". The note under the list describes the model you chose.
4. It saves immediately; there is no confirm step.

To hand a slot back, choose **Follow the server setting (…)**, which uses whatever the server is configured with.

## Good to know

- **It changes behaviour for everybody at once**, not just for you.
- **Prices are estimates per answer**, from a typical question of about 9,000 tokens in and 250 out, uncached. The cheapest and dearest options differ by more than tenfold per token, which is why this is a spending control as much as a quality one.
- **Some models are "via OpenRouter".** Their prompts pass through OpenRouter before reaching the model maker, and prompts can contain client material. A red note says so when you pick one. Models listed under **Direct to the provider** go straight to the vendor.
- If a gateway account runs out of credit, those models fail. The balance is shown on the same page.
- If answers suddenly fail after you changed a model, switch back; the failures log on the same page shows why.
- Administrators only (`core.models.manage`).
