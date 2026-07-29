import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

export interface Field<K extends string = string> {
  name: K;
  label: string;
  /** `number` and `date` exist so money and dates stop being free text. */
  type?: 'text' | 'number' | 'date' | 'select';
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
}

interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

interface AskRequest {
  kind: 'ask';
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  fields: Field[];
}

interface AskInput<K extends string> {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  fields: Array<Field<K>>;
}

type Request = ConfirmRequest | AskRequest;

interface DialogApi {
  /** Resolves true if confirmed. Reads at the call site almost exactly like window.confirm. */
  confirm: (r: Omit<ConfirmRequest, 'kind'>) => Promise<boolean>;
  /**
   * Resolves the field values, or null if cancelled. Replaces window.prompt, plural.
   *
   * Generic over the field names so the result is `Record<'role' | 'euros', string>` rather
   * than `Record<string, string>` — which, under noUncheckedIndexedAccess, would hand every
   * call site a `string | undefined` for a field it just declared as required.
   */
  ask: <K extends string>(r: AskInput<K>) => Promise<Record<K, string> | null>;
}

const Ctx = createContext<DialogApi | null>(null);

/**
 * Confirmation and small forms, on the native `<dialog>` element.
 *
 * Built rather than adopted, and native rather than a library, because `showModal()`
 * already provides the parts worth not hand-rolling: a focus trap, Escape to dismiss,
 * inert content behind, and the top layer so nothing can z-index its way over a
 * confirmation. A dialog dependency would buy a nicer API and the same behaviour.
 *
 * It replaces `window.confirm` and `window.prompt`, which are worse than ugly. Browsers
 * suppress them after a few uses and block them entirely in some embedded contexts — so a
 * button whose handler starts with a prompt silently does nothing, which is exactly how
 * the meeting attendee button failed. They are also untyped: `Number('thirty five')` is
 * NaN cents, and a rate card's three chained prompts had three chances to produce one.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((value: never) => void) | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    if (!request && el.open) el.close();
  }, [request]);

  /** Settle exactly once: Escape, backdrop, Cancel and submit all land here. */
  const settle = useCallback((value: unknown) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(value as never);
  }, []);

  const confirm: DialogApi['confirm'] = useCallback(
    (r) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve as (value: never) => void;
        setRequest({ ...r, kind: 'confirm' });
      }),
    [],
  );

  const ask = useCallback(
    <K extends string>(r: AskInput<K>) =>
      new Promise<Record<K, string> | null>((resolve) => {
        resolver.current = resolve as (value: never) => void;
        setRequest({ ...r, kind: 'ask', fields: r.fields as Field[] });
      }),
    [],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!request) return;
    if (request.kind === 'confirm') return settle(true);
    const data = new FormData(e.currentTarget);
    settle(Object.fromEntries([...data.entries()].map(([k, v]) => [k, String(v)])));
  };

  return (
    <Ctx.Provider value={{ confirm, ask }}>
      {children}
      <dialog
        ref={ref}
        className="dialog"
        // Escape fires `cancel`; clicking the backdrop fires `close` on some engines.
        // Both must settle the promise or the caller waits forever.
        onCancel={(e) => {
          e.preventDefault();
          settle(request?.kind === 'ask' ? null : false);
        }}
        onClose={() => {
          if (resolver.current) settle(request?.kind === 'ask' ? null : false);
        }}
        onClick={(e) => {
          // The dialog element fills the viewport; a click landing on it rather than on
          // its content is a backdrop click.
          if (e.target === ref.current) settle(request?.kind === 'ask' ? null : false);
        }}
      >
        {request && (
          <form onSubmit={onSubmit} className="dialog-form">
            <h2>{request.title}</h2>
            {request.body && <div className="dialog-body">{request.body}</div>}

            {request.kind === 'ask' &&
              request.fields.map((f, i) => (
                <label key={f.name} className="dialog-field">
                  <span>{f.label}</span>
                  {f.type === 'select' ? (
                    <select name={f.name} defaultValue={f.defaultValue} required={f.required}>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={f.name}
                      type={f.type ?? 'text'}
                      step={f.step}
                      defaultValue={f.defaultValue}
                      placeholder={f.placeholder}
                      required={f.required}
                      // The first field takes focus; showModal() would otherwise focus the
                      // first tabbable thing, which is whatever the layout happens to put first.
                      autoFocus={i === 0}
                    />
                  )}
                  {f.hint && <small className="muted">{f.hint}</small>}
                </label>
              ))}

            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => settle(request.kind === 'ask' ? null : false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={request.destructive ? 'destructive' : 'primary'}
                autoFocus={request.kind === 'confirm'}
              >
                {request.confirmLabel ?? (request.destructive ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDialog must be used inside <DialogProvider>');
  return api;
}
