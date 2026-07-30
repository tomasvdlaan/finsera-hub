import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Mapping,
  Step,
  Transform,
  docToMarkdown,
  markdownToDoc,
  noteSchema,
  sectionRange,
} from '@platform/note-doc';
import type { Actor } from '@platform/contracts';
import { NoteDocService, type Persistence } from './note-doc.service.js';
import { appendMarkdown, replaceSectionMarkdown } from './note-edit.js';

const actor: Actor = { userId: 'user-1', role: 'admin' };
const assistant: Actor = { userId: 'user-ai', role: 'member' };
const NOTE = 'note-1';

function persistenceFor(initial: string) {
  const store = new Map<string, string>([[NOTE, initial]]);
  const persistence: Persistence = {
    load: vi.fn(async (id: string) => store.get(id) ?? ''),
    save: vi.fn(async (id: string, markdown: string) => void store.set(id, markdown)),
  };
  return { persistence, store };
}

/**
 * A client editing its own copy, the way the browser does.
 *
 * The point of going through a Transform is that the steps are real ones produced against a
 * specific version of the document — the same thing prosemirror-collab sends over the wire.
 * Hand-written step JSON would test the plumbing while assuming away the part that breaks.
 */
function stepsFrom(markdown: string, change: (tr: Transform) => void) {
  const tr = new Transform(markdownToDoc(markdown));
  change(tr);
  return tr.steps.map((s) => s.toJSON());
}

/** `insertText` belongs to Transaction; a bare Transform inserts a text node. */
const typeAt = (tr: Transform, pos: number, text: string) =>
  tr.insert(pos, noteSchema.text(text));

/** The position just inside the end of the document's second block — a paragraph. */
function endOfFirstParagraph(doc: import('@platform/note-doc').Node): number {
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.type.name === 'paragraph' && child.content.size > 0) {
      return pos + child.nodeSize - 1;
    }
    pos += child.nodeSize;
  }
  throw new Error('no paragraph in the fixture');
}

describe('NoteDocService', () => {
  let docs: NoteDocService;

  beforeEach(() => {
    const made = persistenceFor('# Standup\n\nSome preamble.');
    docs = new NoteDocService();
    docs.bind(made.persistence);
  });

  it('hydrates from the stored Markdown at version zero', async () => {
    const snapshot = await docs.snapshot(NOTE);
    expect(snapshot.version).toBe(0);
    expect(snapshot.markdown.trim()).toBe('# Standup\n\nSome preamble.');
  });

  it('opens a document once when two clients join at the same moment', async () => {
    const made = persistenceFor('# One');
    const service = new NoteDocService();
    service.bind(made.persistence);

    const [a, b] = await Promise.all([service.snapshot(NOTE), service.snapshot(NOTE)]);
    expect(a.version).toBe(b.version);
    expect(made.persistence.load).toHaveBeenCalledTimes(1);
  });

  it('applies steps and advances the version', async () => {
    const steps = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 20, '!'));
    const result = await docs.apply(NOTE, { version: 0, steps, clientId: 'c1', actor });

    expect(result).toEqual({ ok: true, version: 1 });
    expect((await docs.snapshot(NOTE)).markdown).toContain('!');
  });

  /**
   * The refusal that makes the whole thing safe.
   *
   * A client whose steps are based on an older version is told no, rather than having its
   * edit applied at positions that have since moved.
   */
  it('refuses steps based on a stale version', async () => {
    const first = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 12, 'A'));
    await docs.apply(NOTE, { version: 0, steps: first, clientId: 'c1', actor });

    const stale = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 12, 'B'));
    expect(await docs.apply(NOTE, { version: 0, steps: stale, clientId: 'c2', actor })).toEqual({
      ok: false,
      reason: 'behind',
    });
  });

  it('hands a client exactly the steps it missed', async () => {
    const steps = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 12, 'X'));
    await docs.apply(NOTE, { version: 0, steps, clientId: 'c1', actor });

    const missed = await docs.since(NOTE, 0);
    expect(missed?.version).toBe(1);
    expect(missed?.steps).toHaveLength(1);
    expect(missed?.clientIds).toEqual(['c1']);

    // Already up to date: nothing to send, but not an error.
    expect((await docs.since(NOTE, 1))?.steps).toHaveLength(0);
  });

  it('tells a client that is too far behind to reload', async () => {
    expect(await docs.since(NOTE, 99)).toBeNull();
  });

  /**
   * A step that applies but produces a document nothing can open.
   *
   * Found in the browser: a hand-made step was accepted here, went into the step history,
   * and then every client that pulled it threw `Invalid content for node heading` — so the
   * note could not be edited by anybody until its body was reset by hand. The server's
   * validation has to be at least as strict as the client's, or one malformed batch takes
   * the note down for everyone.
   */
  it('rejects a step whose result is not a valid document', async () => {
    const made = persistenceFor('# A heading');
    const service = new NoteDocService();
    service.bind(made.persistence);

    // A block node where only inline content is allowed.
    const bad = [
      {
        stepType: 'replace',
        from: 1,
        to: 1,
        slice: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'no' }] }] },
      },
    ];

    expect(await service.apply(NOTE, { version: 0, steps: bad, clientId: 'c1', actor })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // And the document is untouched, rather than left half-changed.
    expect((await service.snapshot(NOTE)).version).toBe(0);
  });

  it('rejects a step that cannot apply even at the right version', async () => {
    const nonsense = [{ stepType: 'replace', from: 9_999, to: 10_000 }];
    expect(
      await docs.apply(NOTE, { version: 0, steps: nonsense, clientId: 'c1', actor }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  /**
   * The echo must carry the sender's own name back to them.
   *
   * `receiveTransaction` in the browser decides whether an arriving step is your own
   * confirmation or somebody else's edit by comparing this id against the collaboration
   * plugin's. Get it wrong and the editor does not recognise its own work coming back: it
   * applies it a second time as though a stranger had typed it, leaves its own steps
   * unconfirmed, and sends them again — one extra copy per round trip, without end.
   *
   * That is not theoretical. The server used to name each *connection* (c1, c2), while the
   * editor survives a reconnect and kept the name it was given first. After any reconnect the
   * two disagreed, and twenty-three typed characters became six thousand copies in seconds
   * with the tab locked hard enough that the page would not reload. The name belongs to the
   * editor, and the server's job is only to hand it back unchanged.
   */
  it('echoes the identity the client gave, unchanged', async () => {
    const mine = 'b3f1c0de-0000-4000-8000-000000000001';
    const heard: Array<{ clientIds: string[] }> = [];
    docs.onChange((change) => heard.push({ clientIds: change.clientIds }));

    const steps = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 12, 'Z'));
    await docs.apply(NOTE, { version: 0, steps, clientId: mine, actor });

    expect(heard[0]!.clientIds).toEqual([mine]);
    expect((await docs.since(NOTE, 0))!.clientIds).toEqual([mine]);
  });

  it('notifies listeners with the steps and who sent them', async () => {
    const heard: unknown[] = [];
    docs.onChange((change) => heard.push(change));

    const steps = stepsFrom('# Standup\n\nSome preamble.', (tr) => typeAt(tr, 12, 'Y'));
    await docs.apply(NOTE, { version: 0, steps, clientId: 'c9', actor });

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ noteId: NOTE, version: 1, clientIds: ['c9'] });
  });
});

describe('the assistant writing while somebody is typing', () => {
  /**
   * This is the failure the whole change exists to remove.
   *
   * Before, four writers each read the body, changed the string and wrote it all back — the
   * editor's autosave, the note-taking behaviour, the assembly at stop, and the assistant's
   * write tool. Last one won and the rest disappeared with nothing reporting it.
   *
   * Here the assistant replaces its own section while a person types in a paragraph above,
   * and both edits are in the result. That only works because each change is bounded to the
   * positions it actually touches.
   */
  it('keeps both edits', async () => {
    const body = [
      '# Standup',
      '',
      'Tomas is here.',
      '',
      '## Notes from the meeting',
      '',
      'Nothing yet.',
      '',
      '## Follow-up',
      '',
      '- Ask compliance',
    ].join('\n');

    const made = persistenceFor(body);
    const docs = new NoteDocService();
    docs.bind(made.persistence);

    const start = await docs.snapshot(NOTE);
    expect(start.version).toBe(0);

    // The person types at the end of the paragraph near the top, based on version 0.
    const typed = stepsFrom(body, (tr) => typeAt(tr, endOfFirstParagraph(tr.doc), ' Sanne too.'));

    // The assistant rewrites its own section further down, also based on version 0.
    await docs.edit(NOTE, assistant, (tr) => {
      replaceSectionMarkdown(tr, 'Notes from the meeting', '- Decided on a weekly refresh');
    });

    // The person's steps arrive second and are refused, because the version moved.
    const refused = await docs.apply(NOTE, { version: 0, steps: typed, clientId: 'c1', actor });
    expect(refused).toEqual({ ok: false, reason: 'behind' });

    /*
     * So the client catches up and rebases — mapping its own steps through the ones it
     * missed. This is exactly what prosemirror-collab does in the browser, which is why it is
     * done here with the same primitives rather than by re-deriving the edit: re-deriving
     * would prove the test author can find the right position, not that a rebase works.
     */
    const missed = (await docs.since(NOTE, 0))!;
    const mapping = new Mapping(missed.steps.map((s) => s.getMap()));
    const rebased = typed
      .map((raw) => Step.fromJSON(noteSchema, raw).map(mapping))
      .filter((s): s is Step => s !== null);

    const accepted = await docs.apply(NOTE, {
      version: missed.version,
      steps: rebased.map((s) => s.toJSON()),
      clientId: 'c1',
      actor,
    });
    expect(accepted.ok).toBe(true);

    const final = (await docs.snapshot(NOTE)).markdown;
    expect(final).toContain('Sanne too.');
    expect(final).toContain('- Decided on a weekly refresh');
    expect(final).toContain('## Follow-up');
    expect(final).toContain('- Ask compliance');
    expect(final).not.toContain('Nothing yet.');
  });
});

describe('persistence', () => {
  it('writes the body out on flush, attributed to whoever changed it', async () => {
    const made = persistenceFor('# Standup');
    const docs = new NoteDocService();
    docs.bind(made.persistence);

    await docs.edit(NOTE, assistant, (tr) => appendMarkdown(tr, 'A line from the assistant.'));
    await docs.flush(NOTE);

    expect(made.persistence.save).toHaveBeenCalledTimes(1);
    expect(made.store.get(NOTE)).toContain('A line from the assistant.');
    expect(vi.mocked(made.persistence.save).mock.calls[0]![2]).toEqual(assistant);
  });

  it('does nothing on flush when there is nothing to save', async () => {
    const made = persistenceFor('# Standup');
    const docs = new NoteDocService();
    docs.bind(made.persistence);
    await docs.snapshot(NOTE);
    await docs.flush(NOTE);
    expect(made.persistence.save).not.toHaveBeenCalled();
  });

  it('stays dirty when the save fails, so the work is not dropped', async () => {
    const made = persistenceFor('# Standup');
    made.persistence.save = vi.fn(async () => {
      throw new Error('database is down');
    });
    const docs = new NoteDocService();
    docs.bind(made.persistence);

    await docs.edit(NOTE, actor, (tr) => appendMarkdown(tr, 'Something worth keeping.'));
    await expect(docs.flush(NOTE)).rejects.toThrow('database is down');

    // The second attempt still has the text to write.
    made.persistence.save = vi.fn(async () => undefined);
    await docs.flush(NOTE);
    expect(vi.mocked(made.persistence.save).mock.calls[0]![1]).toContain('Something worth keeping.');
  });

  it('flushes before letting a note go', async () => {
    const made = persistenceFor('# Standup');
    const docs = new NoteDocService();
    docs.bind(made.persistence);

    await docs.edit(NOTE, actor, (tr) => appendMarkdown(tr, 'Last words.'));
    await docs.release(NOTE);
    expect(made.store.get(NOTE)).toContain('Last words.');
  });

  it('keeps a document that somebody is watching, and drops an idle one', async () => {
    const made = persistenceFor('# Standup');
    const docs = new NoteDocService();
    docs.bind(made.persistence);

    await docs.snapshot(NOTE);
    docs.watch(NOTE);
    await docs.sweep(Date.now() + 60 * 60_000);
    expect(made.persistence.load).toHaveBeenCalledTimes(1);

    docs.unwatch(NOTE);
    await docs.sweep(Date.now() + 60 * 60_000);
    await docs.snapshot(NOTE);
    expect(made.persistence.load).toHaveBeenCalledTimes(2);
  });
});

describe('bounded edits', () => {
  const body = '# Note\n\nIntro.\n\n## Decisions\n\n- Old\n\n## Follow-up\n\n- Keep me';

  it('replaces only the named section', async () => {
    const tr = new Transform(markdownToDoc(body));
    replaceSectionMarkdown(tr, 'Decisions', '- New');
    const out = docToMarkdown(tr.doc);

    expect(out).toContain('- New');
    expect(out).not.toContain('- Old');
    expect(out).toContain('## Follow-up');
    expect(out).toContain('- Keep me');
    expect(out).toContain('Intro.');
  });

  it('adds the section when it is missing rather than failing', () => {
    const tr = new Transform(markdownToDoc('# Note\n\nIntro.'));
    replaceSectionMarkdown(tr, 'Decisions', '- First');
    const out = docToMarkdown(tr.doc);
    expect(out).toContain('## Decisions');
    expect(out).toContain('- First');
  });

  it('produces no steps when the section already says the same thing', () => {
    const tr = new Transform(markdownToDoc(body));
    replaceSectionMarkdown(tr, 'Decisions', '- Old');
    // The note-taker rewrites its section every ninety seconds, usually restating itself.
    expect(tr.steps).toHaveLength(0);
  });

  it('produces no steps for an empty append', () => {
    const tr = new Transform(markdownToDoc(body));
    appendMarkdown(tr, '   ');
    expect(tr.steps).toHaveLength(0);
  });

  it('appends without leaving a growing gap at the bottom', () => {
    const tr = new Transform(markdownToDoc('# Note\n\n'));
    appendMarkdown(tr, 'One.');
    appendMarkdown(tr, 'Two.');
    expect(docToMarkdown(tr.doc).trim()).toBe('# Note\n\nOne.\n\nTwo.');
  });

  it('touches no position outside the section it rewrites', () => {
    const doc = markdownToDoc(body);
    const before = sectionRange(doc, 'Follow-up')!;

    const tr = new Transform(doc);
    replaceSectionMarkdown(tr, 'Decisions', '- Something much longer than what was there');

    // Every step's range must fall inside the Decisions section, never past its end.
    const decisions = sectionRange(doc, 'Decisions')!;
    for (const step of tr.steps) {
      const json = step.toJSON() as { from: number; to: number };
      expect(json.from).toBeGreaterThanOrEqual(decisions.from);
      expect(json.to).toBeLessThanOrEqual(decisions.to);
    }
    expect(before.to).toBe(doc.content.size);
  });
});
