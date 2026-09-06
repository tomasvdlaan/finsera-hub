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

  it('names the portal they will sign in at, not the one we log into', () => {
    const mail = inviteEmail(base);
    expect(mail.text).toContain('dochorse.finsera.nl');
    expect(mail.html).toContain('dochorse.finsera.nl');
    expect(mail.text).not.toContain('hub.finsera.nl');
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
    expect(mail.html).not.toMatch(/<style|class=|<img|https?:\/\/(?!finsera-dashboard)/);
    expect(mail.html).toContain('style="');
  });
});
