import { describe, expect, it } from 'vitest';
import { segmentsFor } from './sharepoint-document-store.js';

/**
 * Where things land in the library, pinned.
 *
 * Three buckets at the top, each a category — client work, things belonging to nobody, and
 * what the platform writes on a schedule. Deliberately the shape FinseraHub already uses:
 * grouped top-level folders rather than a flat pile, and `Clients` as one bucket among three
 * rather than a wrapper around the whole library, which would be a level of nesting carrying
 * no information.
 *
 * Pure, so it costs nothing to assert — and this is the sort of decision that gets quietly
 * reverted by somebody adding a case to the function without reading the shape.
 */
describe('the library layout', () => {
  it('files client work under Clients', () => {
    expect(segmentsFor({ clientName: 'Plibs B.V.' })).toEqual(['Clients', 'Plibs B.V.']);
  });

  it('puts a project inside its client', () => {
    expect(segmentsFor({ clientName: 'Plibs B.V.', projectName: 'Jaarrekening' })).toEqual([
      'Clients',
      'Plibs B.V.',
      'Jaarrekening',
    ]);
  });

  /** Or a client folder fills with factuur-2026-0114.pdf and stops being usable. */
  it('keeps generated invoices and quotes in their own subfolder', () => {
    expect(segmentsFor({ clientName: 'Plibs B.V.', bucket: 'outgoing' })).toEqual([
      'Clients',
      'Plibs B.V.',
      'Uitgaand',
    ]);
  });

  /** Templates and prospect quotes: real documents that belong to no client. */
  it('files documents with no client at the top, not under Clients', () => {
    expect(segmentsFor({ orgScope: true })).toEqual(['_Algemeen']);
    expect(segmentsFor({})).toEqual(['_Algemeen']);
  });

  /**
   * The hours ledger is not client work and not a document somebody filed, so it is neither
   * inside Clients nor mixed in with the templates.
   */
  it('keeps scheduled exports in their own bucket', () => {
    expect(segmentsFor({ bucket: 'exports' })).toEqual(['_Exports']);
    // Even when a client is named, because an export spans all of them.
    expect(segmentsFor({ bucket: 'exports', clientName: 'Plibs B.V.' })).toEqual(['_Exports']);
  });
});
