# Deployment runbook — hub.finsera.nl

Closes G0 criterion 9 (decision log): the stack verified on a real server rather than
only locally. Target is one **Netcup VPS 1000 G12** in **Amsterdam** — 4 vCores, 8 GB
DDR5, 256 GB NVMe, €10.37/month including 19% German VAT (reverse-charged to ~€8.71
once a Dutch VAT ID is on the account).

Amsterdam because Netcup offers it and we are a Dutch company: the residency answer
becomes "in the Netherlands" rather than "somewhere in the EU", and latency to the
office is single-digit milliseconds.

Not Hetzner, which D4 names: their Cost-Optimized line (CX, CAX) is capacity
constrained and was not orderable when we provisioned, and the x86 plans that were
cost twice as much for half the memory. Netcup's G12 generation bills hourly with no
minimum term, which removes the contract inflexibility that ruled it out originally.
Nothing in the stack is provider-specific — it is Docker Compose and Caddy on Ubuntu
— so moving back to Hetzner later is an afternoon, not a migration.

The stack is deliberately identical to the local one. `deploy/.env` and DNS are the
only things that differ.

## 0. Before you start

- A Netcup account. No credit card needed — SEPA direct debit and PayPal both work.
  Netcup runs identity checks on some new customers, occasionally by phone, so order
  before the day you intend to deploy.
- Two panels, which is the confusing part. **CCP** (customercontrolpanel.de) holds
  billing and contracts. **SCP** (servercontrolpanel.de) manages the server itself —
  images, console, snapshots. Credentials for each arrive in separate emails, and both
  use email-token 2FA by default.
- Access to DNS for finsera.nl at **ZXCS** (`ns.zxcs.eu/.be/.nl`).
- An SSH keypair, generated for this server rather than reused from anything else.
  On Netcup the key is stored in the SCP *first*, then selected while installing the
  image — there is no key field at order time, which is the step people miss.

Note what already lives on this domain and must not be disturbed: the apex and `www`
point at Vercel (the marketing site), and MX points at Microsoft 365. Adding `hub` as
a new record touches neither.

## 1. Create the server

Order **VPS 1000 G12** in **Amsterdam**, with hourly billing unless you are certain —
the 12-month term is cheaper per month but a wrong choice is then yours for a year.

Ordering does not install an operating system. When the SCP credentials arrive:

1. SCP → **Options → SSH keys** → paste the public key (the `.pub` file, never the
   other one).
2. SCP → **Media → Images** → Ubuntu 24.04 or 26.04 LTS → select the stored SSH key,
   set timezone Europe/Amsterdam, and install.
3. Wait for the installation email, then `ssh root@<ip>`. If it asks for a password,
   the key was not selected during install — redo step 2 rather than falling back to
   password login.

Note the IPv4 address; it is in the SCP and in the setup email.

Netcup has no managed cloud firewall, so the host firewall is the firewall — step 3
sets it up. That is the one real ergonomic difference from Hetzner.

Do not skip the firewall on the theory that nothing is listening yet — Postgres
publishes no port in the production compose, but that is one typo away from changing.

## 2. DNS at ZXCS

| Type | Name  | Value                | TTL |
|------|-------|----------------------|-----|
| A    | `hub` | *(server IPv4)*      | 300 |
| AAAA | `hub` | *(server IPv6)*      | 300 |

Do this **before** first boot of the stack. Caddy requests a certificate on startup,
and Let's Encrypt rate-limits repeated failures against a name that does not resolve.

Wait for it: `dig +short hub.finsera.nl` must return your IP before step 5.

## 3. Prepare the host

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 git rsync curl gnupg ufw unattended-upgrades
```

**Firewall.** On Hetzner this was a managed object; here it runs on the host. Set it
before the stack starts, and add the SSH rule first — a firewall enabled without it
locks you out of your own server:

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable && ufw status verbose
```

Docker publishes ports by manipulating iptables directly and can bypass ufw. The
production compose publishes only 80 and 443 (Postgres has no `ports:` entry), so this
holds — but never add a `ports:` mapping to `postgres` and assume ufw will save you.

**Unattended security updates**, so patching is not a thing you have to remember:

```bash
dpkg-reconfigure -plow unattended-upgrades
```

**Swap** is optional at 8 GB — the workspace install plus the Vite build fits. Add it
anyway if you would rather the first build be slow than fail:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Get the code and configure

```bash
git clone https://github.com/tomasvdlaan/finsera-hub.git /opt/finsera
cp /opt/finsera/deploy/.env.example /opt/finsera/deploy/.env
```

Edit `/opt/finsera/deploy/.env`:

- `SITE_ADDRESS=hub.finsera.nl`, `HTTP_PORT=80`, `HTTPS_PORT=443` — the 8080/8443
  defaults leave the certificate un-issuable and the site unreachable at its own name.
- `POSTGRES_PASSWORD` — generate one (`openssl rand -base64 32`). The G0 follow-up
  list has been waiting on this.
- `GOOGLE_GENERATIVE_AI_API_KEY`, and `MODEL_STRONG` / `MODEL_FAST`.
- `RECALL_API_KEY` and `RECALL_WEBHOOK_BASE=https://hub.finsera.nl`. **Rotate the
  Recall key first** — the current one is committed in the tracked root `.env.example`
  and the repo is on GitHub. Replace it there with an empty placeholder.

## 5. Bring it up

```bash
cd /opt/finsera && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Migrations run at boot, so the API reporting healthy means it is genuinely ready.

```bash
docker compose -f deploy/docker-compose.yml ps
curl -sI https://hub.finsera.nl/api/core/health
```

All four services should read `healthy` or `running`. The `backup` service takes a
backup immediately on start, so it turns healthy within a couple of minutes; if it
stays unhealthy, nothing has been written to `deploy/backups` and that is the point of
the check.

## 6. Zitadel

In the Zitadel console, on the existing SPA application, add:

- Redirect URI: `https://hub.finsera.nl/auth/callback`
- Post-logout URI: `https://hub.finsera.nl/`

Keep the localhost entries for development. No code change is needed — the SPA derives
both from `window.location.origin`.

Login still redirects through `finsera-dashboard-nsncri.eu1.zitadel.cloud`. Custom auth
domains are not on the free tier; it is cosmetic.

## 7. Off-site backups

Until this is done, every copy of the database is on the machine holding the database.

Set `BACKUP_REMOTE` (and `BACKUP_REMOTE_SSH_PORT=23` for a Hetzner Storage Box) plus
`BACKUP_HEARTBEAT_URL` and ideally `BACKUP_ENCRYPT_PASSPHRASE_FILE` in `deploy/.env`,
put the server's public key on the remote, then:

```bash
/opt/finsera/deploy/offsite.sh
```

It refuses to push a stale backup and exits non-zero on every failure path, so the
heartbeat only fires on a genuine success. Once it passes by hand, add it to cron:

```
30 4 * * * /opt/finsera/deploy/offsite.sh >> /var/log/finsera-offsite.log 2>&1
```

Then register the matching check on healthchecks.io (free) so a ping that stops
arriving reaches you by email.

There is no one-click whole-machine backup product here, so this step *is* your data
protection rather than a supplement to it. Do not defer it past the first real record
entered.

## 8. Verify, then trust

```bash
/opt/finsera/deploy/restore.sh
```

This restores the latest backup into a scratch database (never over production),
prints row counts, and checks every `docs.versions.storage_key` exists in the file
archive. Run it now, and quarterly after that. Backups decay quietly; the drill is the
only thing that says otherwise.

## 9. The client portal (Phase 8)

The portal is served by the API on its own hostnames, not by Caddy from disk: on a portal
host a path is either the API, a page the client was given, or the portal bundle, and only
the API can tell. `deploy/Dockerfile.api` builds `apps/portal` into the image; Caddy's
second site block proxies the portal hostnames to it wholesale.

Each client gets their own hostname, `<slug>.finsera.nl`, and `portal.finsera.nl` is the
login host every sign-in passes through. Certificates are issued per hostname on first
use, so adding a client is setting their portal address in hub and nothing else.

1. **DNS at ZXCS:** a wildcard `*` `A` + `AAAA` → the server, plus `portal` `A` + `AAAA`
   → the server. A wildcard only answers for names that have no record of their own, so
   `hub`, the apex, `www` and MX are untouched — but do not remove them, because that is
   what keeps them off the wildcard.
2. **`deploy/.env`:**
   ```
   PORTAL_AUTH_ADDRESS=portal.finsera.nl
   PORTAL_CLIENT_ADDRESS=https://
   PORTAL_BASE_DOMAIN=finsera.nl
   PORTAL_AUTH_HOST=portal.finsera.nl
   PORTAL_SESSION_SECRET=<openssl rand -base64 32>
   PORTAL_PAGE_KEY=<openssl rand -base64 32>
   PORTAL_ASK_TOKEN=<openssl rand -hex 16>
   PORTAL_ASK_URL=http://api:3001/api/portal-host/check?t=<the same token>
   ```
   The API refuses to boot in production without `PORTAL_SESSION_SECRET`. `PORTAL_PAGE_KEY`
   encrypts the per-page Vercel bypass secrets — without it a report has to be publicly
   reachable, which is the thing proxying it was meant to avoid. The ask token keeps the
   certificate endpoint from being a list of which clients exist. The first three are what
   make any portal host resolve at all.
3. **Zitadel, on the portal application:** add the redirect URI
   `https://portal.finsera.nl/api/portal-auth/callback` and the post-logout URI
   `https://portal.finsera.nl/api/portal-auth/signed-out`. Those are the only two it will
   ever need, however many clients there are — every client host hands off from the first
   and returns through the second (P2). In development they are
   `http://localhost:5174/api/portal-auth/callback` and
   `http://localhost:5174/api/portal-auth/signed-out`.
   Optionally switch the application from a public SPA to a confidential web application
   and put its secret in `ZITADEL_PORTAL_CLIENT_SECRET`; PKCE is used either way, so this
   can wait.
4. Deploy as usual.

**Never put a wildcard hostname in `PORTAL_CLIENT_ADDRESS`.** It is `https://`, a catch-all.
A `*` in a Caddy site address is a domain Caddy *manages*, so it tries to obtain a real
wildcard certificate — which only the DNS-01 challenge can issue, which needs a provider
plugin this build does not have. The failed attempt does not stay in its own corner: it
stopped TLS being served for every name on the server, `hub` included. That happened once,
on 2026-09-03, and the symptom was a TLS handshake alert rather than anything in the log.

**How a certificate appears.** Caddy has on-demand TLS for the portal hostnames and asks
the API first (`/api/portal-host/check?domain=`), which answers 200 only for the login
host and for slugs a client actually has. So `duce.finsera.nl` gets its certificate on
the first visit and `typo.finsera.nl` never reaches Let's Encrypt — which matters,
because the certificate authority counts refusals against a weekly limit for the whole
domain. `hub.finsera.nl` keeps its own site block and is matched before the wildcard.

**Onboarding a client** is done in hub, on the client's page: set the **portal address**
(`duce` → `duce.finsera.nl`), then invite logins under *Portal access*. The invite button
is disabled until the address exists. Their portal is live at that hostname immediately —
no deploy, no DNS record, no restart. Changing the address later breaks links they
already have, and the field says so.

**Employees do not need an invitation.** Anyone with an active internal account can open
any client's portal at its own address and sign in with their ordinary Zitadel account
(P5). The page then carries a banner naming whose portal it is, and the client's own
actions — accepting a quote, submitting a request — are refused: those are statements by
the client. Staff reads are audited under the employee's own id.

**Signing out** ends both sessions: ours, and the one at Zitadel. That second half matters
more than it sounds — without it the next press of *Inloggen* returns the same person
without asking, so on a shared machine the button logs nobody out. It needs the post-logout
URI above registered; without it Zitadel still ends the session but shows its own page
instead of returning to the portal.

**Revoking a client's access** is *Revoke* on their client page; every session they hold ends in
the same commit. Deactivating a colleague internally ends their staff portal sessions the
same way. Clearing a client's portal address, or archiving the client, takes their whole
portal away immediately — including any session already open.

### Giving a client a custom report

Reports are built and hosted wherever they already are, usually Vercel. On the client's
page in hub, under **Custom content**, add a page: a title, an address (`rapportage-q3` →
`duce.finsera.nl/rapportage-q3/`), the source URL, and the Vercel protection-bypass secret
if the deployment is protected. *Test* makes one real request from the server and reports
what came back, which is how the three indistinguishable failures — no secret, wrong
secret, unreachable URL — get told apart.

The API fetches the report itself, so the source URL never reaches the client's browser and
the Vercel project can keep Deployment Protection on. Two things are worth knowing when
building one:

- **Build it with a relative base** (`base: './'` in Vite, `assetPrefix` in Next). Assets at
  root-absolute paths would resolve against the portal instead of the page; HTML and CSS are
  rewritten as a fallback, but a URL assembled in JavaScript is not.
- **A report cannot call the portal's API.** Proxied pages carry a content-security policy
  with `connect-src 'none'`, so a script inside a report cannot use the visitor's session.

### Tickets and visible tasks

*Client tickets* in the internal navigation is the inbox: every open conversation across
every client, oldest first. Replying there is what the client sees in their portal; an
*internal note* stays with us. *Make a task* is still a deliberate act by somebody who has
read the thread, and it no longer closes the ticket.

A task appears in a client's portal only when somebody ticks **Visible to the client** on
it. They see the title, status, type, due date and whether it is done — never the
description, assignee, estimate or labels. The assistant cannot set that flag.

## Deploying changes afterwards

```bash
cd /opt/finsera && git pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Volumes survive rebuilds, restarts and reboots. The one command that destroys them is
`docker compose down -v` — the `-v` is the entire difference. Never run it here.

## Known gaps at go-live

- **Up to 24 hours of data loss** — nightly dumps, no WAL archiving. Acceptable for a
  team of 2–4; revisit if it stops being.
- **Disk pressure from backups.** Each nightly run writes a *full* tarball of the
  documents directory and keeps 30 of them, on the same disk. 256 GB buys a lot of
  headroom, but the growth is linear in document volume — size it again at Phase 3.
  Retention pruning only runs after a fully successful cycle, so failures cannot eat
  the good copies.
- ~~**The client portal is not deployed.**~~ Closed by Phase 8 step 1 — see §9.
