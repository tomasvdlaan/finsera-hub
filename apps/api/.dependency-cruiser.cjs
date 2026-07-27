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
      // Master §10: "When module A needs data from module B, it calls B's internal API."
      //
      // Two files across a module boundary are legitimate:
      //   *.service.ts — the published API itself (Time reads a project budget from CRM)
      //   *.module.ts  — Nest's DI seam; importing it is how the dependency is declared,
      //                  which we WANT explicit so the graph stays visible and acyclic
      //
      // Everything else is internals. A schema import in particular would mean one
      // module reading another's tables, which is the single thing that makes modules
      // unreplaceable (Master §15.2).
      name: 'modules-no-internals-import',
      severity: 'error',
      comment:
        'A module may import another module’s *.service.ts (its API) or *.module.ts (DI wiring) — never its schema, controller, or manifest.',
      // Specs are exempt: an integration test composing two modules is the point of the
      // test, and test files never ship.
      from: { path: '^src/modules/([^/]+)/', pathNot: '\\.spec\\.ts$' },
      to: {
        path: '^src/modules/',
        pathNot: [
          '^src/modules/$1/',
          '^src/modules/[^/]+/[^/]+\\.service\\.ts$',
          '^src/modules/[^/]+/[^/]+\\.module\\.ts$',
        ],
      },
    },
    {
      name: 'core-no-modules',
      severity: 'error',
      comment:
        'Core must never depend on modules — it learns about them only through manifests at bootstrap.',
      // Specs excepted: composing core with real modules is what an integration test is for.
      from: { path: '^src/core/', pathNot: '\\.spec\\.ts$' },
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
