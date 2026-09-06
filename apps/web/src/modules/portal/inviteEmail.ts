/**
 * The message a client is sent to activate their portal login.
 *
 * A pure function returning three renderings of one text — subject, plain body, and HTML —
 * so the wording lives in one place and can be tested without a browser. The component's job
 * is to show it and put it on the clipboard; deciding what it says is this file's.
 *
 * Written in Dutch and signed by us on purpose. The whole reason the registration link comes
 * back to the hub instead of going out from Zitadel is that a client should receive it from
 * somebody they have spoken to, at an address they recognise — a system mail from an identity
 * provider they have never heard of is the thing this replaces.
 */

export interface InviteEmailInput {
  /** Their name, when we asked for it. Falls back to a neutral greeting. */
  name?: string | null;
  clientName: string;
  /** Where they will sign in afterwards, e.g. `duce.finsera.nl`. */
  portalHost: string;
  /** The single-use registration link. */
  url: string;
}

export interface InviteEmail {
  subject: string;
  text: string;
  html: string;
}

/** Finsera's green, inlined: an email cannot read our stylesheet. */
const BRAND = '#1f5f4f';
const BRAND_DEEP = '#143f34';
const INK = '#1a1a1a';
const MUTED = '#5c6b66';
const LINE = '#dfe7e4';

/**
 * Everything interpolated into the HTML is escaped.
 *
 * A client's name is data somebody typed into the CRM, and this string is pasted into a mail
 * client that will render it. `&` first, or the escaping of the others is undone.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function inviteEmail({ name, clientName, portalHost, url }: InviteEmailInput): InviteEmail {
  const greeting = name?.trim() ? `Beste ${name.trim()}` : 'Beste';
  const subject = `Uw toegang tot het Finsera-klantportaal`;

  /*
   * The plain text is not a fallback nobody reads.
   *
   * Some clients strip HTML, some people forward the mail as text, and a link that only
   * exists inside a button is a link those readers cannot use. So the URL appears in full in
   * both renderings, and the text version is written to stand on its own.
   */
  const text = [
    `${greeting},`,
    ``,
    `Voor ${clientName} staat het Finsera-klantportaal klaar. Daarin vindt u uw projecten,`,
    `offertes, facturen en gedeelde documenten — altijd de actuele versie.`,
    ``,
    `Stel eenmalig uw wachtwoord in via deze link:`,
    url,
    ``,
    `Daarna logt u in op ${portalHost}.`,
    ``,
    `De link is persoonlijk en kan één keer worden gebruikt. Werkt hij niet meer? Laat het`,
    `ons weten, dan sturen wij u een nieuwe.`,
    ``,
    `Met vriendelijke groet,`,
    ``,
    `Finsera`,
  ].join('\n');

  /*
   * Tables and inline styles, deliberately.
   *
   * Outlook renders with Word, which ignores most of a stylesheet and much of flexbox — so
   * this is written the way email has to be written rather than the way the rest of the app
   * is: one 600px table, inline styles, a button built from a padded table cell, and web-safe
   * fonts. It is pasted into a compose window, so there is no <head> to hang CSS in either.
   */
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f7f6;padding:24px 0;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND};padding:20px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.02em;">Finsera</span>
            <span style="color:#cfe3dc;font-size:13px;padding-left:10px;">Klantportaal</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px 32px;color:${INK};font-size:15px;line-height:1.6;">
            <p style="margin:0 0 16px 0;">${escapeHtml(greeting)},</p>
            <p style="margin:0 0 16px 0;">
              Voor <strong>${escapeHtml(clientName)}</strong> staat het Finsera-klantportaal klaar.
              Daarin vindt u uw projecten, offertes, facturen en gedeelde documenten — altijd de
              actuele versie.
            </p>
            <p style="margin:0 0 24px 0;">Stel eenmalig uw wachtwoord in:</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${BRAND};border-radius:8px;">
                  <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">Wachtwoord instellen</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 24px 32px;color:${MUTED};font-size:13px;line-height:1.6;">
            <p style="margin:0 0 6px 0;">Werkt de knop niet? Gebruik dan deze link:</p>
            <p style="margin:0;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:${BRAND_DEEP};">${escapeHtml(url)}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 28px 32px;color:${INK};font-size:15px;line-height:1.6;border-top:1px solid ${LINE};padding-top:20px;">
            <p style="margin:0 0 16px 0;">Daarna logt u in op <strong>${escapeHtml(portalHost)}</strong>.</p>
            <p style="margin:0;color:${MUTED};font-size:13px;">
              De link is persoonlijk en kan één keer worden gebruikt. Werkt hij niet meer? Laat
              het ons weten, dan sturen wij u een nieuwe.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f9fbfa;border-top:1px solid ${LINE};color:${MUTED};font-size:13px;line-height:1.5;">
            Met vriendelijke groet,<br /><strong style="color:${INK};">Finsera</strong>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}
