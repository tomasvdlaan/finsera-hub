import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
  undo?: () => void | Promise<void>;
}

interface ToastApi {
  /** Something worked. Say so — a badge quietly flipping is not confirmation. */
  ok: (message: string, opts?: { undo?: () => void | Promise<void> }) => void;
  fail: (message: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const DISMISS_AFTER = 6_000;
/** Long enough to notice and reach, short enough not to sit on the page. */
const DISMISS_AFTER_WITH_UNDO = 10_000;

/**
 * Feedback, and the second half of the destructive-action rule.
 *
 * There is no success feedback anywhere in this app: issuing an invoice — the one act that
 * cannot be undone — is confirmed by a badge changing colour, and saving anything at all is
 * confirmed by nothing. The `aria-live` region matters more than the visuals: a screen
 * reader user currently gets no indication that anything happened.
 *
 * The undo affordance is what makes the confirmation rule proportionate. A dialog in front
 * of every delete trains people to dismiss dialogs; an undo after a reversible one is both
 * faster and safer. Dialogs are then reserved for what genuinely cannot be taken back.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = next.current++;
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(
      () => setToasts((all) => all.filter((x) => x.id !== id)),
      t.undo ? DISMISS_AFTER_WITH_UNDO : DISMISS_AFTER,
    );
  }, []);

  const api: ToastApi = {
    ok: useCallback((message, opts) => push({ message, tone: 'ok', undo: opts?.undo }), [push]),
    fail: useCallback((message) => push({ message, tone: 'error' }), [push]),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {/*
        Always rendered, even when empty: a live region has to exist before the message
        arrives, or assistive technology has nothing to announce into.
      */}
      <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            {t.undo && (
              <button
                className="link-button"
                onClick={() => {
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                  void t.undo?.();
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
