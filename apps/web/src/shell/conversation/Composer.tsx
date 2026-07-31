import { useState, type FormEvent } from 'react';
import { Button } from '../ui/primitives.js';

/**
 * The box you type the next question into.
 *
 * A form rather than an input with a click handler, so Enter submits and the browser does the
 * work — the three chats this replaced each wired that up themselves and one of them got it
 * wrong, requiring the button.
 */
export function Composer({
  onSend,
  busy,
  placeholder = 'Ask anything…',
  autoFocus,
}: {
  onSend: (message: string) => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    onSend(text);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
        {busy ? '…' : 'Ask'}
      </Button>
    </form>
  );
}
