/**
 * Which build this is.
 *
 * The question being answered is "is the live site running what I pushed", and the honest
 * answer to that is a commit, not a number somebody remembered to raise. So the commit is
 * what identifies a build and the number is only there to be read aloud: `rev-list --count`
 * is the number of commits reachable from HEAD, so it rises by one with every commit and
 * needs nobody to maintain it.
 *
 * The alternative — a version in package.json, bumped and committed — was rejected for a
 * reason that is not style. Bumping it is itself a commit, and a commit on `production` is a
 * deploy, so every release would deploy twice: once for the change and once for the number
 * describing it. A version derived from history cannot fall out of step with the history.
 *
 * Values arrive as environment variables set by `deploy/update.sh` from the commit it has
 * just checked out. Unset is the ordinary case in development, and says so rather than
 * pretending to be version zero — "dev" is a true answer and `0` is a false one.
 */
export interface BuildInfo {
  /** Commits reachable from this build's HEAD. Rises by one per commit. */
  version: string;
  /** Short SHA. The only field that cannot be wrong about what is running. */
  commit: string;
  /** When the image was built, not when the commit was authored. */
  builtAt: string | null;
}

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    version: env.BUILD_VERSION || 'dev',
    commit: env.BUILD_COMMIT || 'dev',
    builtAt: env.BUILD_TIME || null,
  };
}
