import type { RefObject } from 'react';
import { applyFormat, type Format } from '@platform/ticket-markdown';

/**
 * The five things a message can be marked up with, as buttons.
 *
 * A toolbar rather than a help line under the box, because the alternative is asking people
 * to learn Markdown to write a sentence to their accountant. The syntax is still what gets
 * stored — the buttons type it for you — so anyone who knows it can ignore these entirely.
 *
 * The component knows no rules. What each button inserts and where the caret lands is
 * `applyFormat` in `@platform/ticket-markdown`, tested there as a pure function, so hub and
 * the portal cannot drift apart on what Bold means. All that is left here is the one thing
 * only a component can do: apply the edit through the textarea with `setRangeText`, which
 * is what keeps the browser's own undo stack intact. Replacing `value` wholesale would make
 * ⌘Z throw away everything the person had typed — worse than having no toolbar at all.
 */
const ACTIONS: Array<{ label: string; title: string; format: Format }> = [
  { label: 'B', title: 'Vet', format: 'strong' },
  { label: 'I', title: 'Schuin', format: 'em' },
  { label: '</>', title: 'Code', format: 'code' },
  { label: '\u{1F517}', title: 'Link', format: 'link' },
  { label: '\u2022', title: 'Lijst', format: 'bullet' },
];

export function FormatBar({
  area,
  onChange,
  disabled,
}: {
  area: RefObject<HTMLTextAreaElement | null>;
  /** Told the new value, because the textarea is controlled by the form around it. */
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const apply = (format: Format) => {
    const el = area.current;
    if (!el) return;

    const edit = applyFormat(el.value, el.selectionStart, el.selectionEnd, format);
    el.setRangeText(edit.text, edit.start, edit.end, 'end');
    el.setSelectionRange(edit.caret, edit.caret);
    onChange(el.value);
    el.focus();
  };

  return (
    <div className="formatbar" role="group" aria-label="Opmaak">
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          title={action.title}
          aria-label={action.title}
          disabled={disabled}
          // `onMouseDown` with the default prevented, so the textarea never loses focus and
          // the selection is still there when the handler runs.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(action.format)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
