/**
 * CSV, written by hand, for a spreadsheet on a Dutch machine.
 *
 * No dependency: this is forty lines of string handling, and the interesting part is not the
 * escaping — every library gets that right — it is the two choices below, which no library can
 * make for you and which decide whether the file opens as a table or as one useless column.
 *
 * **Semicolon, not comma.** Excel picks its separator from the machine's list separator, which
 * on a Dutch install is `;`. A comma-separated file opened there lands every row in column A.
 *
 * **Comma as the decimal mark.** Follows from the above: `7,5` is what a Dutch spreadsheet
 * reads as seven and a half. Writing `7.5` beside a `;` separator gets it parsed as text, and
 * then nothing sums.
 *
 * Both are the reason `Intl.NumberFormat('nl-NL')` is not used here — it inserts thousands
 * separators, and `1.234,5` inside a `;` file is a number Excel refuses.
 */

/** RFC 4180: quote when the value could otherwise break the row, and double any inner quote. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text === '') return '';
  // A separator, a quote, or any newline means the value has to be quoted to survive the trip.
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Minutes as decimal hours in Dutch notation — `7,5`, never `7.5` and never `7,5 uur`. */
export function csvHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace('.', ',');
}

/** Integer cents as a plain Dutch decimal. No currency symbol: a spreadsheet column has a header. */
export function csvMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** A boolean a person reads, not `true`/`false`. This file is opened by a bookkeeper. */
export const csvYesNo = (value: boolean): string => (value ? 'ja' : 'nee');

/**
 * Rows to a file.
 *
 * The leading BOM is what makes Excel read it as UTF-8; without it a name with an accent or a
 * description with an em-dash arrives mojibaked, and the person who opens it has no way to know
 * the file was fine. CRLF for the same reason — it is what a spreadsheet expects.
 */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [header.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  // Escaped rather than a literal BOM: the same byte, without an invisible character sitting
  // in the source that lint rightly refuses and no reviewer can see.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
