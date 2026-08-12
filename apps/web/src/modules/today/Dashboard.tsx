import { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PageHeader } from '../../shell/ui/layout.js';
import { Button } from '../../shell/ui/primitives.js';
import { useToast } from '../../shell/ui/Toast.js';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../shell/useDocumentTitle.js';
import { hiddenCount, libraryFor, resolve, settingsFor, type Placement } from '../../shell/widgets.js';
import type { Span, WidgetDef } from '../types.js';
import { WidgetSettings } from './WidgetSettings.js';
import { DayStrip } from './DayStrip.js';

/** The widths a person can cycle a widget through, in order. */
const SPANS: Span[] = [3, 4, 6, 8, 9, 12];

/**
 * One placed widget, and the controls that only exist while editing.
 *
 * The widget itself renders a Card. The frame around it is a wrapper rather than something the
 * widget opts into, so a module author writes a card and gets dragging, resizing and removal
 * without knowing this file exists — which is the whole bargain of a registry.
 */
function Placed({
  placement,
  def,
  editing,
  onSpan,
  onRemove,
  onSettings,
}: {
  placement: Placement;
  def: WidgetDef;
  editing: boolean;
  onSpan: (span: Span) => void;
  onRemove: () => void;
  onSettings: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: placement.id,
    disabled: !editing,
  });

  const Widget = def.Component;
  const floor = SPANS.indexOf(def.minSpan ?? 3);
  const next = () => {
    const at = SPANS.indexOf(placement.span);
    // Cycles rather than stopping at the end: a person resizing wants to try widths, and a
    // control that dead-ends means going back the other way to find the one you passed.
    const from = at < 0 ? floor : at;
    return SPANS[from + 1 <= SPANS.length - 1 ? from + 1 : floor] ?? 6;
  };

  return (
    <div
      ref={setNodeRef}
      className="placed"
      data-span={placement.span}
      data-editing={editing || undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(editing ? attributes : {})}
      {...(editing ? listeners : {})}
    >
      {editing && (
        <div className="placed-tools">
          <span className="placed-name">{def.title}</span>
          {def.settings && def.settings.length > 0 && (
            <button type="button" onClick={onSettings} aria-label={`Settings for ${def.title}`}>
              ⚙
            </button>
          )}
          <button type="button" onClick={() => onSpan(next())} aria-label={`Resize ${def.title}`}>
            {placement.span}/12
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${def.title}`}>
            ✕
          </button>
        </div>
      )}
      {/*
        The widget still renders while editing, rather than becoming a grey placeholder.

        A layout you arrange against empty boxes is one you have to check afterwards, because
        "which of these is the tall one" is a question the placeholder cannot answer.
      */}
      <Widget settings={settingsFor(def, placement)} />
    </div>
  );
}

/**
 * The front door, built by whoever is standing in it.
 *
 * The page used to be a fixed arrangement of things I judged important, which encoded an
 * assumption that does not survive a second person: a finance manager opens this wanting money
 * and a developer opens it wanting the board, and any single answer is wrong for one of them.
 *
 * The layout lives on the server rather than in localStorage, because a dashboard you lose by
 * opening the app on the other machine is not a dashboard you will invest in arranging.
 */
export function Dashboard() {
  useDocumentTitle('Today');
  const toast = useToast();

  const [layout, setLayout] = useState<Placement[] | null>(null);
  const [custom, setCustom] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  /** Counts, so the picker can hide what cannot say anything yet. See widgets.ts. */
  const [volume, setVolume] = useState<Record<string, number>>();

  useEffect(() => {
    api
      .get<Record<string, number>>('/core/volume')
      .then(setVolume)
      // A picker that offers everything is a worse failure than one that offers too much, so
      // this failing quietly leaves the library unfiltered rather than empty.
      .catch(() => setVolume(undefined));
    api
      .get<{ layout: Placement[]; custom: boolean }>('/core/dashboard')
      .then((d) => {
        setLayout(d.layout);
        setCustom(d.custom);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  /*
   * Saved on every change, not behind a Save button.
   *
   * A dashboard has no invalid intermediate state — every drag and every removal is complete
   * the moment it happens — so a Save button would exist only to be forgotten, and losing an
   * afternoon's arrangement to a closed tab is the kind of thing people do not forgive.
   */
  const persist = useCallback(
    (next: Placement[]) => {
      setLayout(next);
      setCustom(true);
      api.put('/core/dashboard', { layout: next }).catch((e: Error) => {
        setError(e.message);
        toast.fail('That change could not be saved');
      });
    },
    [toast],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (error && !layout) return <p className="error">{error}</p>;
  if (!layout) return <p className="muted">Loading…</p>;

  const placed = resolve(layout);
  const library = libraryFor('dashboard', () => true, volume);
  const hidden = hiddenCount('dashboard', volume);
  const configuringPair = placed.find((p) => p.placement.id === configuring);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((p) => p.id === active.id);
    const to = layout.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    persist(next);
  };

  const add = (key: string, def: WidgetDef) => {
    // A placement id that cannot collide with one already stored, since the same widget may be
    // placed more than once and the id is what a drag and a removal act on.
    const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    persist([...layout, { id, widget: key, span: def.defaultSpan }]);
    setPicking(false);
  };

  return (
    <>
      <PageHeader
        title={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        subtitle={
          editing
            ? 'Drag to reorder, ⚙ to configure, ✕ to remove. Every change saves as you make it.'
            : undefined
        }
        meta={editing ? undefined : <DayStrip />}
        actions={
          <div className="row">
            {editing && (
              <>
                <Button onClick={() => setPicking(true)}>Add a widget</Button>
                {custom && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      api
                        .del<{ layout: Placement[] }>('/core/dashboard')
                        .then((d) => {
                          setLayout(d.layout);
                          setCustom(false);
                        })
                        .catch((e: Error) => setError(e.message));
                    }}
                  >
                    Reset
                  </Button>
                )}
              </>
            )}
            <Button variant={editing ? 'primary' : 'default'} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done' : 'Edit'}
            </Button>
          </div>
        }
      />

      {error && <p className="error">{error}</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.map((p) => p.id)} strategy={rectSortingStrategy}>
          {placed.map(({ placement, def }) => (
            <Placed
              key={placement.id}
              placement={placement}
              def={def}
              editing={editing}
              onSpan={(span) =>
                persist(layout.map((p) => (p.id === placement.id ? { ...p, span } : p)))
              }
              onRemove={() => persist(layout.filter((p) => p.id !== placement.id))}
              onSettings={() => setConfiguring(placement.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {placed.length === 0 && (
        <div className="card" data-span={12}>
          <p className="muted">
            This dashboard is empty. <button className="link-button" onClick={() => { setEditing(true); setPicking(true); }}>Add a widget</button> to start it.
          </p>
        </div>
      )}

      {picking && (
        <div className="drawer" role="dialog" aria-label="Widget library">
          <div className="drawer-head">
            <h2>Add a widget</h2>
            <button type="button" onClick={() => setPicking(false)} aria-label="Close">✕</button>
          </div>
          {hidden > 0 && (
            <p className="library-hidden">
              {hidden} more {hidden === 1 ? 'widget appears' : 'widgets appear'} once there is
              enough data for {hidden === 1 ? 'it' : 'them'} to mean something.
            </p>
          )}
          <ul className="library">
            {library.map(({ key, def }) => (
              <li key={key}>
                <button type="button" onClick={() => add(key, def)}>
                  <strong>{def.title}</strong>
                  <span className="muted">{def.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {configuringPair && (
        <WidgetSettings
          def={configuringPair.def}
          settings={settingsFor(configuringPair.def, configuringPair.placement)}
          onClose={() => setConfiguring(null)}
          onChange={(settings) =>
            persist(layout.map((p) => (p.id === configuring ? { ...p, settings } : p)))
          }
        />
      )}
    </>
  );
}
