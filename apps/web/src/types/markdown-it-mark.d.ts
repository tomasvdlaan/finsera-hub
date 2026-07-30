/**
 * markdown-it-mark ships no types.
 *
 * It is a markdown-it plugin, and markdown-it's own plugin signature is `(md, ...params)`.
 * Declared narrowly rather than as `any` so a wrong call site is still an error.
 */
declare module 'markdown-it-mark' {
  const plugin: (md: unknown) => void;
  export default plugin;
}
