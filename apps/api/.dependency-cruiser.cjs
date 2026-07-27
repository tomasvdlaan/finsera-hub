/**
 * Architectural boundary rules (spec §2), enforced in CI via `pnpm boundaries`.
 *
 *  - modules may import core and @platform/contracts, never another module
 *  - core never imports modules (it learns about them via manifests at bootstrap)
 *  - shell imports core only, never modules
 *
 * These are the rules that keep modules replaceable. Breaking one should fail the build,
 * not be caught in review.
 */
module.exports = {
  forbidden: [
    {
      name: 'modules-no-cross-import',
      severity: 'error',
      comment:
        'A module may not import from another module. Cross-module calls go through the other module’s exported service token, declared in the manifest.',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/$1/' },
    },
    {
      name: 'core-no-modules',
      severity: 'error',
      comment:
        'Core must never depend on modules — it learns about them only through manifests at bootstrap.',
      from: { path: '^src/core/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'shell-no-modules',
      severity: 'error',
      comment: 'Shell composes module contributions via manifests, never direct imports.',
      from: { path: '^src/shell/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
