import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/**
 * The pieces every screen is built from.
 *
 * The app had tokens but no components, which is a design system with its top half missing:
 * `--space-4` exists, and twenty screens still each decided for themselves what a card, a
 * status chip or a labelled field looks like. That is why the same idea rendered three ways —
 * not because anyone disagreed, but because there was nothing to reuse.
 *
 * These are deliberately small and unclever. A primitive that takes fifteen props is a
 * framework, and a framework gets worked around; each of these does one thing and hands the
 * rest through. Anything genuinely one-off should stay one-off rather than grow a variant
 * here.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * `primary` fills with the brand and belongs to the one action a screen is asking for.
   * More than one on a page and none of them mean anything.
   */
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'default', size = 'md', className, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={classes} {...rest} />;
}

/**
 * A status, not a sentence.
 *
 * `tone` is the whole point: a badge that cannot say "this is bad" is decoration. The tones
 * map to the semantic tokens rather than to colours, so a status reads the same in both
 * themes and changing what "warning" looks like is one edit.
 */
export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'ok' | 'warning' | 'danger';
  title?: string;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

/**
 * What a status word means, in one place.
 *
 * Every module had its own vocabulary — draft/sent/accepted for quotes, draft/sent/paid for
 * invoices, lead/active/lost for clients — and every one of them rendered in the same grey.
 * A status that cannot say "this needs you" or "this is settled" is a label pretending to be
 * information.
 *
 * The tones are deliberately conservative. `warning` means something is outstanding and
 * waiting on somebody; `danger` means it went wrong or ran out. A draft is neither: it is
 * unfinished, which is normal, and colouring it would make the whole screen shout.
 */
const STATUS_TONES: Record<string, 'neutral' | 'ok' | 'warning' | 'danger'> = {
  accepted: 'ok', active: 'ok', paid: 'ok', done: 'ok', final: 'ok', signed: 'ok',
  complete: 'ok', completed: 'ok', approved: 'ok', recorded: 'ok',
  sent: 'warning', pending: 'warning', proposal: 'warning', review: 'warning',
  waiting: 'warning', waiting_on_client: 'warning', submitted: 'warning', issued: 'warning',
  rejected: 'danger', expired: 'danger', overdue: 'danger', lost: 'danger',
  blocked: 'danger', cancelled: 'danger', failed: 'danger', void: 'danger',
};

/** A status, coloured by what it means rather than by which module it came from. */
export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return <Badge tone={STATUS_TONES[key] ?? 'neutral'}>{value.replace(/_/g, ' ')}</Badge>;
}

/** A count on a navigation row. Zero renders nothing rather than a confident "0". */
export function Count({ value, tone = 'neutral' }: { value: number; tone?: 'neutral' | 'danger' }) {
  if (!value) return null;
  return <span className={`count count-${tone}`}>{value}</span>;
}

/**
 * A panel: the surface a group of related things sits on.
 *
 * Replaces the `<section>` + `<h2>` + hairline that every page repeated, which is what made
 * the app read as a document rather than an interface.
 */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  /** Usually one button, aligned with the title rather than floating above the content. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={['panel', className].filter(Boolean).join(' ')}>
      {(title || action) && (
        <header className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A labelled input, with its hint and its error attached to it.
 *
 * Every form in the app wired these up by hand, which meant most of them wired up the label
 * and forgot `aria-describedby` — so the hint explaining what a Measurement ID is was visible
 * to sighted users and absent to everyone else.
 */
export function Field({
  label,
  hint,
  error,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const fieldId = id ?? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = [hint && `${fieldId}-hint`, error && `${fieldId}-error`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint && (
        <p className="field-hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error error" id={`${fieldId}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A figure and what it counts.
 *
 * A zero is styled down deliberately — nothing overdue is good news, and the point of a number
 * on a dashboard is that its value changes how it looks.
 */
export function Stat({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string | number;
  tone?: 'urgent';
  /** Rendered by the caller, so this stays free of the router. */
  to?: ReactNode;
}) {
  const zero = value === 0 || value === '0';
  const classes = ['stat-value', tone === 'urgent' && !zero ? 'urgent' : '', zero ? 'is-zero' : '']
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className={classes}>{value}</div>
    </>
  );
  return <div className="stat">{to ?? body}</div>;
}

/**
 * Nothing here yet, said well.
 *
 * In a young system the empty states *are* the product — they are most of what anyone sees —
 * and this app writes unusually good ones ("Nothing here is yours to move, but a fortnight of
 * silence is worth a nudge"). They were rendering as 13px grey paragraphs. This gives that
 * writing somewhere to sit and a place to put the one action that resolves it.
 */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

/**
 * Initials, for a face we do not have a picture of.
 *
 * Two letters from the first and last word rather than the first two characters: "Septin
 * Annisa" is SA, not SE, and that is the difference between a recognisable avatar and a wall
 * of identical squares.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]![0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * A stable colour per person, derived from their id.
 *
 * Derived rather than stored so a new colleague has a colour the moment they exist, and the
 * same one on every screen. Hue only — saturation and lightness are fixed, so no avatar can
 * come out unreadable against either theme.
 */
export function personHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/**
 * A person, as a face.
 *
 * The app had no such thing — every screen that wanted to show who was on something printed a
 * name, or more often printed nothing, which is why the board could show eight cards without
 * once saying whose they were.
 *
 * Initials on a generated colour rather than an uploaded photo. There is no avatar upload and
 * there does not need to be: a consistent colour per person is enough to tell four people
 * apart at a glance, which is all a card has room to say.
 */
export function Avatar({
  name,
  id,
  size = 'md',
  title,
}: {
  name: string;
  /** The colour is derived from this, so it is the same on every screen. */
  id: string;
  size?: 'sm' | 'md';
  title?: string;
}) {
  const hue = personHue(id);
  return (
    <span
      className={`avatar avatar-${size}`}
      title={title ?? name}
      // A hue with fixed saturation and lightness, so nothing can come out unreadable.
      style={{ background: `hsl(${hue} 52% 42%)` }}
      aria-hidden={title === '' ? true : undefined}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Several people, overlapping.
 *
 * Capped, with the remainder counted — five faces in a row on a 240px card is not information,
 * it is a texture.
 */
export function AvatarStack({
  people,
  max = 3,
  size = 'sm',
}: {
  people: Array<{ id: string; displayName: string }>;
  max?: number;
  size?: 'sm' | 'md';
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} id={p.id} name={p.displayName} size={size} />
      ))}
      {rest > 0 && (
        <span className={`avatar avatar-${size} avatar-rest`} title={`${rest} more`}>
          +{rest}
        </span>
      )}
    </span>
  );
}
