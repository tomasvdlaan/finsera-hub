import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useShared } from '../../lib/useShared.js';

export interface PickerProject {
  id: string;
  name: string;
  clientName?: string | null;
}

export interface PickerClient {
  id: string;
  name: string;
}

/** What is chosen: a project, a client, or neither. Never both. */
export interface EntityValue {
  projectId?: string | null;
  clientId?: string | null;
}

type Kind = 'project' | 'client';

interface Option {
  /** `''` for the empty choice, otherwise `p:<id>` / `c:<id>`. */
  key: string;
  label: string;
  hint?: string;
  group: string | null;
  value: EntityValue;
}

const fold = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const keyOf = (v: EntityValue): string =>
  v.projectId ? `p:${v.projectId}` : v.clientId ? `c:${v.clientId}` : '';

/**
 * Pick a project, a client, or both kinds from one list.
 *
 * Built because the native `<select>` was the wrong control for this on the machines it is
 * used on. Safari draws a `<select>` with its own menu, ignores most of the page's styling,
 * cannot hold a long "Project — Client" label without clipping it, and cannot be searched
 * beyond the first letter typed — which with a few dozen projects is a scroll, not a choice.
 *
 * This is a combobox instead: a button that shows the choice, and a popover with a search
 * field and the grouped list. It makes no assumption about focus or blur ordering, which is
 * where Safari differs most — buttons there do not take focus on click, so closing on blur
 * would close the list before the click that picked from it. Outside presses are caught on the
 * document instead.
 *
 * `projects` and `clients` are optional: pass them when the page already has them, leave them
 * out and the picker fetches what `kinds` asks for.
 */
export function EntityPicker({
  value,
  onChange,
  kinds = ['project', 'client'],
  projects,
  clients,
  emptyLabel = 'Internal — no client',
  placeholder = 'Choose…',
  label = 'Project or client',
  id,
  disabled,
  autoOpen,
  onClose,
  className,
}: {
  value: EntityValue;
  onChange: (value: EntityValue) => void;
  kinds?: Kind[];
  projects?: PickerProject[];
  clients?: PickerClient[];
  /**
   * The first row, meaning "against neither". Null removes it, for places where a choice is
   * required.
   */
  emptyLabel?: string | null;
  placeholder?: string;
  label?: string;
  id?: string;
  disabled?: boolean;
  /** Open on mount — for pickers that appear because someone asked to pick. */
  autoOpen?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const wantProjects = kinds.includes('project');
  const wantClients = kinds.includes('client');

  // Only fetched when the caller did not supply the list, and only for the kinds asked for.
  const fetchedProjects = useShared<PickerProject[]>(
    wantProjects && !projects ? '/crm/projects' : null,
  );
  const fetchedClients = useShared<PickerClient[]>(
    wantClients && !clients ? '/crm/clients' : null,
  );
  const projectList = projects ?? fetchedProjects.data ?? [];
  const clientList = clients ?? fetchedClients.data ?? [];

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    if (emptyLabel !== null) out.push({ key: '', label: emptyLabel, group: null, value: {} });
    if (wantProjects) {
      for (const p of projectList) {
        out.push({
          key: `p:${p.id}`,
          label: p.name,
          hint: p.clientName ?? undefined,
          group: wantClients ? 'Projects' : null,
          value: { projectId: p.id, clientId: null },
        });
      }
    }
    if (wantClients) {
      for (const c of clientList) {
        out.push({
          key: `c:${c.id}`,
          label: c.name,
          group: wantProjects ? 'Clients — no project yet' : null,
          value: { projectId: null, clientId: c.id },
        });
      }
    }
    return out;
  }, [emptyLabel, wantProjects, wantClients, projectList, clientList]);

  const [open, setOpen] = useState(Boolean(autoOpen));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const selectedKey = keyOf(value);
  const selected = options.find((o) => o.key === selectedKey);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    // The empty choice stays out of a search: typing is looking for something.
    return options.filter(
      (o) => o.key !== '' && fold(`${o.label} ${o.hint ?? ''}`).includes(q),
    );
  }, [options, query]);

  const close = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      setQuery('');
      if (refocus) trigger.current?.focus();
      onClose?.();
    },
    [onClose],
  );

  const choose = (o: Option) => {
    onChange(o.value);
    close(true);
  };

  /*
   * Placed against the viewport, not the page.
   *
   * A popover inside a card or a table row is clipped by that container's overflow; one placed
   * absolutely inside a scrolled panel drifts. Fixed coordinates from the trigger's rect do
   * neither, and flipping above when there is no room below keeps it on screen near the
   * bottom of the window.
   */
  const reposition = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 288);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= 240 || below >= above) {
      setPlace({ left, top: r.bottom + 4, width, maxHeight: Math.min(380, below) });
    } else {
      setPlace({
        left,
        bottom: window.innerHeight - r.top + 4,
        width,
        maxHeight: Math.min(380, above),
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, visible.findIndex((o) => o.key === selectedKey)));
    // Focus after the portal has rendered; focusing a node that is not there yet does nothing.
    const t = requestAnimationFrame(() => search.current?.focus());

    const outside = (e: Event) => {
      const n = e.target as Node;
      if (popover.current?.contains(n) || trigger.current?.contains(n)) return;
      close(false);
    };
    const follow = (e: Event) => {
      // Scrolling the list itself must not move the popover.
      if (popover.current?.contains(e.target as Node)) return;
      reposition();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', follow, true);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', follow, true);
    };
    // Only when it opens; re-running on every keystroke would reset the highlight.
  }, [open]);

  // A new search starts at the top of what it found.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, visible.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = visible[active];
      if (o) choose(o);
    } else if (e.key === 'Escape') {
      // Not allowed to reach a surrounding dialog or board handler: closing the picker is
      // all that was asked.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const loading = fetchedProjects.loading || fetchedClients.loading;

  // Inside a modal <dialog> the top layer sits above anything portalled to the body.
  const host = (open && trigger.current?.closest('dialog')) || document.body;

  let lastGroup: string | null | undefined;

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`entity-picker${className ? ` ${className}` : ''}${selected && selected.key ? '' : ' is-empty'}`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="entity-picker-value">
          {selected ? (
            <>
              <span className="entity-picker-label">{selected.label}</span>
              {selected.hint && <span className="entity-picker-hint">{selected.hint}</span>}
            </>
          ) : (
            <span className="entity-picker-label">{placeholder}</span>
          )}
        </span>
        <span className="entity-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={popover}
            className="entity-popover"
            style={{
              left: place.left,
              top: place.top,
              bottom: place.bottom,
              width: place.width,
              maxHeight: place.maxHeight,
            }}
            onKeyDown={onKey}
          >
            <input
              ref={search}
              className="entity-search"
              type="search"
              value={query}
              placeholder={
                wantProjects && wantClients
                  ? 'Search projects and clients'
                  : wantClients
                    ? 'Search clients'
                    : 'Search projects'
              }
              aria-label="Search"
              aria-controls={listId}
              aria-activedescendant={visible[active] ? `${uid}-${active}` : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div ref={listRef} className="entity-list" role="listbox" id={listId} aria-label={label}>
              {visible.map((o, i) => {
                const heading = o.group !== lastGroup && o.group ? o.group : null;
                lastGroup = o.group;
                return (
                  <div key={o.key || 'empty'}>
                    {heading && (
                      <div className="entity-group" role="presentation">
                        {heading}
                      </div>
                    )}
                    <div
                      id={`${uid}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={o.key === selectedKey}
                      className={`entity-option${i === active ? ' is-active' : ''}${o.key === selectedKey ? ' is-selected' : ''}`}
                      // A click, so that starting a scroll on a touch screen does not pick the
                      // row under the finger; the mouse-down default is cancelled so the
                      // search field keeps focus until the choice lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      onPointerMove={() => i !== active && setActive(i)}
                    >
                      <span className="entity-option-label">{o.label}</span>
                      {o.hint && <span className="entity-option-hint">{o.hint}</span>}
                      {o.key === selectedKey && (
                        <span className="entity-check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="entity-empty">
                  {loading ? 'Loading…' : query ? `Nothing matches “${query}”` : 'Nothing to choose yet'}
                </p>
              )}
            </div>
          </div>,
          host,
        )}
    </>
  );
}
