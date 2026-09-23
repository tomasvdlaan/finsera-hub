import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useToast } from '../../shell/ui/Toast.js';
import type { FoundContext, Proposal } from '../../shell/liveMeetingReducer.js';

/**
 * How many suggestions stand in front of the dock at once.
 *
 * One. This used to be three, stacked, which is a list — and a list in front of the notes is
 * a thing you postpone rather than answer. One suggestion, one button, the rest counted
 * underneath: the queue is visible without being in the way, and the dock holds all of it for
 * anyone who wants to work through them.
 *
 * The depth matters more than it looks. The server records how many suggestions stood in
 * front of each one, because a dismissal pressed to clear a queue of four says nothing about
 * the suggestion it landed on — and a panel that lets the queue grow is a panel that
 * manufactures that kind of press.
 */
const AT_ONCE = 1;

/**
 * What each kind of suggestion offers, said in the button.
 *
 * `accept` is set for exactly one kind, and that is the point. "Keep it" used to appear on
 * all four and did nothing on three of them: the note keeps everything not dismissed, so
 * pressing it produced the same note as ignoring the card. Two buttons that do the same
 * thing are not a choice, they are a toll — and the fastest way back to the meeting was to
 * press whichever was nearer, which is how every accept and dismiss ever recorded here came
 * to mean the same thing.
 *
 * Agenda coverage keeps its pair because accepting one genuinely marks the item covered,
 * and the server refuses an accept on anything else rather than quietly ignoring it.
 */
const WORDING: Record<Proposal['kind'], { label: string; accept?: string; dismiss: string }> = {
  action: { label: 'Action point', dismiss: 'Not that' },
  agenda_covered: { label: 'Agenda', accept: 'Mark covered', dismiss: 'Not yet' },
  decision: { label: 'Decision', dismiss: 'Not that' },
  note: { label: 'Worth noting', dismiss: 'Not that' },
};

/**
 * The agent's suggestions, while there is still something to be done about them.
 *
 * They used to exist only in the rail, in five stacked sections, alongside the running
 * summary and the transcript — which meant that during the one part of a meeting where you
 * are listening to a person, the agent's contribution was somewhere you had to remember to
 * look. Nobody looks. Everything then landed on the note at the end as a pile to triage,
 * days after the context that would let you triage it had gone.
 *
 * A popup is the right shape for this specific reason: a suggestion has a moment. "Should
 * that be an action point?" is answerable in the two seconds after it is said and expensive
 * to answer a week later. The rail keeps everything and stays; this is for deciding.
 *
 * Deliberately not a toast. A toast leaves on a timer, and a suggestion that disappeared
 * because nobody clicked fast enough is worse than one that never appeared — it was seen,
 * so it feels handled. These stay until dismissed, or until the recording stops and the
 * ones nobody objected to go into the note.
 */
export function Suggestions({
  noteId,
  proposals,
  context,
  running,
  hidden,
  onOpenAll,
}: {
  noteId: string | null;
  proposals: Proposal[];
  /** What the assistant went and looked up about a suggestion, keyed by its id. */
  context: Record<string, FoundContext[]>;
  running: boolean;
  /** The dock is open and showing these already. Two copies of one question is one too many. */
  hidden?: boolean;
  onOpenAll: () => void;
}) {
  const toast = useToast();
  /*
   * Decided here, before the server has said so.
   *
   * The socket tells every screen the outcome, this one included, but a suggestion that sat
   * there for the round trip would get pressed twice — and the second press is the one that
   * lands on the card underneath after the stack shifts up.
   */
  const [pending, setPending] = useState<Record<string, true>>({});

  if (!running || !noteId || hidden) return null;

  const waiting = proposals.filter((p) => p.status === 'open' && !pending[p.id]);
  if (waiting.length === 0) return null;

  const decide = (p: Proposal, decision: 'accepted' | 'dismissed') => async () => {
    setPending((prev) => ({ ...prev, [p.id]: true }));
    try {
      await api.post(`/meetings/${noteId}/live/proposals/${p.id}`, { decision });
    } catch (e) {
      // Put it back. A suggestion that vanished because the request failed is one you
      // believe you handled, which is the worst of the three outcomes.
      setPending((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      toast.fail((e as Error).message);
    }
  };

  const shown = waiting.slice(0, AT_ONCE);

  return (
    <div className="suggestions" aria-live="polite" aria-label="Suggestions from the assistant">
      {shown.map((p) => {
        const words = WORDING[p.kind];
        const found = context[p.id] ?? [];
        return (
          <div className="suggestion" key={p.id} data-kind={p.kind}>
            <div className="suggestion-kind">{words.label}</div>
            <p className="suggestion-text">{p.text}</p>

            {/*
              A document the assistant went and found, unasked, about this very thing.
              Next to the suggestion rather than in a pile of its own, because it is the
              evidence for the decision the buttons below are asking for.
            */}
            {found.length > 0 && (
              <div className="suggestion-found">
                <span className="faint">On file about this</span>
                {found.map((hit) => (
                  <Link key={hit.entityId} to={`/docs/${hit.entityId}`} target="_blank">
                    {hit.title}
                  </Link>
                ))}
              </div>
            )}

            {/*
              One button, unless accepting does something.

              The card is a chance to object, not a form to complete: leaving it alone keeps
              the suggestion, which is what a reader wants nine times in ten and costs no
              attention during the part of a meeting where there is none to spare.
            */}
            <div className="suggestion-buttons">
              {words.accept && (
                <button
                  type="button"
                  className="act"
                  data-variant="primary"
                  onClick={() => void decide(p, 'accepted')()}
                >
                  {words.accept}
                </button>
              )}
              <button type="button" className="act" onClick={() => void decide(p, 'dismissed')()}>
                {words.dismiss}
              </button>
            </div>
          </div>
        );
      })}

      {waiting.length > shown.length && (
        <button type="button" className="suggestions-more" onClick={onOpenAll}>
          {waiting.length - shown.length} more waiting
        </button>
      )}
    </div>
  );
}
