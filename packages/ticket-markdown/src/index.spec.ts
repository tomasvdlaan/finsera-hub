import { describe, expect, it } from 'vitest';
import {
  applyFormat,
  hasFormatting,
  parseInline,
  parseMessage,
  safeHref,
  type Inline,
} from './index.js';

/** The text a tree carries, for the assertions that are about content rather than shape. */
const text = (nodes: Inline[]): string =>
  nodes
    .map((n) =>
      n.type === 'text' || n.type === 'code' ? n.value : text(n.children),
    )
    .join('');

describe('what a message may contain', () => {
  it('reads plain text as plain text', () => {
    expect(parseMessage('Hallo, waar staat de factuur?')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: 'Hallo, waar staat de factuur?' }] },
    ]);
  });

  it('keeps a single newline as a line break inside one paragraph', () => {
    /*
     * The compatibility assertion, and the reason this is not strict Markdown.
     *
     * Every message written before formatting existed is plain text that was rendered with
     * `white-space: pre-wrap`. Joining these two lines into one — which strict Markdown
     * does — would silently reflow years of other people's words. Formatting that rewrites
     * old messages is not a feature.
     */
    const [block] = parseMessage('Eerste regel\nTweede regel');
    expect(block).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'Eerste regel\nTweede regel' }],
    });
  });

  it('splits paragraphs on a blank line', () => {
    expect(parseMessage('Een\n\nTwee')).toHaveLength(2);
  });

  it('reads both kinds of list, and keeps a numbered list starting where it starts', () => {
    expect(parseMessage('- een\n- twee')).toEqual([
      {
        type: 'bullets',
        items: [[{ type: 'text', value: 'een' }], [{ type: 'text', value: 'twee' }]],
      },
    ]);
    const [numbered] = parseMessage('3. derde\n4. vierde');
    expect(numbered).toMatchObject({ type: 'numbers', start: 3 });
  });

  it('does not let one kind of list swallow the other', () => {
    const blocks = parseMessage('- een\n1. twee');
    expect(blocks.map((b) => b.type)).toEqual(['bullets', 'numbers']);
  });

  it('reads bold, italic and inline code', () => {
    expect(parseInline('**vet** en *schuin* en `code`')).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'vet' }] },
      { type: 'text', value: ' en ' },
      { type: 'em', children: [{ type: 'text', value: 'schuin' }] },
      { type: 'text', value: ' en ' },
      { type: 'code', value: 'code' },
    ]);
  });

  it('leaves an unmatched marker as the character somebody typed', () => {
    // `2 * 3 * 4` is arithmetic. Being clever here costs a client characters out of their
    // own sentence, which is worse than not italicising something.
    expect(text(parseInline('2 * 3 = 6'))).toBe('2 * 3 = 6');
    expect(parseInline('2 * 3 = 6').every((n) => n.type === 'text')).toBe(true);
  });

  it('never reinterprets what is inside backticks', () => {
    const [node] = parseInline('`**not bold**`');
    expect(node).toEqual({ type: 'code', value: '**not bold**' });
  });
});

describe('links, which are the only part that can hurt anybody', () => {
  it('links http, https and mailto', () => {
    expect(parseInline('[de factuur](https://hub.finsera.nl/money/invoices/1)')).toEqual([
      {
        type: 'link',
        href: 'https://hub.finsera.nl/money/invoices/1',
        children: [{ type: 'text', value: 'de factuur' }],
      },
    ]);
    expect(parseInline('[mail](mailto:info@finsera.nl)')[0]).toMatchObject({ type: 'link' });
  });

  it('links a pasted URL without swallowing the full stop after it', () => {
    const nodes = parseInline('Zie https://finsera.nl/prijzen.');
    expect(nodes[1]).toMatchObject({ type: 'link', href: 'https://finsera.nl/prijzen' });
    expect(text(nodes)).toBe('Zie https://finsera.nl/prijzen.');
  });

  it('refuses every scheme that is not on the list, and says so by showing the text', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'app://open',
    ]) {
      const [node] = parseInline(`[klik](${bad})`);
      expect(node?.type, bad).toBe('text');
    }
  });

  it('refuses a protocol-relative address, which is another host in a path\'s clothing', () => {
    expect(safeHref('//evil.example/x')).toBeNull();
    expect(parseInline('[klik](//evil.example)')[0]?.type).toBe('text');
  });

  it('keeps the address readable when it refuses to make it clickable', () => {
    // Nobody is quietly edited: a client who pasted something odd can still read it back.
    expect(text(parseInline('[klik](javascript:alert(1))'))).toContain('javascript:alert(1)');
  });
});

describe('markup somebody types', () => {
  it('is text, all the way down', () => {
    /*
     * The claim the whole design rests on. There is no HTML string anywhere in this path —
     * the parser emits nodes with string leaves and each app maps them to React elements, so
     * a `<script>` a client types is a text node that reads `<script>`. This asserts the
     * parser never invents a node type that could carry markup.
     */
    const nasty = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
    const [block] = parseMessage(nasty);
    expect(block).toEqual({ type: 'paragraph', children: [{ type: 'text', value: nasty }] });
  });

  it('cannot produce a node outside the closed set', () => {
    const kinds = new Set<string>();
    const walk = (nodes: Inline[]) =>
      nodes.forEach((n) => {
        kinds.add(n.type);
        if (n.type === 'strong' || n.type === 'em' || n.type === 'link') walk(n.children);
      });
    for (const block of parseMessage(
      '**a** *b* `c` [d](https://e.nl)\n\n- item\n\n1. one\n\n<b>raw</b>',
    )) {
      walk(block.type === 'paragraph' ? block.children : block.items.flat());
    }
    expect([...kinds].sort()).toEqual(['code', 'em', 'link', 'strong', 'text']);
  });
});

describe('hasFormatting', () => {
  it('is false for the messages that already exist', () => {
    expect(hasFormatting('Gewoon een vraag over de factuur van juli.')).toBe(false);
    expect(hasFormatting('Twee regels\nonder elkaar')).toBe(false);
  });

  it('is true as soon as anything is marked up', () => {
    expect(hasFormatting('een **vette** vraag')).toBe(true);
    expect(hasFormatting('- een lijst')).toBe(true);
  });
});

describe('what a formatting button does', () => {
  const apply = (value: string, start: number, end: number, format: Parameters<typeof applyFormat>[3]) => {
    const edit = applyFormat(value, start, end, format);
    const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
    return { next, caret: edit.caret };
  };

  it('wraps a selection and leaves the caret after it', () => {
    // "vet" selected in "een vet woord"
    const { next, caret } = apply('een vet woord', 4, 7, 'strong');
    expect(next).toBe('een **vet** woord');
    expect(next.slice(0, caret)).toBe('een **vet**');
  });

  it('puts the caret between the markers when nothing is selected', () => {
    const { next, caret } = apply('een  woord', 4, 4, 'em');
    expect(next).toBe('een ** woord');
    // Typing next lands inside the emphasis rather than after it.
    expect(next.slice(0, caret)).toBe('een *');
  });

  it('names the link text first, because that is what somebody types next', () => {
    const { next, caret } = apply('zie ', 4, 4, 'link');
    expect(next).toBe('zie [](https://)');
    expect(next.slice(0, caret)).toBe('zie [');
  });

  it('puts a list marker at the start of the line, not at the caret', () => {
    // Caret sits mid-word on the second line.
    const value = 'eerste\nmidden in de regel';
    const { next } = apply(value, 'eerste\nmidden'.length, 'eerste\nmidden'.length, 'bullet');
    expect(next).toBe('eerste\n- midden in de regel');
  });

  it('does not bullet a line that is already a bullet', () => {
    const value = '- al een punt';
    expect(apply(value, 5, 5, 'bullet').next).toBe(value);
  });
});
