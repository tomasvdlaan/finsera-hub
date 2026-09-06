import { describe, expect, it } from 'vitest';
import { escapeHtml, inviteEmail } from './inviteEmail.js';

const base = {
  clientName: 'DocHorse',
  portalHost: 'dochorse.finsera.nl',
  url: 'https://finsera-dashboard.zitadel.cloud/ui/login/user/invite?userID=1&code=ABC123',
};

/**
 * The one message a client ever receives from us about their login.
 *
 * Tested as text rather than as a rendering, because the failures that matter are all
 * failures of content: a link that only exists inside a button, a name that closes the
 * paragraph it was pasted into, a greeting that says "Beste ,".
 */
describe('the invitation email', () => {
  it('puts the link where every reader can reach it', () => {
    const mail = inviteEmail(base);

    // In the button, in full underneath it, and in the plain text — because some clients
    // strip HTML, some people forward the mail as text, and a link that lives only in a
    // button is one those readers cannot use.
    expect(mail.text).toContain(base.url);
    // Escaped in the HTML: the query string carries an `&`, which inside an attribute has to
    // be `&amp;` or the markup is malformed — mail clients read it back as one `&`.
    const inMarkup = escapeHtml(base.url);
    expect(mail.html).toContain(`href="${inMarkup}"`);
    expect(mail.html.split(inMarkup).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('greets by name when we have one, and stays polite when we do not', () => {
    expect(inviteEmail({ ...base, name: 'Anna de Vries' }).text.split('\n')[0]).toBe(
      'Beste Anna de Vries,',
    );
    // Not "Beste ," — the field is optional and an empty one must not show.
    expect(inviteEmail({ ...base, name: '   ' }).text.split('\n')[0]).toBe('Beste,');
    expect(inviteEmail(base).text.split('\n')[0]).toBe('Beste,');
  });

  it('escapes what somebody typed into the CRM', () => {
    const mail = inviteEmail({
      ...base,
      clientName: 'Smit & Zn <script>alert(1)</script>',
      name: '"Anna"',
    });

    // This HTML is pasted into a mail client that renders it. A client name is data, and an
    // unescaped one would close the tag it sits in — at best mangling the mail, at worst
    // carrying markup nobody wrote into somebody's inbox.
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Smit &amp; Zn &lt;script&gt;');
    expect(mail.html).toContain('&quot;Anna&quot;');
    // The plain text is not markup and must stay readable as typed.
    expect(mail.text).toContain('Smit & Zn <script>alert(1)</script>');
  });

  it('gives their own portal address a place of its own', () => {
    const mail = inviteEmail(base);
    // The address is the thing they need again next month, long after the link is spent —
    // so it is set apart and linkable rather than buried mid-sentence.
    expect(mail.html).toContain('href="https://dochorse.finsera.nl"');
    expect(mail.html).toMatch(/Uw eigen portaaladres/);
    expect(mail.text).toContain('https://dochorse.finsera.nl');
    // Never ours: hub.finsera.nl is where we work, not where a client signs in.
    expect(mail.text).not.toContain('hub.finsera.nl');
    expect(mail.html).not.toContain('hub.finsera.nl');
  });

  it('puts activation before signing in, and says they are different places', () => {
    /*
     * The confusion this wording exists to end. Setting a password happens on the identity
     * provider's page; signing in happens at the client's own address — two hosts, and a
     * client who does not know that reads the first as "I am in" and never reaches the
     * second. So the order is numbered and the difference is stated rather than implied.
     */
    const mail = inviteEmail(base);
    const activate = mail.text.indexOf('Activeer eenmalig uw account');
    const signIn = mail.text.indexOf('Log daarna in op uw eigen portaaladres');
    expect(activate).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(activate);
    expect(mail.text).toContain('een ander adres dan de pagina');

    // And in the rendering most of them will actually see.
    expect(mail.html.indexOf('Account activeren')).toBeLessThan(
      mail.html.indexOf('Log daarna in op uw eigen portaaladres'),
    );
  });

  it('is legible where an email is actually read', () => {
    /*
     * The button carries white text and the links are dark on white, so the brand gold has
     * to clear 4.5:1 in both directions. The logo's own gold does not — it is a mark on its
     * own and can be brighter than type ever can.
     */
    const luminance = (hex: string) => {
      const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, b] = parts.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const html = inviteEmail(base).html;
    const button = /background:(#[0-9a-f]{6});[^"]*color:#ffffff/i.exec(html)?.[1];
    expect(button).toBeDefined();
    expect(contrast(button!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('ends without a sign-off, because Outlook adds one', () => {
    const mail = inviteEmail(base);
    // A mail that closes twice reads as a template somebody forgot to finish.
    expect(mail.text).not.toMatch(/vriendelijke groet/i);
    expect(mail.html).not.toMatch(/vriendelijke groet/i);
  });

  it('says the link is single use, in both renderings', () => {
    // The property that stops a colleague "resending to be helpful" and breaking the link
    // the client is about to click.
    for (const body of [inviteEmail(base).text, inviteEmail(base).html]) {
      expect(body).toMatch(/één keer/);
    }
  });

  it('carries no stylesheet or external asset an email client would drop', () => {
    const mail = inviteEmail(base);
    // Outlook renders with Word: a <style> block, a class, or a remote image is either
    // ignored or blocked, so everything has to be inline and self-contained.
    // Assets, not links: a remote image is blocked or slow, while an href is just an href.
    expect(mail.html).not.toMatch(/<style|class=|<img|src=|url\(/);
    expect(mail.html).toContain('style="');
  });
});
