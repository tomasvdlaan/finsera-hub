import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { resetDb, seedUser, testDb, truncate } from '../../../test/db.js';
import { notes, proposals as proposalRows } from '../meetings.schema.js';
import { LiveSession } from './live-session.js';
import { ProposalLedger } from './proposal-ledger.service.js';

/**
 * The ledger, and the one distinction it exists to make.
 *
 * Everything else here is bookkeeping. What matters is whether a dismissal is recorded as
 * evidence about the suggestion or as evidence about the operator's attention, because a
 * table that files them all as one verdict is exactly as useless as the accept button it
 * replaced — and would be trusted more, being newer.
 */
describe('ProposalLedger', () => {
  let ledger: ProposalLedger;
  let noteId: string;
  let actorId: string;

  const rowFor = async (id: string) => {
    const [row] = await testDb.select().from(proposalRows).where(eq(proposalRows.id, id)).limit(1);
    return row;
  };

  /** A session with one proposal already at the front of the queue. */
  const proposed = async (text = 'Send DocHorse the supplier drill-down') => {
    const session = new LiveSession(noteId, actorId);
    const [proposal] = session.mergeProposals(
      [{ kind: 'action', text, confidence: 0.82 }],
      () => crypto.randomUUID(),
    );
    await ledger.recorded(noteId, [proposal!], {
      source: 'extraction',
      eagerness: 'balanced',
      triageScore: 0.67,
      window: 'Marieke: ik stuur de drill-down morgen.',
    });
    return { session, proposal: proposal! };
  };

  beforeEach(async () => {
    await resetDb();
    await truncate(
      sql`TRUNCATE meetings.proposals, meetings.action_items, meetings.notes CASCADE`,
    );
    actorId = crypto.randomUUID();
    await seedUser(actorId, 'admin', 'Ledger');
    ledger = new ProposalLedger(testDb);
    noteId = await seedNote(actorId);
  });

  it('writes down what was proposed, and what it was drawn from', async () => {
    const { proposal } = await proposed();

    const row = await rowFor(proposal.id);
    expect(row?.outcome).toBe('open');
    expect(row?.source).toBe('extraction');
    // The four columns that make a row worth having. Without the window a row records a
    // verdict and cannot say what it was about, which is unusable for calibrating anything.
    expect(row?.confidence).toBeCloseTo(0.82);
    expect(row?.triageScore).toBeCloseTo(0.67);
    expect(row?.eagerness).toBe('balanced');
    expect(row?.window).toContain('drill-down');
  });

  it('files a considered dismissal as evidence', async () => {
    const { proposal } = await proposed();

    // Long enough to have read two lines of text and decided against them.
    await ledger.dismissed(proposal, actorId, { at: proposal.shownAt! + 6_000 });

    const row = await rowFor(proposal.id);
    expect(row?.outcome).toBe('dismissed');
    expect(row?.dismissReason).toBe('judged');
    expect(row?.decisionMs).toBe(6_000);
    expect(row?.decidedBy).toBe(actorId);
  });

  it('files a press too fast to have read the card as a reflex', async () => {
    const { proposal } = await proposed();

    await ledger.dismissed(proposal, actorId, { at: proposal.shownAt! + 300 });

    const row = await rowFor(proposal.id);
    expect(row?.outcome).toBe('dismissed');
    // Still a dismissal — the suggestion stays out of the note. But it is not a judgement
    // about the suggestion, and anything treating dismissals as evidence must skip it.
    expect(row?.dismissReason).toBe('reflex');
  });

  it('files a dismissal of something the note already says as a duplicate, however fast', async () => {
    const { proposal } = await proposed();

    await ledger.dismissed(proposal, actorId, {
      alreadyInNote: true,
      at: proposal.shownAt! + 200,
    });

    const row = await rowFor(proposal.id);
    /*
     * Ahead of the reflex check on purpose. Recognising something you read two minutes ago
     * takes no time at all, so a fast press on a repeat is the expected response rather than
     * an inattentive one — and filing it as noise would hide the agent's most fixable
     * failure behind its least informative one.
     */
    expect(row?.dismissReason).toBe('duplicate');
  });

  it('settles everything nobody objected to as kept', async () => {
    const { session, proposal } = await proposed();
    const [second] = session.mergeProposals(
      [{ kind: 'decision', text: 'Stay on Postgres' }],
      () => crypto.randomUUID(),
    );
    await ledger.recorded(noteId, [second!], { source: 'extraction' });

    await ledger.dismissed(proposal, actorId, { at: proposal.shownAt! + 5_000 });
    session.decide(proposal.id, 'dismissed');

    await ledger.settled(
      noteId,
      session.keptProposals.map((p) => p.id),
    );

    // A meeting nobody objected during must not look like one that crashed mid-recording,
    // which is what leaving these `open` would have said.
    expect((await rowFor(second!.id))?.outcome).toBe('kept');
    // And the sweep must never overwrite a decision already made.
    expect((await rowFor(proposal.id))?.outcome).toBe('dismissed');
  });

  it('records an explicit keep without inventing a fourth outcome', async () => {
    const { proposal } = await proposed();

    await ledger.kept(proposal, actorId, proposal.shownAt! + 2_000);

    const row = await rowFor(proposal.id);
    expect(row?.outcome).toBe('kept');
    // `decidedAt` is what separates "somebody said yes" from "nobody said anything" — the
    // note ends up in the same state either way, so the outcome does not need to differ.
    expect(row?.decidedAt).not.toBeNull();
    expect(row?.decisionMs).toBe(2_000);
  });

  it('never fails the meeting it is measuring', async () => {
    const orphan = {
      id: crypto.randomUUID(),
      kind: 'action' as const,
      text: 'Never recorded',
      status: 'open' as const,
    };

    // No row to update, and a note id that does not exist. Both must be survivable: a
    // recording that stopped because a ledger write failed would be a far worse outcome
    // than a missing data point.
    await expect(ledger.dismissed(orphan, actorId)).resolves.toBeUndefined();
    await expect(
      ledger.recorded(crypto.randomUUID(), [orphan], { source: 'extraction' }),
    ).resolves.toBeUndefined();
  });
});

/** A note to hang proposals from — the ledger cascades with it. */
async function seedNote(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await testDb.insert(notes).values({
    id,
    title: 'Voortgang',
    meetingDate: new Date().toISOString().slice(0, 10),
    createdBy: userId,
  });
  return id;
}
