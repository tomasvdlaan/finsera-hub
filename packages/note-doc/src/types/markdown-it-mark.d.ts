/**
 * markdown-it-mark ships no types.
 *
 * It is a plain markdown-it plugin — `md.use(markdownItMark)` — so the only shape that
 * matters is that it is something `use` accepts.
 */
declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it';

  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
