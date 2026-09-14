/**
 * `URL`, declared rather than borrowed from a lib.
 *
 * This package must run in a browser (both front ends render messages) and in Node (so the
 * parser can be tested, and so the API could use it later). The shared tsconfig sets
 * `lib: ["ES2023"]` and nothing else, which is deliberate: pulling in `DOM` would put
 * `document` and `window` in scope for a package that must never touch either, and pulling
 * in Node's types would do the same for `process`.
 *
 * `URL` is a WHATWG global that both runtimes have had for years. Only the two members the
 * link check uses are declared, so this cannot quietly become a licence to use more.
 */
declare const URL: {
  new (input: string): { protocol: string; toString(): string };
};
