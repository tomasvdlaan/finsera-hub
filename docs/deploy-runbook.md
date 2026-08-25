# Deployment runbook — hub.finsera.nl

Closes G0 criterion 9 (decision log): the stack verified on a real server rather than
only locally. Target is one **Netcup VPS 1000 G12** — 4 vCores, 8 GB, 256 GB NVMe,
€10.37/month including VAT.

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
- Access to DNS for finsera.nl at **ZXCS** (`ns.zxcs.eu/.be/.nl`).
- An SSH keypair. Upload the public key during server creation; never enable password
  login.

Note what already lives on this domain and must not be disturbed: the apex and `www`
point at Vercel (the marketing site), and MX points at Microsoft 365. Adding `hub` as
a new record touches neither.

## 1. Create the server

**VPS 1000 G12**, Nuremberg or Vienna, Ubuntu 24.04 or 26.04 LTS, your SSH key attached.
Note the IPv4 address.

Order it before you plan to deploy: Netcup runs manual identity checks on some new
accounts, so provisioning can take hours rather than minutes.

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
  headroom, but the growth is linear in document volume — size it again at Phase 3. Retention pruning only runs
  after a fully successful cycle, so failures cannot eat the good copies.
- **The client portal is not deployed.** It is absent from the production compose and
  will want its own hostname (`portal.finsera.nl`) and its own Zitadel application at
  Phase 7.
