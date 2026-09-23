import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageBody } from './MessageBody.js';

/**
 * What a message actually turns into, in the DOM — inside hub.
 *
 * The twin of the portal's spec, and the one that matters most: this renders text a
 * **client** wrote inside the internal application, where the reader holds an admin
 * session. If client-authored markup could ever survive to the output, it would run with
 * the whole platform behind it. Rendered with `renderToStaticMarkup` rather than jsdom,
 * because the question is what the markup is, not how it behaves.
 */
const html = (source: string) => renderToStaticMarkup(<MessageBody source={source} />);

describe('MessageBody', () => {
  it('renders the subset as elements', () => {
    expect(html('**vet** en *schuin*')).toContain('<strong>vet</strong>');
    expect(html('**vet** en *schuin*')).toContain('<em>schuin</em>');
    expect(html('`code`')).toContain('<code>code</code>');
    expect(html('- een\n- twee')).toContain('<ul><li>een</li><li>twee</li></ul>');
    expect(html('3. derde')).toContain('<ol start="3">');
  });

  it('keeps a single newline visible, the way the old plain-text messages were', () => {
    // The paragraph carries `pre-wrap`, so a message written before formatting existed
    // renders exactly as it always did.
    expect(html('Eerste\nTweede')).toContain('white-space:pre-wrap');
    expect(html('Eerste\nTweede')).toContain('Eerste\nTweede');
  });

  it('escapes markup somebody typed instead of rendering it', () => {
    /*
     * The claim the whole design rests on, asserted at the only place it can really be
     * asserted: the output. There is no `dangerouslySetInnerHTML` in this path, so a
     * client's `<script>` arrives as escaped text and a browser will never run it.
     */
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
  });

  it('makes a good link clickable and a dangerous one merely readable', () => {
    const good = html('[de factuur](https://hub.finsera.nl/money/invoices/1)');
    expect(good).toContain('href="https://hub.finsera.nl/money/invoices/1"');
    expect(good).toContain('rel="noopener noreferrer"');

    const bad = html('[klik](javascript:alert(1))');
    expect(bad).not.toContain('<a');
    // Still readable: nobody's message is quietly edited.
    expect(bad).toContain('javascript:alert(1)');
  });
});
