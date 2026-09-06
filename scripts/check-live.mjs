#!/usr/bin/env node
/**
 * Is the live site running what I pushed?
 *
 * The question this whole build-stamp exists to answer, asked from the machine the work was
 * done on. It reads the deployed API's health endpoint — public, and the same one the deploy
 * polls — and compares the commit it reports against the local branch.
 *
 * Compares COMMITS, not version numbers. A rollback deploys an older commit whose count is
 * lower, and "live is behind by -3" is not a sentence anybody should have to interpret.
 *
 * Deliberately a script rather than a test, like the other checks in here: it talks to a
 * server over the internet and its answer is about a deployment, not about this checkout.
 */
import { execSync } from 'node:child_process';

const site = process.env.LIVE_URL ?? 'https://hub.finsera.nl';
const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const res = await fetch(`${site}/api/core/health`, { signal: AbortSignal.timeout(15_000) }).catch(
  (e) => {
    console.error(`✖ could not reach ${site} — ${e.message}`);
    process.exit(2);
  },
);
if (!res.ok) {
  console.error(`✖ ${site} answered ${res.status} ${res.statusText}`);
  process.exit(2);
}

const live = await res.json();
if (live.commit === 'dev' || !live.commit) {
  console.error(`✖ ${site} reports no build stamp — it is running a build from before this existed.`);
  process.exit(2);
}

const head = git('git rev-parse --short HEAD');
const branch = git('git rev-parse --abbrev-ref HEAD');
console.log(`live   v${live.version} · ${live.commit}${live.builtAt ? ` · built ${live.builtAt}` : ''}`);
console.log(`local  ${branch} · ${head}`);

if (live.commit === head) {
  console.log('\n✔ live is running your current commit');
  process.exit(0);
}

/*
 * How far apart, in commits, and in which direction. `--left-right` counts both sides at
 * once, which is what distinguishes "you have not pushed yet" from "somebody deployed
 * something you do not have" — two situations with very different next steps.
 */
let behind = '?';
let ahead = '?';
try {
  git(`git cat-file -e ${live.commit}^{commit}`);
  [behind, ahead] = git(`git rev-list --left-right --count ${live.commit}...HEAD`).split(/\s+/);
} catch {
  console.log(`\n✖ live is at ${live.commit}, which this checkout does not have — fetch first.`);
  process.exit(1);
}

console.log(
  `\n✖ live is NOT your current commit` +
    (Number(ahead) > 0 ? `\n  ${ahead} commit(s) here are not deployed` : '') +
    (Number(behind) > 0 ? `\n  ${behind} deployed commit(s) are not in this branch` : ''),
);
process.exit(1);
