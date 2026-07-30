import Blockquote from '@tiptap/extension-blockquote';
import Highlight from '@tiptap/extension-highlight';
import markdownItMark from 'markdown-it-mark';

/**
 * Teaching the Markdown layer about `==highlight==`.
 *
 * `tiptap-markdown` ships specs for exactly five marks — bold, italic, strike, code, link —
 * and thirteen node types. Anything else hits a fallback that, with `html: false`, logs a
 * console warning and serialises to an empty string. So the Highlight button in the toolbar
 * has always been a lie: it applied a mark the next autosave silently deleted, and it read as
 * working right up until the page was reloaded.
 *
 * Worse, the note-taking behaviour's prompt lists `==highlight==` among the formatting it may
 * use, so the model has been emitting a syntax nothing could parse — arriving in documents as
 * literal `==text==`.
 *
 * Both directions are fixed here. `serialize` writes the `==` fences; `parse.setup` registers
 * markdown-it's own `mark` rule so they come back as a mark rather than as punctuation.
 *
 * This is the pattern for any future mark, and the reason to be sparing with them: a mark
 * without a spec is not a missing feature, it is data loss.
 */
export const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      /*
       * `markdown` is read by tiptap-markdown off each extension's storage. The shape is not
       * in TipTap's types — the library documents it rather than typing it — which is why this
       * is spelled out here once and not repeated per extension.
       */
      markdown: {
        serialize: {
          open: '==',
          close: '==',
          // Highlight carries no text of its own; the `==` fences wrap whatever it covers.
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup: (markdownIt: { use: (plugin: unknown) => void }) => {
            markdownIt.use(markdownItMark);
          },
        },
      },
    };
  },
});


/**
 * A blockquote that does not corrupt itself over an empty line.
 *
 * The shipped spec is prosemirror-markdown's `blockquote`, which wraps every child in `> `. An
 * empty paragraph as the FIRST child of a quote serialises to a bare `> ` line, and the next
 * child's opening `**` then comes out doubled:
 *
 *     > **Decision:** Weekly refresh      (correct)
 *     > \n> ****Decision:** Weekly refresh   (an empty first paragraph)
 *
 * Four asterisks do not parse back, so the bold is gone and two stray characters are in the
 * note — permanently, and with nothing on screen to say so. Reachable by putting the caret
 * before quoted text and pressing Enter, which is an ordinary thing to do.
 *
 * The fix is to drop empty paragraphs when serialising, because Markdown has no way to express
 * one inside a quote: a bare `>` line is a blank quoted line, which carries no information and
 * is exactly what the parser throws away on the way back in. So nothing is lost by not writing
 * it, and the collision cannot happen.
 *
 * Only serialisation is touched. An empty paragraph in a quote remains perfectly legal in the
 * editor while you are typing; it simply is not written down.
 */
export const MarkdownBlockquote = Blockquote.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            wrapBlock: (prefix: string, x: null, node: unknown, fn: () => void) => void;
            render: (node: unknown, parent: unknown, index: number) => void;
          },
          node: { childCount: number; child: (i: number) => { textContent: string; childCount: number } },
        ) {
          state.wrapBlock('> ', null, node, () => {
            let written = 0;
            for (let i = 0; i < node.childCount; i += 1) {
              const child = node.child(i);
              // An empty paragraph: no text and no inline children (so an image still counts).
              if (child.textContent.length === 0 && child.childCount === 0) continue;
              state.render(child, node, written);
              written += 1;
            }
            // A quote that held nothing but blank lines still needs a line, or the wrapper
            // emits a prefix with no content and the block after it is swallowed.
            if (written === 0) state.render(node.child(0), node, 0);
          });
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
