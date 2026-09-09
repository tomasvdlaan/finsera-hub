# A dev server that outlives the terminal

Hot reloading needs the Vite and Nest dev servers, not the container stack — the container
serves a build, so a code change reaches it only through `--build`. The problem with dev
servers has never been the servers; it is who owns them. Started from a terminal or a chat
session, they are children of it, and they die when it closes.

launchd is the supervisor macOS already has. It starts these at login, restarts them if they
exit, and has no parent of its own to outlive.

## Install

Two agents: the API on 3001, and Vite on 5173 with HMR.

```bash
mkdir -p ~/Library/Logs/finsera
cp deploy/dev-agents/nl.finsera.dashboard.*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/nl.finsera.dashboard.api.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/nl.finsera.dashboard.web.plist
```

**Free port 5173 first.** The container stack publishes caddy there, and two servers on one
port do not conflict loudly — a dev server binding `[::1]:5173` silently shadows a container
on `*:5173`, because the more specific binding wins. Everything then reaches the dev server
while the container sits behind it, which is exactly the confusion this file exists to end.

```bash
docker compose -f deploy/docker-compose.yml stop caddy
```

`stop` is durable: `restart: unless-stopped` does not restart a container that was stopped on
purpose, so it stays down across reboots until you start it again.

## Check

```bash
launchctl list | grep finsera          # pid and last exit status
tail -f ~/Library/Logs/finsera/web.log # or api.log
```

`launchctl list` printing a PID means it is running; a `-` in the first column with a non-zero
second column means it exited and is being retried.

## Stop, or remove

```bash
launchctl bootout gui/$UID/nl.finsera.dashboard.web
launchctl bootout gui/$UID/nl.finsera.dashboard.api
rm ~/Library/LaunchAgents/nl.finsera.dashboard.*.plist
```

## What each one needs

- **The dev database.** Both read `.env` at the repo root, which points at
  `postgres://platform:platform@localhost:5432/platform` — the `dashboard-postgres-1`
  container from the root `docker-compose.yml`, not the one inside the deploy stack. Those
  are two different databases with two different sets of rows. It is set to
  `restart=unless-stopped`, so it comes back on its own after a reboot.
- **Absolute paths.** launchd starts with almost no environment, so the plists name
  `/Users/tomasvanderlaan/.local/bin/pnpm` outright and put `/usr/local/bin` on `PATH` for
  node. Move the repo or the toolchain and both plists need editing.

## Going back to the container

The two are alternatives, not neighbours — they want the same port.

```bash
launchctl bootout gui/$UID/nl.finsera.dashboard.web
HTTP_PORT=5173 docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d caddy
```
