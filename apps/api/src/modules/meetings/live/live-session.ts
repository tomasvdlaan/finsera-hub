/**
 * The state of one live meeting, in memory.
 *
 * Nothing here is written to disk while the meeting runs, and the audio never is at all —
 * segments are transcribed and dropped. What survives the meeting is the transcript text
 * and whatever proposals you accept.
 */
export interface TranscriptLine {
  /** Stable identity, so a line delivered twice is recognisable as one line. */
  id: string;
  /**
   * What this line is.
   *
   * Almost always speech. `paused` marks a stretch where listening was deliberately
   * suspended, and it exists because a gap in a transcript is otherwise indistinguishable
   * from nobody having spoken — and the two want opposite answers to "what was discussed
   * here?". Optional so every line ever written before this stays valid.
   */
  kind?: 'speech' | 'paused';
  /** Seconds from the start of the session, so the UI can show a timeline. */
  at: number;
  text: string;
  /**
   * Who said it.
   *
   * Present whenever the capture provider knows — with per-participant audio it always
   * does, and it is a real name rather than "Speaker 1". Optional because the browser
   * fallback can only distinguish the operator from everyone else.
   */
  speaker?: string;
  speakerId?: string;
}

export interface Proposal {
  id: string;
  kind: 'action' | 'decision' | 'note' | 'agenda_covered';
  text: string;
  /** For agenda_covered: which item the model believes was discussed. */
  agendaItemId?: string;
  /** Set once the user accepts or dismisses; proposals are never applied on their own. */
  status: 'open' | 'accepted' | 'dismissed';
}

/**
 * The compact summary carried between ticks.
 *
 * This is what stops cost growing with meeting length: each extraction sees the last few
 * minutes plus this, never the whole transcript. A two-hour meeting costs the same per
 * tick as a ten-minute one.
 */
export interface RunningState {
  summary: string;
  decisions: string[];
  openQuestions: string[];
}

export const EMPTY_STATE: RunningState = { summary: '', decisions: [], openQuestions: [] };

/** Roughly three minutes of speech, which is what a rolling window is meant to hold. */
const WINDOW_CHARS = 4_000;

export class LiveSession {
  readonly lines: TranscriptLine[] = [];
  readonly proposals: Proposal[] = [];
  state: RunningState = { ...EMPTY_STATE };

  /**
   * Notes the assistant is keeping, revised as the meeting goes.
   *
   * Held here as the working copy, and written into the document each time the note-taker
   * revises it — see LiveRunner.writeNotes. It used to be held here and nowhere else until
   * the recording stopped, on the theory that persisting each revision would fill the
   * note's history with drafts; there is no persisted history of a note body for it to
   * fill, and the cost of that theory was a meeting that appeared to take no notes at all.
   */
  aiNotes = '';

  /** Tokens spent, so the meeting can report what it actually cost. */
  tokensIn = 0;
  tokensOut = 0;

  /**
   * When the capture provider actually got into the call.
   *
   * Only a bot has one, and it is later than `startedAt` by however long the bot spent in a
   * lobby. It was broadcast and never kept, so a page reload could not tell you whether the
   * bot ever got in — the one fact you most want after coming back to a meeting.
   */
  joinedAt: Date | null = null;

  /** Set while an extraction is in flight, so ticks cannot overlap. */
  extracting = false;
  /** Characters transcribed at the last extraction, to detect whether it is worth another. */
  private lastExtractedAt = 0;

  constructor(
    readonly noteId: string,
    readonly actorId: string,
    readonly startedAt = new Date(),
    /**
     * Where the audio comes from.
     *
     * Recorded because a returning tab needs to know whether it can pick the audio back up
     * on its own. A microphone can: browsers remember that permission per origin, so
     * getUserMedia resolves without asking again. A shared tab cannot — getDisplayMedia
     * always needs a fresh gesture and a picker, by design — so that case has to ask.
     */
    readonly source: 'bot' | 'microphone' | 'tab' = 'microphone',
  ) {}

  addLine(
    text: string,
    speaker?: { id: string; name: string },
    at?: number,
  ): TranscriptLine | null {
    const clean = text.trim();
    if (!clean) return null;
    const line: TranscriptLine = {
      id: `${this.noteId}-${this.lines.length}-${Date.now()}`,
      at: at ?? Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      text: clean,
      speaker: speaker?.name,
      speakerId: speaker?.id,
    };
    this.lines.push(line);
    if (speaker) this.speakers.set(speaker.id, speaker.name);
    return line;
  }

  /**
   * Whether listening is suspended.
   *
   * Held here rather than only in the runner because it is per-meeting state that outlives any
   * one socket: a tab that reloads mid-pause has to learn the meeting is paused from somewhere,
   * and the session is the thing that survives.
   */
  paused = false;

  /**
   * Record that listening stopped, or started again.
   *
   * A line rather than a separate list of intervals, so it travels with the transcript
   * everywhere the transcript already goes — the live view, the saved record, and the window
   * the model reads. That last one is the point: told plainly that a stretch is missing, the
   * extraction stops stitching the two sides of a gap into one conversation.
   *
   * Returns null when nothing changed, so pausing an already-paused meeting is not an event and
   * does not litter the transcript with markers nobody asked for.
   */
  mark(kind: 'paused' | 'resumed'): TranscriptLine | null {
    const wantPaused = kind === 'paused';
    if (this.paused === wantPaused) return null;
    this.paused = wantPaused;

    const line: TranscriptLine = {
      id: `${this.noteId}-${this.lines.length}-${Date.now()}`,
      at: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      text: wantPaused ? '— listening paused —' : '— listening resumed —',
      kind: wantPaused ? 'paused' : 'speech',
    };
    this.lines.push(line);
    return line;
  }

  /** Everyone heard so far, so the UI and the extraction prompt can name them. */
  readonly speakers = new Map<string, string>();

  /**
   * The transcript as the model reads it.
   *
   * Attributed when the provider knows who spoke — which is the difference between the
   * agent proposing "Marieke will send the dataset" and proposing "someone will send the
   * dataset". Extraction quality depends on this more than on any prompt wording.
   */
  get transcript(): string {
    return this.lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join('\n');
  }

  /** The last few minutes — what an extraction actually reads. */
  window(): string {
    const full = this.transcript;
    return full.length <= WINDOW_CHARS ? full : full.slice(-WINDOW_CHARS);
  }

  /**
   * Whether enough has been said to be worth another extraction.
   *
   * Ticking on volume of new speech rather than on a timer means a quiet stretch costs
   * nothing, and a dense one is not sampled too coarsely.
   */
  shouldExtract(minNewChars = 900): boolean {
    if (this.extracting) return false;
    return this.transcript.length - this.lastExtractedAt >= minNewChars;
  }

  markExtracted(): void {
    this.lastExtractedAt = this.transcript.length;
  }

  /**
   * Merge newly proposed items, skipping ones already present.
   *
   * The model re-reads an overlapping window each tick, so it will re-suggest things. A
   * duplicate proposal is worse than a missed one: it trains you to stop reading them.
   */
  mergeProposals(incoming: Array<Omit<Proposal, 'id' | 'status'>>, newId: () => string): Proposal[] {
    const added: Proposal[] = [];
    for (const candidate of incoming) {
      const text = candidate.text.trim();
      if (!text) continue;
      if (this.proposals.some((p) => similar(p.text, text) && p.kind === candidate.kind)) continue;
      const proposal: Proposal = { ...candidate, text, id: newId(), status: 'open' };
      this.proposals.push(proposal);
      added.push(proposal);
    }
    return added;
  }

  /**
   * Accept or dismiss a suggestion, while the meeting is still going.
   *
   * `status` has been on this type since the beginning and nothing ever changed it: every
   * proposal was created `open` and stayed open until the recording stopped, at which point
   * all of them were written down and you triaged the pile afterwards. Deciding in the
   * moment is better because the context is still in the room — a week later you cannot
   * tell a real commitment from something the model misheard.
   *
   * The rest of the pipeline already accounts for a decided proposal: `openProposals` is
   * what the end-of-session write and the action-point creation both read, so dismissing
   * keeps something out of the note and accepting stops it being added twice. Deciding one
   * twice is a no-op rather than an error — two people in the room may press at once.
   */
  decide(proposalId: string, decision: 'accepted' | 'dismissed'): Proposal | null {
    const proposal = this.proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.status !== 'open') return null;
    proposal.status = decision;
    return proposal;
  }

  get openProposals(): Proposal[] {
    return this.proposals.filter((p) => p.status === 'open');
  }

  /**
   * Everything not thrown away — what the note should end up holding.
   *
   * Distinct from `openProposals`, and the distinction is load-bearing. Accepting a decision
   * or a note means "yes, record that", so reading `openProposals` when writing the note
   * would make accepting one the way to delete it. Undecided and accepted both belong in the
   * note; only a dismissal keeps something out.
   *
   * Creating action points still reads `openProposals`, because an accepted action has
   * already been created and adding it again would give you it twice.
   */
  get keptProposals(): Proposal[] {
    return this.proposals.filter((p) => p.status !== 'dismissed');
  }

  get durationSeconds(): number {
    return Math.round((Date.now() - this.startedAt.getTime()) / 1000);
  }
}

/**
 * Loose text match for duplicate detection.
 *
 * Deliberately fuzzy: the model rarely repeats itself word for word, so exact matching
 * would let near-duplicates through, which is the failure that matters here.
 */
export function similar(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      // Punctuation becomes a SPACE, not nothing: deleting it turns "supplier-level"
      // into "supplierlevel", which then shares no words with "supplier level" — and
      // that rewording is exactly the near-duplicate this is meant to catch.
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);
  const wordsA = new Set(norm(a));
  const wordsB = norm(b);
  if (wordsA.size === 0 || wordsB.length === 0) return false;
  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.length) >= 0.6;
}
