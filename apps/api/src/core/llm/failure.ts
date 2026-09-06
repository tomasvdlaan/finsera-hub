/**
 * What actually went wrong, in a shape somebody can act on.
 *
 * The assistant's failure path used to keep one string — `error.message` — and throw the rest
 * away. That is enough when the provider writes a good sentence and useless when it does not,
 * and the two are indistinguishable afterwards because there is nothing else left to look at.
 *
 * The `[object Object]` case is the one that made this necessary. `String(error)` on anything
 * that is not an Error and has no `toString` produces exactly that, so a failure carrying a
 * structured provider response — the most informative kind there is — was recorded as the
 * least informative six words in the system. Four failures are on record in development and
 * one of them is that.
 *
 * Pure and dependency-free, so the shape of a captured failure is testable without a model,
 * a network or a database.
 */

/** What is kept about a failed answer. Written to `messages.failure`. */
export interface CapturedFailure {
  /** Ties the stored record to the server log line and to what the client was shown. */
  requestId: string;
  /** Error class, where there is one — `AI_APICallError` says more than its message often does. */
  name: string;
  message: string;
  /** HTTP status from the provider, when the failure came back over the wire. */
  status?: number;
  /** The provider's own response body, truncated. Where the real reason usually is. */
  body?: string;
  /** `provider:model` as resolved for this call — the failure is often about the model. */
  model?: string;
  /** How far the run got. A failure on step 1 and one on step 7 are different bugs. */
  steps?: number;
  /** Cause chain, outermost first, when the SDK wrapped something. */
  causes?: string[];
  /** First frames only: enough to place it, not a page of node internals. */
  stack?: string;
  at: string;
}

/** Provider bodies can be enormous; this is the useful part of one. */
const BODY_LIMIT = 4000;
const STACK_FRAMES = 6;

/** A value that is neither Error nor string, rendered so it says something. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    // `undefined`, a function, a symbol — JSON.stringify returns undefined for all three.
    return json && json !== '{}' ? json : Object.prototype.toString.call(value);
  } catch {
    // Circular, or a getter that throws. Still better than `[object Object]`.
    return Object.prototype.toString.call(value);
  }
}

/** Read a property off an unknown without asserting it is there. */
function prop(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = typeof value === 'string' ? value : describe(value);
  if (!s) return undefined;
  return s.length > limit ? `${s.slice(0, limit)}… [truncated ${s.length - limit} chars]` : s;
}

/**
 * Everything worth keeping about a thrown value.
 *
 * Deliberately tolerant of what it is handed. This runs in a catch block on the path where
 * something has already gone wrong, so it must not be the thing that throws next — every read
 * is defensive and every branch has an answer.
 */
export function captureFailure(
  error: unknown,
  context: { requestId: string; model?: string; steps?: number },
): CapturedFailure {
  const isError = error instanceof Error;

  /*
   * The status and body, wherever this SDK put them.
   *
   * The AI SDK spells these `statusCode` and `responseBody`; a fetch-style error uses
   * `status` and `body`; some wrap the lot in `data` or `response`. Checking all of them is
   * cheaper than being wrong, and being wrong here means the one field that says "you are out
   * of credits" is the field that was dropped.
   */
  const status = prop(error, 'statusCode') ?? prop(error, 'status');
  const body =
    prop(error, 'responseBody') ??
    prop(error, 'body') ??
    prop(error, 'data') ??
    prop(error, 'response');

  /* The chain, outermost first. An SDK error usually wraps the one that says why. */
  const causes: string[] = [];
  let cause = prop(error, 'cause');
  for (let depth = 0; cause && depth < 4; depth += 1) {
    causes.push(cause instanceof Error ? `${cause.name}: ${cause.message}` : describe(cause));
    cause = prop(cause, 'cause');
  }

  return {
    requestId: context.requestId,
    name: isError ? error.name : typeof error,
    // Never `String(error)`: see the note at the top of this file.
    message: isError ? error.message : describe(error),
    status: typeof status === 'number' ? status : undefined,
    body: text(body, BODY_LIMIT),
    model: context.model,
    steps: context.steps,
    causes: causes.length > 0 ? causes : undefined,
    stack: isError && error.stack ? error.stack.split('\n').slice(0, STACK_FRAMES).join('\n') : undefined,
    at: new Date().toISOString(),
  };
}

/**
 * The sentence the person who asked the question sees.
 *
 * Separate from the captured record on purpose: this is read by somebody who wanted an answer
 * and got none, so it carries the provider's own words and the request id, and nothing else.
 * The stack and the response body are for whoever is fixing it, and they are in the database.
 */
export function failureMessage(captured: CapturedFailure): string {
  const detail = captured.message.trim() || 'The assistant failed without saying why.';
  return `**That did not work.** ${detail}\n\n_Reference ${captured.requestId} — an administrator can look this up under Settings → Costs._`;
}
