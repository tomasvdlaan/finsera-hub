---
title: Signing in and out
summary: How you get into the platform, what happens when your session ends, and how to sign out.
module: shell
paths: []
keywords: [login, log in, logout, log out, password, session, expired, deactivated, no access, zitadel, account]
updated: 2026-10-23
---

You sign in through the company's identity provider, not with a password stored in the platform. The platform only knows who you are once you have signed in there.

## Steps

### Sign in
1. Open the platform. If you are not signed in, you see **Finsera Platform** and a **Sign in** button.
2. Select **Sign in**. You are taken to the identity provider's login page, which is shown in Dutch.
3. Enter your credentials there. You are sent back to the platform and land on [Today](help:shell/today).

### Sign out
1. Select your avatar (the round letter at the top right).
2. Select **Sign out**.

You are signed out of the platform on this device straight away, and the identity provider is asked to end its session as well. Sign out always works, even when the platform is refusing your account.

## When something goes wrong

- **"Your session expired, so it has been signed out. Sign in to carry on."** Your sign-in was no longer accepted. Select **Sign in** again.
- **"Sign-in failed: …"** under the button means the sign-in could not be completed. Try again; if it keeps failing, tell an administrator what the message says.
- **"No access to the platform."** You signed in correctly, but the platform will not let this account in. Signing in again gives the same answer. Either the account has been deactivated, or it has not been given access to the platform at the identity provider. An administrator has to put this right. Use **Sign out** in the avatar menu.
- **You cannot sign in at all.** An administrator can check your login account from your page under [People](help:shell/person-page): it shows whether the account is active, whether the email is verified, and whether a password has ever been set. "Never - invitation still open" means you have not completed your invitation yet.

## Good to know

- **The first person to sign in becomes the administrator.** Everyone after that starts as a member. An administrator can change that later in [One colleague's page](help:shell/person-page).
- **Nobody can be added from inside the platform.** A colleague appears in [People](help:shell/people) the first time they sign in, after an administrator has granted them access at the identity provider.
- **Your sign-in lives in the browser tab.** It is kept for the tab and is not remembered once the tab is closed, so a new tab starts with the sign-in screen. The platform renews it quietly while you work.
- **Deactivating a colleague** signs them out and refuses their next sign-in. Their hours and cards stay attached to them.
- **Portal clients** sign in to their own portal, not here. See [The client portal](help:portal/index).
