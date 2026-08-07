import { useState, type ReactNode } from 'react';
import { useToast } from './Toast.js';

/**
 * A button inside a card that changes something.
 *
 * The three states an action has and a plain `<button onClick>` does not: busy while the
 * request is out, gone once it has succeeded, and a message when it has not. Widgets kept
 * reinventing two of those and skipping the third, which is how a dashboard ends up with
 * buttons that silently do nothing when the server says no.
 *
 * Optimism is deliberate but narrow. `onDone` fires only after the server has agreed, so a row
 * disappears because the action worked rather than because it was clicked — the opposite bargain
 * from an optimistic UI, and the right one here because the cost of being wrong is a widget
 * that says a thing was approved when it was not.
 */
export function Act({
  run,
  onDone,
  children,
  variant = 'quiet',
  confirm,
}: {
  run: () => Promise<unknown>;
  /** Called after the server agrees. Usually removes the row this button was on. */
  onDone?: () => void;
  children: ReactNode;
  variant?: 'primary' | 'quiet' | 'danger';
  /** A sentence to agree to first, for anything that cannot be undone from here. */
  confirm?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    try {
      await run();
      onDone?.();
    } catch (e) {
      // Named, not swallowed. A button that fails quietly is worse than one that is missing,
      // because the reader has already believed it worked.
      toast.fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="act" data-variant={variant} disabled={busy} onClick={() => void go()}>
      {busy ? '…' : children}
    </button>
  );
}

/** A row inside a compound card: something, its detail, and what you can do about it. */
export function ActRow({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** The actions. Kept at the end so the eye reads what it is before what it can do. */
  children?: ReactNode;
}) {
  return (
    <li className="act-row">
      <span className="act-row-text">
        <span>{title}</span>
        {meta && <small className="card-meta">{meta}</small>}
      </span>
      {children && <span className="act-row-buttons">{children}</span>}
    </li>
  );
}
