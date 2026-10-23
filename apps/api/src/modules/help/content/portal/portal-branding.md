---
title: Logo and welcome line
summary: Put the client's logo beside ours in their portal, and set the welcome line and contact person they see on the front page.
module: portal
paths: [/clients/:id/access]
capability: portal.admin
keywords: [logo, branding, welcome line, welcome, contact person, owner, portal header, white label]
updated: 2026-10-23
---

A client's portal is Finsera's, at the client's address. Two small touches make it feel like theirs: their logo beside the Finsera name in the header, and a personal line on the front page.

## Logo

1. Open the client's **Portal access** tab and find the **Who can sign in** panel.
2. Next to **Logo:** press the file chooser and pick a PNG or JPEG.
3. Wait for "saved" to appear.

To go back to no logo, press **remove**. Needs `portal.admin`.

- Only PNG and JPEG are accepted, up to 1 MB. Anything else is refused with a message beside the control ("A logo has to be a PNG or a JPEG", "A logo is limited to 1 MB").
- It sits next to the Finsera name in the portal's header. It does not replace it.
- Replacing the logo deletes the old file.

## Welcome line

The welcome line is one sentence shown on the front page of the portal under the greeting, for example from the person they deal with. It is set in the client's **Their address** panel on the same tab, once the client has a portal address. See [Give a client a portal address](help:crm/client-portal-access) for the steps.

## Contact person

The front page of the portal ends with **Uw contactpersoon**, showing the name and email address of the client's **owner** (set on the client in CRM, and only if that colleague is active). If the client has no owner, the section is not shown. See [CRM](help:crm/index).

## Good to know

- Changing the portal address breaks links the client already has, because the address is the portal's name.
- Setting or clearing the logo is written to the audit log against the client.
