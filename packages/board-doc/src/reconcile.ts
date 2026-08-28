/**
 * How two copies of a whiteboard agree.
 *
 * A board is a flat list of elements, each carrying a `version` that Excalidraw bumps on every
 * change and a random `versionNonce` it re-rolls at the same time. Merging two copies is
 * therefore per-element last-writer-wins rather than anything as involved as the operational
 * transform the meeting note needs: a stroke is a whole object, not an edit at an offset, so
 * two people drawing in different places never conflict and two people dragging the SAME shape
 * have no meaningful middle ground anyway — one of them has to win.
 *
 * **This code has to run in both places.** The server merges what clients send, and each client
 * merges what the server broadcasts. If the two ever disagree about who won, the boards drift
 * apart permanently and nothing anywhere reports it — every peer is internally consistent and
 * quietly looking at a different drawing. So the rule lives in one package that the API and the
 * browser both import, rather than in two implementations that are the same today.
 *
 * The rule is deliberately Excalidraw's own. Their client applies it locally to its own undo
 * and redo; picking a different one here would mean the server and the editor disagreeing.
 */

/**
 * An Excalidraw element, as far as anything outside the editor needs to know.
 *
 * Structurally typed on purpose. The API must not depend on a React package to merge a board,
 * and the web app must not pull the editor into a bundle just to describe an element.
 */
export interface BoardElement {
  id: string;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted?: boolean;
  type: string;
  [key: string]: unknown;
}

/** Beyond this, one message can occupy the event loop long enough to stall every other board. */
export const MAX_ELEMENTS_PER_MESSAGE = 5_000;

/** A generous ceiling for one element. A freehand stroke with thousands of points is ~50 KB. */
export const MAX_ELEMENT_BYTES = 256 * 1024;

/**
 * How far ahead of what we hold an incoming version may claim to be.
 *
 * Without a ceiling, one element sent at `version: 2**31` wins for ever: nothing anybody draws
 * afterwards can ever exceed it, so that shape becomes permanently unmovable and undeletable on
 * every peer. A client that has genuinely drifted ten thousand versions ahead has a bigger
 * problem than this rejection.
 */
export const MAX_VERSION_JUMP = 10_000;

const KNOWN_TYPES = new Set([
  'selection',
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
  'embeddable',
  'iframe',
]);

const isFinitePositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Is this something a peer could legitimately have drawn?
 *
 * Everything arriving over the socket is untrusted — a board is editable by anyone who can
 * reach it, and a hand-written frame is a few lines of console. Checked here rather than at the
 * gateway so the client applies the same standard to what the server sends it.
 *
 * `localVersion` is what we already hold for this id, when we hold anything, and only bounds
 * how far forward the incoming version may jump.
 */
export function validElement(el: unknown, localVersion = 0): el is BoardElement {
  if (typeof el !== 'object' || el === null) return false;
  const e = el as Record<string, unknown>;

  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 64) return false;
  if (typeof e.type !== 'string' || !KNOWN_TYPES.has(e.type)) return false;

  if (!isFinitePositiveInt(e.version)) return false;
  if (e.version > localVersion + MAX_VERSION_JUMP) return false;

  if (typeof e.versionNonce !== 'number' || !Number.isFinite(e.versionNonce)) return false;
  if (typeof e.updated !== 'number' || !Number.isFinite(e.updated)) return false;
  if (e.isDeleted !== undefined && typeof e.isDeleted !== 'boolean') return false;

  /*
   * Prototype pollution. The payload is stored as jsonb and handed straight back to a browser,
   * and the cost of refusing these is nothing.
   *
   * `hasOwnProperty`, NOT `in`: `in` walks the prototype chain, where every plain object
   * inherits `constructor` — so the `in` form rejects every legitimate element ever drawn.
   * Only an own property is suspicious, and `JSON.parse` does create `__proto__` as one
   * (unlike an object literal, where it is a setter), which is exactly the vector.
   */
  const own = Object.prototype.hasOwnProperty;
  if (own.call(e, '__proto__') || own.call(e, 'constructor') || own.call(e, 'prototype')) {
    return false;
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(e);
  } catch {
    // Circular, or something with a throwing toJSON. Not anything the editor produces.
    return false;
  }
  return serialised.length <= MAX_ELEMENT_BYTES;
}

/**
 * Does `incoming` replace `local`?
 *
 * Deterministic and — critically — SYMMETRIC: for any pair, every peer and the server must
 * reach the same answer whichever order they see them in. That property is what makes the
 * merge converge, and it is what `reconcile.spec.ts` asserts over random pairs rather than
 * over a handful of examples.
 */
export function wins(incoming: BoardElement, local: BoardElement | undefined): boolean {
  if (!local) return true;
  if (incoming.version !== local.version) return incoming.version > local.version;

  /*
   * Same version, different content: two people edited from the same base and neither saw the
   * other. The nonce is random, so this is an arbitrary choice — but an arbitrary choice made
   * IDENTICALLY everywhere, which is the only property that matters. Lower nonce wins.
   */
  if (incoming.versionNonce !== local.versionNonce) {
    return incoming.versionNonce < local.versionNonce;
  }

  // Same version, same nonce: the same element. Keeping local avoids a pointless broadcast.
  return false;
}

/**
 * Merge `incoming` into `local`, returning what changed.
 *
 * The caller gets the accepted elements back rather than a whole new scene, because that set is
 * exactly what has to be broadcast and exactly what has to be flushed — computing it once here
 * is what keeps both proportional to the edit instead of to the size of the board.
 *
 * `local` is mutated. It is the authority's own map, and copying a few thousand elements on
 * every pointer move to avoid that would be the expensive kind of purity.
 */
export function reconcile(
  local: Map<string, BoardElement>,
  incoming: readonly unknown[],
): BoardElement[] {
  const accepted: BoardElement[] = [];

  for (const candidate of incoming.slice(0, MAX_ELEMENTS_PER_MESSAGE)) {
    const id = (candidate as { id?: unknown })?.id;
    const held = typeof id === 'string' ? local.get(id) : undefined;

    if (!validElement(candidate, held?.version ?? 0)) continue;
    if (!wins(candidate, held)) continue;

    local.set(candidate.id, candidate);
    accepted.push(candidate);
  }

  return accepted;
}
