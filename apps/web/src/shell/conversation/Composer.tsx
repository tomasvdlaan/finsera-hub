import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../ui/primitives.js';

/**
 * The box you type the next question into.
 *
 * A form, so the button and Enter share one submit path — the three chats this replaced each
 * wired that up themselves and one of them got it wrong, requiring the button.
 *
 * A textarea that grows with what is typed: Enter sends, Shift+Enter starts a new line. A
 * question that quotes an error or a list of figures does not fit on one line.
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
  const box = useRef<HTMLTextAreaElement>(null);

  // Sized to its content, up to the CSS max-height, after which it scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing`: Enter confirms an IME candidate and must not also send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    onSend(text);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={box}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
        {busy ? '…' : 'Ask'}
      </Button>
    </form>
  );
}
