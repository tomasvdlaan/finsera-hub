/**
 * The small amount of formatting a ticket message is allowed to carry.
 *
 * Phase 9 P5. A ticket thread is the one screen where a client's words and ours meet, and
 * until now both sides were plain text — deliberately, because nothing anybody types should
 * become markup. This keeps that promise and still lets a message about an invoice link to
 * the invoice.
 *
 * **It returns a tree, not HTML.** That is the whole security design. A renderer that
 * produced an HTML string would need a sanitiser, and a sanitiser is a list of everything
 * dangerous that somebody has thought of so far. Here the output is a closed set of nodes
 * with `string` leaves: each app maps them to React elements, React escapes every leaf by
 * construction, and there is no `dangerouslySetInnerHTML` anywhere in the path. A `<script>`
 * a client types is a text node that reads `<script>`.
 *
 * **What is supported, and nothing else:** bold, italic, inline code, links, bullet lists,
 * numbered lists, paragraphs. No images (that is attachments, P6, and wants its own security
 * pass), no headings (a message is not a document), no raw HTML, no tables, no block quotes.
 *
 * **A single newline is a line break**, as it is in every chat box people have used. Strict
 * Markdown would join those lines into one paragraph — which would silently reflow every
 * message written before this existed, when both sides were plain text rendered with
 * `white-space: pre-wrap`. Formatting that rewrites old messages is not a feature.
 *
 * **Stored as source.** The database column is unchanged, and the `length BETWEEN 1 AND 5000`
 * check therefore keeps meaning what it says. HTML or ProseMirror JSON in that column would
 * make 5000 mean roughly a third as much prose, silently, and would put a client's markup in
 * a place every backup copies.
 */

/** A run of formatted text. `text` and `code` are leaves; the rest nest. */
export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  /** `href` has already been checked; anything that failed is a `text` node instead. */
  | { type: 'link'; href: string; children: Inline[] };

/** A paragraph, or one of the two kinds of list. Lists hold one inline run per item. */
export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbers'; start: number; items: Inline[][] };

/**
 * The only schemes a link may use.
 *
 * An allow-list, because the interesting ones are not `javascript:` alone: `data:text/html`
 * is a page, `vbscript:` still exists, and a browser will happily follow an app scheme.
 * Anything not on this list is rendered as the text somebody typed, which is both safe and
 * honest — the address is still readable, it simply is not clickable.
 */
const SCHEMES = ['http:', 'https:', 'mailto:'];

const BULLET = /^[-*]\s+(.*)$/;
const NUMBER = /^(\d{1,9})[.)]\s+(.*)$/;

/**
 * A message, parsed.
 *
 * Total: every string is a valid message. There is no syntax error to report, because the
 * author is a client writing a sentence, not a programmer — anything this does not
 * recognise stays the characters they typed.
 */
export function parseMessage(source: string): Block[] {
  const blocks: Block[] = [];
  // \r\n from a Windows paste would otherwise leave a stray carriage return inside a text
  // node, which renders as nothing and breaks the "what you typed is what you see" claim.
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let list: { type: 'bullets' | 'numbers'; start: number; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => parseInline(item));
    blocks.push(
      list.type === 'bullets'
        ? { type: 'bullets', items }
        : { type: 'numbers', start: list.start, items },
    );
    list = null;
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBER.exec(line);

    if (bullet) {
      flushParagraph();
      // A bullet after a numbered list starts a new list rather than joining it: two kinds
      // of marker means the author meant two lists.
      if (list?.type !== 'bullets') flushList();
      list ??= { type: 'bullets', start: 1, items: [] };
      list.items.push(bullet[1] ?? '');
      continue;
    }

    if (numbered) {
      flushParagraph();
      if (list?.type !== 'numbers') flushList();
      // The first number is honoured, so a list that starts at 3 renders starting at 3.
      list ??= { type: 'numbers', start: Number(numbered[1]) || 1, items: [] };
      list.items.push(numbered[2] ?? '');
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

/**
 * The inline scanner.
 *
 * One pass, taking whichever marker opens earliest, so `**bold with `code`**` and
 * `` `a * b` `` both come out the way they were written rather than depending on which
 * pattern happened to be tried first. Code is a leaf and is never re-parsed — backticks are
 * how somebody quotes a literal asterisk.
 *
 * Unmatched markers are text. `2 * 3 * 4` is arithmetic, not emphasis, and the cost of
 * being clever there is a client's sentence silently losing characters.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;

  const push = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.value += value;
    else out.push({ type: 'text', value });
  };

  while (rest.length > 0) {
    const match = firstMarker(rest);
    if (!match) {
      push(rest);
      break;
    }

    push(rest.slice(0, match.index));
    out.push(match.node);
    rest = rest.slice(match.index + match.length);
  }

  return out;
}

interface Marker {
  index: number;
  length: number;
  node: Inline;
}

function firstMarker(source: string): Marker | null {
  const candidates: Array<Marker | null> = [
    // Code first only in the sense of listing; the earliest index still wins below.
    capture(source, /`([^`\n]+)`/, (m) => ({ type: 'code', value: m[1] ?? '' })),
    capture(source, /\[([^\]\n]+)\]\(([^)\s]+)\)/, (m) => link(m[1] ?? '', m[2] ?? '')),
    capture(source, /\*\*([^\n]+?)\*\*/, (m) => ({ type: 'strong', children: parseInline(m[1] ?? '') })),
    capture(source, /\*([^*\n]+?)\*/, (m) => ({ type: 'em', children: parseInline(m[1] ?? '') })),
    // Bare URLs, because people paste them. Stops at the punctuation that ends a sentence
    // rather than swallowing it: "see https://x.nl." should not link the full stop.
    capture(source, /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/, (m) => bare(m[0])),
  ];

  let best: Marker | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Earliest wins; on a tie the earlier-listed pattern does, which is why code is first —
    // a backtick's contents must not be reinterpreted by a later marker.
    if (!best || candidate.index < best.index) best = candidate;
  }
  return best;
}

function capture(
  source: string,
  pattern: RegExp,
  build: (m: RegExpExecArray) => Inline,
): Marker | null {
  const m = pattern.exec(source);
  if (!m) return null;
  return { index: m.index, length: m[0].length, node: build(m) };
}

/**
 * A pasted address, linked to itself.
 *
 * Its own function rather than `link(url, url)` because the label of a bare URL is the URL,
 * and re-parsing that label finds the same bare URL again — which recurses until the stack
 * ends. The label here is a literal text node and is never scanned, which is also what any
 * reader would expect: a pasted address is an address, not something to reinterpret.
 */
function bare(url: string): Inline {
  const safe = safeHref(url);
  return safe
    ? { type: 'link', href: safe, children: [{ type: 'text', value: url }] }
    : { type: 'text', value: url };
}

/** A link if the address is one we are willing to make clickable, and text if it is not. */
function link(text: string, href: string): Inline {
  const safe = safeHref(href);
  return safe
    ? { type: 'link', href: safe, children: parseInline(text) }
    : // Deliberately shows what was typed, rather than dropping it: a client who pasted
      // something odd can still read it back, and nobody is quietly edited.
      { type: 'text', value: text === href ? href : `${text} (${href})` };
}

/**
 * The address, or null.
 *
 * Parsed with `URL` rather than matched with a regex: a regex has to anticipate every way a
 * scheme can be spelled — leading whitespace, embedded newlines, `JaVaScRiPt:`, percent
 * encoding — and `URL` normalises all of that before the check happens.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  // A protocol-relative address inherits the page's scheme and is a different host: on a
  // client portal that is a link off the portal wearing a path's clothes.
  if (trimmed.startsWith('//')) return null;
  try {
    const url = new URL(trimmed);
    return SCHEMES.includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Whether a message uses any formatting at all.
 *
 * For the one decision a UI has to make about old content: a message written before this
 * existed is plain text, and rendering it through the parser must look identical to the
 * `white-space: pre-wrap` it had before. It does — but this lets a caller say so cheaply.
 */
export function hasFormatting(source: string): boolean {
  return parseMessage(source).some(
    (block) =>
      block.type !== 'paragraph' ||
      block.children.some((inline) => inline.type !== 'text'),
  );
}


/**
 * What a formatting button does to a box of text.
 *
 * Here rather than in the two toolbars for the same reason the parser is here: this is a
 * rule, and the components are glue. Where the caret lands, what happens to a selection,
 * and where a list marker goes are decisions about the markup language — so they live with
 * the language, are tested as pure functions, and cannot drift between hub and the portal.
 *
 * Pure: it is told the text and the selection and returns the new ones. The caller does the
 * one thing only it can, which is applying the change through the textarea so the browser's
 * own undo history survives.
 */
export type Format = 'strong' | 'em' | 'code' | 'link' | 'bullet';

const WRAPS: Record<Exclude<Format, 'bullet'>, { before: string; after: string }> = {
  strong: { before: '**', after: '**' },
  em: { before: '*', after: '*' },
  code: { before: '`', after: '`' },
  // The caret lands on the text, not in the URL: somebody clicking Link is naming the
  // thing first, and an empty `https://` is a prompt rather than something to delete.
  link: { before: '[', after: '](https://)' },
};

export interface Edit {
  /** What to insert, and over which range of the original text. */
  text: string;
  start: number;
  end: number;
  /** Where the caret should be afterwards, relative to the whole value. */
  caret: number;
}

export function applyFormat(value: string, start: number, end: number, format: Format): Edit {
  if (format === 'bullet') {
    /*
     * A list marker belongs at the start of the line, wherever the caret happens to be
     * inside it. Inserting at the caret instead puts a bullet in the middle of a sentence,
     * which is what every hand-rolled toolbar does once and nobody tests.
     */
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    // Already a bullet: leave it alone rather than producing `- - `.
    if (/^[-*]\s/.test(value.slice(lineStart))) {
      return { text: '', start: lineStart, end: lineStart, caret: start };
    }
    return { text: '- ', start: lineStart, end: lineStart, caret: start + 2 };
  }

  const { before, after } = WRAPS[format];
  const selected = value.slice(start, end);
  return {
    text: before + selected + after,
    start,
    end,
    // With a selection the caret goes after what was wrapped; without one it goes between
    // the markers, because the person is about to type the words.
    caret: selected ? start + before.length + selected.length + after.length : start + before.length,
  };
}
