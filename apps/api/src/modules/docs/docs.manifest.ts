import { defineManifest } from '@platform/contracts';
import { z } from 'zod';

/**
 * Document Management (Phase 3 brief §5).
 *
 * No write tools: uploading is a deliberate human act, and an assistant that files
 * documents unprompted is exactly the autonomy the AI plan says to earn rather than
 * assume (O7).
 */
export const docsManifest = defineManifest({
  name: 'docs',
  version: '0.1.0',

  entities: [{ type: 'document', displayTemplate: '{title}', urlPattern: '/docs/documents/:id' }],

  structuralRefs: [
    { from: 'document', toType: 'client', required: false },
    { from: 'document', toType: 'project', required: false },
  ],

  publishes: [
    { name: 'document.uploaded', description: 'A document was uploaded.' },
    { name: 'document.version_added', description: 'A new version of a document was added.' },
    { name: 'document.archived', description: 'A document was archived.' },
  ],

  subscribes: [],

  permissions: [
    { capability: 'docs.read', description: 'View and download documents.' },
    { capability: 'docs.write', description: 'Upload documents and versions.' },
    { capability: 'docs.delete', description: 'Archive documents.' },
  ],

  navigation: [{ label: 'Documents', path: '/docs', icon: 'file' }],

  widgets: [{ slot: 'entity-page', component: 'docs:document-list' }],

  chatWidgets: [{ entityType: 'document', component: 'docs:document-card' }],

  reportingViews: [
    { view: 'docs.v_documents', description: 'Documents with their current version and index state.' },
  ],

  portalExposure: [], // sharing is Phase 7; nothing is portal-visible by default

  aiTools: [
    {
      name: 'docs_search',
      description:
        'Search documents by keyword and by meaning. Use for questions like "what did we agree about the reporting scope?".',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      outputSchema: z.object({}),
      permission: 'docs.read',
      riskClass: 'read',
      handler: 'searchTool',
    },
    {
      name: 'docs_list',
      description: 'List documents, optionally filtered to one client or project.',
      inputSchema: z.object({
        clientId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      }),
      outputSchema: z.object({}),
      permission: 'docs.read',
      riskClass: 'read',
      handler: 'listTool',
    },
    {
      name: 'docs_ask',
      description:
        'Retrieve the passages of one document most relevant to a question, e.g. its notice period or payment terms.',
      inputSchema: z.object({
        documentId: z.string().uuid(),
        question: z.string().min(1),
      }),
      outputSchema: z.object({}),
      permission: 'docs.read',
      riskClass: 'read',
      handler: 'askDocument',
    },
  ],
});
