import { PRIORITIES, TASK_TYPES, type Person, type TaskType } from './types.js';

export interface QuickAdd {
  title: string;
  priority?: string;
  type?: TaskType;
  labels?: string[];
  assigneeId?: string | null;
  estimateMinutes?: number | null;
  /** What was recognised, so the form can show it back before anything is created. */
  recognised: Array<{ token: string; means: string }>;
}

/**
 * One line in, a card out.
 *
 * Adding a card meant a title, then opening it, then four selects — so in practice everything
 * arrived as a bare title at normal priority with no owner, and the metadata the board is
 * built to show was never entered. This is the same information typed the way people already
 * write it down.
 *
 *   Fix the login redirect !high @galang #frontend ~2h bug
 *
 * The rules are deliberately dull. A token only counts when it is a whole word, so an email
 * address in a title is not an assignee and "C#" is not a label. Anything unrecognised stays
 * in the title rather than being silently eaten — a parser that quietly discards words is
 * worse than no parser, because you cannot see what it took.
 */
export function parseQuickAdd(input: string, people: Person[]): QuickAdd {
  const recognised: QuickAdd['recognised'] = [];
  const labels: string[] = [];
  let priority: string | undefined;
  let type: TaskType | undefined;
  let assigneeId: string | null | undefined;
  let estimateMinutes: number | null | undefined;

  const kept: string[] = [];

  for (const word of input.split(/\s+/)) {
    if (!word) continue;

    // !high — priority
    const bang = /^!(\w+)$/.exec(word);
    if (bang && (PRIORITIES as readonly string[]).includes(bang[1]!.toLowerCase())) {
      priority = bang[1]!.toLowerCase();
      recognised.push({ token: word, means: `${priority} priority` });
      continue;
    }

    // @name — assignee, matched on any word of the display name so "@galang" finds
    // "Galang Andika" without anyone having to know the full spelling.
    const at = /^@([\w.-]+)$/.exec(word);
    if (at) {
      const needle = at[1]!.toLowerCase();
      const found = people.find((p) =>
        p.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(needle)),
      );
      if (found) {
        assigneeId = found.id;
        recognised.push({ token: word, means: found.displayName });
        continue;
      }
    }

    // #label — free text, so no validation beyond it being a word
    const hash = /^#([\w-]+)$/.exec(word);
    if (hash) {
      labels.push(hash[1]!);
      recognised.push({ token: word, means: `label ${hash[1]}` });
      continue;
    }

    // ~2h / ~90m — an estimate
    const tilde = /^~(\d+(?:[.,]\d+)?)(h|m)$/i.exec(word);
    if (tilde) {
      const n = Number(tilde[1]!.replace(',', '.'));
      if (Number.isFinite(n) && n > 0) {
        estimateMinutes = tilde[2]!.toLowerCase() === 'h' ? Math.round(n * 60) : Math.round(n);
        recognised.push({ token: word, means: `${estimateMinutes} minutes` });
        continue;
      }
    }

    // A bare type word, but only as the last word — otherwise "Fix the bug in checkout"
    // would file itself as a bug and lose the word from its own title.
    if ((TASK_TYPES as readonly string[]).includes(word.toLowerCase())) {
      kept.push(word);
      continue;
    }

    kept.push(word);
  }

  // The trailing type word, removed only once everything else has been read.
  const last = kept[kept.length - 1]?.toLowerCase();
  if (last && (TASK_TYPES as readonly string[]).includes(last) && kept.length > 1) {
    type = last as TaskType;
    kept.pop();
    recognised.push({ token: last, means: `a ${last}` });
  }

  return {
    title: kept.join(' ').trim(),
    priority,
    type,
    labels: labels.length > 0 ? labels : undefined,
    assigneeId,
    estimateMinutes,
    recognised,
  };
}
