#!/bin/sh
# Become the dev server. Nothing else.
#
# This used to run `pnpm install` first, which is how both servers came to run one at the same
# moment against one shared volume and corrupt it. Installing is now the `deps` service's job,
# and compose will not start either server until it has exited cleanly — so by the time this
# runs, `node_modules` is populated and nobody else is writing to it.
set -e
cd /repo
echo "[dev] starting: $*"
exec "$@"
