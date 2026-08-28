import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/**
 * Page breaks, where the paper would actually run out.
 *
 * The editor reads as a document, so it should end pages like one. This measures the blocks
 * as they are laid out and pushes the one that would straddle a boundary onto the next page,
 * by way of a spacer wide enough to cover the rest of the sheet, the gap between sheets and
 * the margins either side of it.
 *
 * Two things it deliberately is not.
 *
 * It is not in the document. Every break is a ProseMirror *decoration*, which means it exists
 * in this browser's view and nowhere else: nothing is inserted, so nothing is sent as a step,
 * nothing reaches the Markdown, and two people whose windows are different widths do not
 * fight over where page three starts. Putting breaks in the document would make the page size
 * of whoever typed last a property of the note.
 *
 * It is not a printing model. Breaks land between top-level blocks, never inside one, so a
 * table or an image taller than a page overhangs rather than being split. Splitting a block
 * across a boundary means laying out its lines twice and is a different piece of work.
 *
 * Inert unless the stylesheet asks for it: with no `--page-h` in scope — the note page, the
 * dock — this measures nothing and adds no decorations. Whether a surface is paginated is a
 * question about how it looks, so the answer lives in the CSS.
 */

/**
 * The page count, declared where TipTap looks for it.
 *
 * `editor.storage` is a single type the extensions augment; without this the count is
 * reachable at runtime and absent to the compiler, which is a confusing way to be told an
 * extension is not registered.
 */
declare module '@tiptap/core' {
  interface Storage {
    notePagination: {
      /** Whether this surface has page boundaries at all — see the note about CSS above. */
      paginated: boolean;
      pages: number;
    };
  }
}

const key = new PluginKey<DecorationSet>('notePagination');

type PageBreak = {
  /** Position of the block pushed onto the next page. */
  pos: number;
  /** Rest of the abandoned page, the gap, and the margins either side of it. */
  height: number;
  /** How much of that is still the previous sheet, so the gap can be painted in the right place. */
  fill: number;
  /** The number of the page this break starts. */
  page: number;
};

/** A custom property in pixels, or 0. Literal lengths only — `calc()` does not survive this. */
function px(styles: CSSStyleDeclaration, name: string): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Where the pages end, or null on a surface that is not paginated.
 *
 * The distinction matters downstream: "one page" and "pages do not apply here" are different
 * answers, and only the first is worth printing.
 *
 * The running total is computed here rather than read back from `offsetTop`, and that is the
 * whole reason this terminates: the spacers this produces change every offset below them, so
 * measuring positions after inserting them would feed the next measurement its own output.
 * Block heights do not move when a sibling is spaced, so accumulating them is stable.
 */
function measure(view: EditorView): PageBreak[] | null {
  const styles = getComputedStyle(view.dom);
  const pageHeight = px(styles, '--page-h');
  const margin = px(styles, '--page-margin-y');
  const gap = px(styles, '--page-gap');
  const flow = pageHeight - margin * 2;
  if (flow <= 0) return null;

  const breaks: PageBreak[] = [];
  let used = 0;
  let page = 1;
  let trailing = 0;

  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;

    const box = getComputedStyle(dom);
    const height = dom.getBoundingClientRect().height;
    // Adjacent vertical margins collapse to the larger of the two, so the space a block adds
    // below the one before it is not simply its own margin-top.
    const lead = used === 0 ? 0 : Math.max(trailing, Number.parseFloat(box.marginTop) || 0);

    // `used > 0` keeps a block taller than the sheet from being pushed onto an empty page it
    // would overhang just as far — it overhangs where it is instead.
    if (used > 0 && used + lead + height > flow) {
      page += 1;
      breaks.push({ pos: offset, fill: flow - used + margin, height: flow - used + margin * 2 + gap, page });
      used = height;
    } else {
      used += lead + height;
    }
    trailing = Number.parseFloat(box.marginBottom) || 0;
  });

  return breaks;
}

/**
 * The spacer.
 *
 * Transparent where the sheet should still show through and ground-coloured across the gap,
 * with a hairline at each edge — so one element paints the bottom margin of the page it ends,
 * the space between the sheets, and the top margin of the page it starts.
 */
function spacer(item: PageBreak): HTMLElement {
  const el = document.createElement('div');
  el.className = 'page-break';
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${item.height}px`;
  el.style.setProperty('--break-fill', `${item.fill}px`);

  const number = document.createElement('span');
  number.className = 'page-break-number';
  number.style.top = `${item.fill}px`;
  number.textContent = String(item.page);
  el.append(number);
  return el;
}

export const Pagination = Extension.create({
  name: 'notePagination',

  addStorage() {
    return { paginated: false, pages: 1 };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;

    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          // Mapped through every change so the spacers stay attached to their blocks between
          // one measurement and the next, rather than flickering away on each keystroke.
          apply: (tr, current) => tr.getMeta(key) ?? current.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view: (view) => {
          // Null rather than '': an empty document on a paginated surface also measures to no
          // breaks, and the first run must still dispatch so the page count reaches the status
          // bar. Only a transaction re-renders what reads it.
          let signature: string | null = null;
          let frame = 0;

          const remeasure = () => {
            frame = 0;
            if (view.isDestroyed) return;
            const breaks = measure(view);
            // Re-measuring is triggered by the DOM changing, and this changes the DOM. The
            // guard is what makes that a settling loop rather than an endless one.
            const next = breaks === null ? 'off' : breaks.map((b) => `${b.pos}@${Math.round(b.height)}`).join('|');
            if (next === signature) return;
            signature = next;
            storage.paginated = breaks !== null;
            storage.pages = (breaks?.length ?? 0) + 1;

            const decorations = DecorationSet.create(
              view.state.doc,
              (breaks ?? []).map((item) =>
                Decoration.widget(item.pos, () => spacer(item), {
                  // Before the block it pushes, and keyed so an unchanged break is reused
                  // rather than torn down and rebuilt under the cursor.
                  side: -1,
                  key: `page-break:${item.page}:${Math.round(item.height)}`,
                }),
              ),
            );
            view.dispatch(view.state.tr.setMeta(key, decorations).setMeta('addToHistory', false));
          };

          // Always deferred: measurement is triggered from `update`, and dispatching there
          // would re-enter the view mid-update. It also collapses a burst of typing into one.
          //
          // A timeout rather than an animation frame. Reading geometry forces layout, so there
          // is nothing to gain by waiting for one — and a frame never arrives in a background
          // tab, which would leave a document opened in one unpaginated until something else
          // happened to it.
          const schedule = () => {
            if (!frame) frame = window.setTimeout(remeasure, 0);
          };

          schedule();
          // Catches what `update` cannot: the pane being resized, and an image arriving and
          // taking up room long after the transaction that inserted it.
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);

          return {
            update: schedule,
            destroy: () => {
              observer.disconnect();
              if (frame) clearTimeout(frame);
            },
          };
        },
      }),
    ];
  },
});
