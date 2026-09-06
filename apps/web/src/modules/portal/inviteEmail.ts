/**
 * The message a client is sent to activate their portal login.
 *
 * A pure function returning three renderings of one text — subject, plain body, and HTML —
 * so the wording lives in one place and can be tested without a browser. The component's job
 * is to show it and put it on the clipboard; deciding what it says is this file's.
 *
 * Written in Dutch on purpose. The whole reason the registration link comes back to the hub
 * instead of going out from Zitadel is that a client should receive it from somebody they have
 * spoken to, at an address they recognise — a system mail from an identity provider they have
 * never heard of is the thing this replaces.
 *
 * It deliberately ends without a sign-off. This is pasted into Outlook, which appends the
 * sender's own signature, and a mail that closes twice reads as a template somebody forgot to
 * finish.
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

/*
 * Finsera's gold, inlined: an email cannot read our stylesheet.
 *
 * Darker than the mark, and deliberately. A logo sits on its own and can be as bright as it
 * likes; these carry white button text and dark-on-white link text, and a gold light enough
 * to look like the logo fails both. `#8B6508` is 5.3:1 on white and `#6B4E0C` is 7.7:1, so
 * the button is legible and so is every link, including on the screens these are actually
 * read on — a phone held outdoors is the normal case for an email, not the exception.
 */
const BRAND = '#C2AB44';
/*
 * Dark type on the gold, not white.
 *
 * `BRAND` is the gold of the signature, and at that lightness white text on it is 2.3:1 —
 * unreadable, and the reason the first version of this mail was darker than the wordmark.
 * Turning the button's own text dark instead gives 6.9:1 on the same gold, so the brand
 * colour can be the brand colour and the button is still legible (7.6:1). Which half moves
 * is the whole choice: darkening the gold loses the brand, darkening the text does not.
 */
const ON_BRAND = '#1a1a1a';
/* Links are gold on white, where there is no such trick — a light gold simply cannot be
   read, so this one stays deep. 5.3:1. */
const BRAND_DEEP = '#8B6508';
const INK = '#1a1a1a';
const MUTED = '#6b6350';
/* The block that carries their own address — the one thing they will need again. */
const TINT = '#fdf8ec';

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
    `Het klantportaal van Finsera staat voor ${clientName} klaar: uw projecten, offertes,`,
    `facturen en gedeelde documenten op één plek.`,
    ``,
    `Het gaat in twee stappen.`,
    ``,
    `1. Activeer eenmalig uw account. U kiest hierbij uw wachtwoord:`,
    `   ${url}`,
    ``,
    `2. Log daarna in op uw eigen portaaladres. Dat is een ander adres dan de pagina`,
    `   waar u zojuist uw wachtwoord instelde:`,
    `   https://${portalHost}`,
    `   Hier logt u voortaan in — de moeite van een bladwijzer waard.`,
    ``,
    `De link uit stap 1 is persoonlijk en werkt één keer. Werkt hij niet meer? Laat het ons weten.`,
    ``,
    `Onze inlog loopt via Zitadel, onze identiteitsprovider. U kunt daarom ook berichten van`,
    `Zitadel krijgen — bijvoorbeeld om uw e-mailadres te bevestigen of een wachtwoord te`,
    `herstellen. Die horen erbij en zijn niet vals.`,
  ].join('\n');

  /*
   * A letter, not a template.
   *
   * The first version had a coloured header bar, a card on a grey page and a footer band —
   * which reads as marketing, and marketing is what people skim past. This is a message
   * somebody wrote: one column, plain white, ordinary paragraphs, with formatting used only
   * where it carries meaning — the name of their company, the address they will sign in at,
   * and the one thing to click.
   *
   * Still tables and inline styles, because Outlook renders with Word and ignores a
   * stylesheet. Simplicity here is about what it looks like, not about how it is built.
   */
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <tr>
    <td style="padding:8px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;">
        <tr>
          <td style="color:${INK};font-size:15px;line-height:1.65;">
            <p style="margin:0 0 16px 0;">${escapeHtml(greeting)},</p>
            <p style="margin:0 0 16px 0;">
              Het klantportaal van Finsera staat voor <strong>${escapeHtml(clientName)}</strong>
              klaar: uw projecten, offertes, facturen en gedeelde documenten op één plek.
            </p>
            <p style="margin:0 0 18px 0;">Het gaat in twee stappen.</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px 0;">
              <tr>
                <td width="30" valign="top" style="color:${BRAND};font-size:15px;font-weight:700;line-height:1.65;">1.</td>
                <td style="color:${INK};font-size:15px;line-height:1.65;">
                  <strong>Activeer eenmalig uw account.</strong> U kiest hierbij uw wachtwoord.
                  <div style="padding-top:12px;">
                    <a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 22px;background:${BRAND};border-radius:6px;color:${ON_BRAND};font-size:15px;font-weight:600;text-decoration:none;">Account activeren</a>
                  </div>
                </td>
              </tr>
              <tr><td colspan="2" style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
              <tr>
                <td width="30" valign="top" style="color:${BRAND};font-size:15px;font-weight:700;line-height:1.65;">2.</td>
                <td style="color:${INK};font-size:15px;line-height:1.65;">
                  <strong>Log daarna in op uw eigen portaaladres.</strong>
                  Dat is een ander adres dan de pagina waar u zojuist uw wachtwoord instelde.
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0 0 0;">
                    <tr>
                      <td style="background:${TINT};border-left:3px solid ${BRAND};border-radius:0 6px 6px 0;padding:14px 18px;">
                        <div style="color:${MUTED};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;padding-bottom:4px;">Uw eigen portaaladres</div>
                        <a href="https://${escapeHtml(portalHost)}" style="color:${BRAND_DEEP};font-size:17px;font-weight:700;text-decoration:none;">${escapeHtml(portalHost)}</a>
                        <div style="color:${MUTED};font-size:13px;padding-top:4px;">Hier logt u voortaan in — de moeite van een bladwijzer waard.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;line-height:1.6;">
              De link is persoonlijk en werkt één keer. Werkt hij niet meer? Laat het ons weten.
            </p>
            <p style="margin:0 0 6px 0;color:${MUTED};font-size:13px;line-height:1.6;">
              Onze inlog loopt via Zitadel, onze identiteitsprovider. U kunt daarom ook berichten
              van Zitadel krijgen — bijvoorbeeld om uw e-mailadres te bevestigen of een wachtwoord
              te herstellen. Die horen erbij en zijn niet vals.
            </p>
            <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;word-break:break-all;">
              Werkt de knop niet? <a href="${escapeHtml(url)}" style="color:${BRAND_DEEP};">${escapeHtml(url)}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}
