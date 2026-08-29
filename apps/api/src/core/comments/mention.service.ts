import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '@platform/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB, type Database, type Tx } from '../db/db.module.js';
import { comments, entities, mentions, users } from '../db/core.schema.js';

export interface MentionView {
  id: string;
  /** Enough of the comment to recognise it without opening anything. */
  excerpt: string;
  authorName: string;
  subjectId: string;
  subjectType: string;
  subjectName: string;
  /** Where to go to read it, from the registry. Null if the entity has no page. */
  url: string | null;
  createdAt: string;
}

/** How much of the comment the list carries. Long enough to recognise, short enough to scan. */
const EXCERPT = 160;

/**
 * Being named in a comment, and not having read it yet.
 *
 * The two halves are deliberately different shapes. Writing is a side effect of writing a
 * comment and happens inside that transaction — a mention that survived a rolled-back comment
 * would point at nothing. Reading is a query the person makes about themselves, and nobody
 * can read anybody else's: the actor is the filter, not a parameter.
 *
 * Names are matched against the people who can actually sign in, at the moment the comment is
 * written. That is the whole resolution strategy and its limits are worth stating: renaming
 * somebody does not rewrite old comments, and a mention already recorded stays recorded. Both
 * are correct — the text is what was said at the time, and a notification that has been
 * delivered is not something an edit should be able to take back.
 */
@Injectable()
export class MentionService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Who can be named.
   *
   * Active users only. Naming somebody who has been deactivated would file a message where
   * nobody will ever look, and the deactivation check exists precisely because that account
   * is not coming back.
   */
  async mentionable(): Promise<Array<{ id: string; displayName: string }>> {
    return this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.isActive, true));
  }

  /**
   * Record everyone this comment names.
   *
   * Inside the caller's transaction, and idempotent: `mentions_once` means an edit that
   * leaves a name in place re-runs this and changes nothing, rather than notifying somebody a
   * second time for a typo fix.
   */
  async record(
    tx: Tx,
    input: {
      commentId: string;
      subjectId: string;
      subjectType: string;
      authorId: string;
      userIds: string[];
    },
  ): Promise<void> {
    // Yourself included: see the note on `mentions_not_self` in the schema for why a
    // deliberate note-to-self is a reminder rather than noise.
    const named = [...new Set(input.userIds)];
    if (named.length === 0) return;

    await tx
      .insert(mentions)
      .values(
        named.map((userId) => ({
          id: uuidv7(),
          userId,
          authorId: input.authorId,
          commentId: input.commentId,
          subjectId: input.subjectId,
          subjectType: input.subjectType,
        })),
      )
      .onConflictDoNothing();
  }

  /** What is waiting for the person asking. Never for anybody else. */
  async listFor(actor: Actor): Promise<MentionView[]> {
    const rows = await this.db
      .select({
        id: mentions.id,
        createdAt: mentions.createdAt,
        body: comments.body,
        deletedAt: comments.deletedAt,
        authorName: users.displayName,
        subjectId: mentions.subjectId,
        subjectType: mentions.subjectType,
        subjectName: entities.displayName,
        url: entities.urlPath,
      })
      .from(mentions)
      .innerJoin(comments, eq(comments.id, mentions.commentId))
      .innerJoin(users, eq(users.id, mentions.authorId))
      .innerJoin(entities, eq(entities.id, mentions.subjectId))
      .where(and(eq(mentions.userId, actor.userId), isNull(mentions.readAt)))
      .orderBy(desc(mentions.createdAt));

    return (
      rows
        /*
         * A comment deleted after it named you.
         *
         * The row survives — comments are tombstoned rather than removed, so the cascade never
         * fires — and there is nothing left to go and read. Dropping it here rather than
         * deleting the mention keeps the delete honest: the message existed, it just does not
         * any more.
         */
        .filter((r) => r.deletedAt === null)
        .map((r) => ({
          id: r.id,
          excerpt: r.body.length > EXCERPT ? `${r.body.slice(0, EXCERPT).trimEnd()}…` : r.body,
          authorName: r.authorName,
          subjectId: r.subjectId,
          subjectType: r.subjectType,
          subjectName: r.subjectName,
          url: r.url,
          createdAt: r.createdAt.toISOString(),
        }))
    );
  }

  /**
   * Mark some or all of mine read.
   *
   * Scoped to the actor in the WHERE clause rather than checked first, so an id belonging to
   * somebody else matches nothing instead of being refused — there is no version of this
   * where one person clears another's inbox, and no error message that leaks whose it was.
   */
  async markRead(actor: Actor, ids?: string[]): Promise<{ read: number }> {
    if (ids && ids.length === 0) return { read: 0 };
    const result = await this.db
      .update(mentions)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(mentions.userId, actor.userId),
          isNull(mentions.readAt),
          ids ? inArray(mentions.id, ids) : undefined,
        ),
      )
      .returning({ id: mentions.id });
    return { read: result.length };
  }
}

/**
 * The names written into a body, resolved to the people they mean.
 *
 * Plain `@Name` text rather than an id smuggled into the Markdown. A link carrying a uuid
 * would survive a rename, and it would also mean the stored comment is no longer the text
 * somebody typed — it would not grep, it would not read aloud, and TipTap strips a URI scheme
 * it does not recognise, so the durable-looking option is the one that quietly breaks.
 *
 * Longest name first, so "Marijn Jansen" is not matched as "Marijn" with a surname trailing
 * after it. The character before the `@` must be a boundary, or an email address in a comment
 * would name half the company.
 */
export function namesIn(
  body: string,
  people: Array<{ id: string; displayName: string }>,
): string[] {
  const found = new Set<string>();
  const byLength = [...people].sort((a, b) => b.displayName.length - a.displayName.length);

  /*
   * Matched text is struck out as we go.
   *
   * Longest-first is not enough on its own: given "Marijn Jansen" and "Marijn", the long name
   * matches and then the short one matches the very same "@Marijn", because a space is a
   * perfectly good word boundary. Blanking what has been claimed — same length, so every
   * later offset still lines up — is what makes one mention name one person.
   */
  let rest = body;

  for (const person of byLength) {
    const name = person.displayName.trim();
    if (!name) continue;
    // Escaped, because a display name is user input and may contain regex punctuation.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\w@])@${escaped}(?![\\w])`, 'gi');

    let hit = false;
    rest = rest.replace(pattern, (whole: string, before: string) => {
      hit = true;
      // The boundary character is kept so the next name either side still has one.
      return before + ' '.repeat(whole.length - before.length);
    });
    if (hit) found.add(person.id);
  }
  return [...found];
}

/** Unread mentions, for the badge. One number, so the nav can ask cheaply. */
export const unreadCount = (db: Database, userId: string) =>
  db
    .select({ n: sql<number>`count(*)::int` })
    .from(mentions)
    .innerJoin(comments, eq(comments.id, mentions.commentId))
    .where(and(eq(mentions.userId, userId), isNull(mentions.readAt), isNull(comments.deletedAt)))
    .then((r) => r[0]?.n ?? 0);
