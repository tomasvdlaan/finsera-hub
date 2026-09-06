/**
 * Which build the browser is running, and whether it matches the server.
 *
 * Two builds are in play at once and people forget it: the SPA is static files the browser
 * caches, and the API is a process that restarts. After a deploy the server is new and the
 * open tab is old, and every symptom of that looks like a bug in the feature rather than a
 * stale bundle — a button that calls an endpoint the old code does not know about, a field
 * that is missing because the old bundle never rendered it.
 *
 * So the version is not one number. It is what this bundle was built as, what the server says
 * it is, and whether they agree.
 */

/** Inlined by Vite at build time from the args in deploy/Dockerfile.web. */
export const BUILD = {
  version: import.meta.env.VITE_BUILD_VERSION ?? 'dev',
  commit: import.meta.env.VITE_BUILD_COMMIT ?? 'dev',
  builtAt: import.meta.env.VITE_BUILD_TIME || null,
};

export interface ServerBuild {
  status: string;
  version: string;
  commit: string;
  builtAt: string | null;
}

/**
 * How this bundle stands against the server that is answering it.
 *
 * `dev` on either side means the question does not apply — a local build has no version to
 * compare and saying "out of date" about it would be noise on every developer's screen.
 */
export function compare(
  server: ServerBuild | null,
  /* The running bundle by default. Injectable so the comparison can be tested at all: in a
     test process nothing is inlined, so `BUILD.commit` is always 'dev' and a test that read
     it could only ever exercise the branch that declines to answer. */
  local: { commit: string } = BUILD,
): 'unknown' | 'match' | 'stale' {
  if (!server) return 'unknown';
  if (local.commit === 'dev' || server.commit === 'dev') return 'unknown';
  return local.commit === server.commit ? 'match' : 'stale';
}

/** `1-800-abc1234` reads as nothing; `v128 · abc1234` reads as a build. */
export function label(build: { version: string; commit: string }): string {
  return build.version === 'dev' ? 'dev build' : `v${build.version} · ${build.commit}`;
}
