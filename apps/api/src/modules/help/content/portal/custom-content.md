---
title: Custom content (reports)
summary: Add a report hosted elsewhere to a client's portal, test it, switch it on or off, and remove it.
module: portal
paths: [/clients/:id/access, /portal/pages/:id]
capability: portal.admin
keywords: [custom content, report, rapport, dashboard, page, proxy, redirect, vercel, bypass secret, source url, slug, enable, disable, test]
updated: 2026-10-23
---

Custom content is a report or dashboard that we host elsewhere (for example on Vercel) and show inside a client's portal, at an address on the client's own name: `<client address>/<page address>/`. The client finds it under **Rapporten**, and promoted on their front page under **Rapportages**.

## Before you start

- You need `portal.admin` (administrators only).
- The client needs a **portal address**. Without one the **Custom content** panel is not shown at all. See [Give a client a portal address](help:crm/client-portal-access).
- The report must be reachable over **https** from the platform's server.
- To keep the hosting deployment protected (for example Vercel deployment protection), the server needs a page key set (`PORTAL_PAGE_KEY`) so the bypass secret can be stored. If it is not set, the form says so, and the deployment has to be publicly reachable.

## Add a report

1. Open the client's **Portal access** tab and scroll to **Custom content**.
2. Press **Add custom content**.
3. Fill in the **title** ("Rapportage Q3": what the client sees), the **address** ("rapportage-q3") and the **source URL** (for example `https://rapportage-q3-duce.vercel.app`). A line shows where it will be: `<client address>/<address>/`.
4. Choose how it is served:
   - **Serve it here** (proxy, the default): the platform fetches the report on the client's behalf, so the hosting address never reaches the client's browser and the deployment can stay protected.
   - **Redirect to it**: the client is sent to the source address and can see it. Use it only when the source is meant to be public.
5. Optionally enter the **Vercel protection-bypass secret**. It is write-only: it is stored encrypted and never shown again.
6. Press **Add page**.

**A page added this way is switched on straight away** and is visible to everyone at the client. If you want to check it first, press **test**, and add it when you are ready, or switch it off straight after adding.

## Rules the form enforces

- The address is 2–60 lowercase letters, digits or hyphens, starting and ending with a letter or digit, and is unique per client.
- Names the portal already uses are refused: api, assets, auth, overzicht, projecten, taken, offertes, facturen, documenten, vragen, tickets, rapporten.
- The source must be https, must not contain a username or password, must resolve to a public address (internal and private addresses are refused), and must not be one of our own hosts.

## Test, switch on and off, remove

Each row of the table shows the link, the title, who it is visible to, and the source (with "· secret set" if a secret is stored). The link is tagged "· redirect" or "· off" where that applies. At the right:

- **test** makes one real request to the source from the server and reports "<title>: HTTP <status>". A 401 or 403 is explained: refused because no bypass secret is set, or because the secret may be wrong or from another Vercel project. A redirect is noted: the proxy follows one only if it stays on the same origin. If it cannot be reached, you see why.
- **disable** / **enable** hides or shows it to the client without losing anything. A disabled page is "off", is not listed for the client and its address does not work.
- **remove** asks "Remove “<title>”?" ("Any link to <address> stops working. The content itself is untouched — it stays wherever it is hosted.") Choose **Remove page**. This also forgets who it was visible to. It cannot be undone, but you can add it again.

**Visible to** is explained in [Choose who sees a report or document](help:portal/restrict-who-opens-an-item).

## Changing a page

The screen only lets you add, test, switch on or off and remove. There is no way on screen to change a page's address, title, source or secret; to do that remove it and add it again (which resets who it is visible to).

## The page's own screen

Search results, links and the assistant's cards open `/portal/pages/<id>`: a reading screen, not a second editor. **Where it lives** shows the client (a link to their **Portal access** tab), the address (a link to the client's own view) and the status: "Visible to the client" or "Not visible yet — turn it on under Custom content". **Where it comes from** shows the source address, whether it is **Proxied** ("the client never sees this address") or **Redirect**, and whether a **Bypass secret** is "stored" or "none". Everything is changed under **Custom content** on the client.

## Good to know

- Build the report with a relative base (`base: './'` in Vite, `assetPrefix` in Next) so its files load under the page's address. Root-absolute URLs in HTML and CSS are rewritten as a fallback; URLs built in JavaScript are not.
- Adding, changing and removing pages is recorded in the audit log against the client, including the source address.
- The assistant can add a page too, but always switched off. See [Portal tickets and reports on a client page and in chat](help:portal/portal-cards-and-assistant).
