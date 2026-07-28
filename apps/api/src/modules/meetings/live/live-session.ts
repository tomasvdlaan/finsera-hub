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

  /** Tokens spent, so the meeting can report what it actually cost. */
  tokensIn = 0;
  tokensOut = 0;

  /** Set while an extraction is in flight, so ticks cannot overlap. */
  extracting = false;
  /** Characters transcribed at the last extraction, to detect whether it is worth another. */
  private lastExtractedAt = 0;

  constructor(
    readonly noteId: string,
    readonly actorId: string,
    readonly startedAt = new Date(),
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

  get openProposals(): Proposal[] {
    return this.proposals.filter((p) => p.status === 'open');
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
