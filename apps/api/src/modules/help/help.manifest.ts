import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * Help: how to use the platform, written down and searchable.
 *
 * Declares no entities and publishes no events — a help page is not a record anybody links to
 * or reacts to. What it does declare is the part that matters: two read-only tools, so the
 * assistant answers "how do I send an invoice?" from the same pages a colleague would read,
 * instead of from whatever it half remembers about software in general.
 */
export const helpManifest = defineManifest({
  name: 'help',
  version: '0.1.0',

  permissions: [
    {
      capability: 'help.read',
      description: 'Read the help pages and search them.',
    },
  ],

  navigation: [{ label: 'Help', path: '/help', icon: 'book', section: 'more', order: 1 }],

  aiTools: [
    {
      name: 'help_search',
      description:
        'Search the platform\'s own help pages. Use this for ANY question about how to use the ' +
        'platform itself — where something is, how to do a task, what a button or status means, ' +
        'who is allowed to do something, what the assistant can do. Do not use it for questions ' +
        'about the business\'s data (clients, hours, invoices); other tools answer those. ' +
        'Returns the best-matching sections and the FULL TEXT of the top page (bestPage); answer ' +
        'from bestPage, naming it. Only call help_read if the answer is on another page in hits.',
      inputSchema: z.object({
        query: z.string().describe('What the person wants to know, in a few plain words.'),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'help.read',
      riskClass: 'read',
      handler: 'searchTool',
    },
    {
      name: 'help_read',
      description:
        'Read one help page in full, by its slug from help_search (for example ' +
        '"time/log-hours"). Answer from what it says and name the page you used so the person ' +
        'can open it. If the page does not cover the question, say so rather than filling the gap ' +
        'from general knowledge of how such software usually works.',
      inputSchema: z.object({ slug: z.string() }),
      outputSchema: z.object({}),
      permission: 'help.read',
      riskClass: 'read',
      handler: 'readTool',
    },
  ],
});
