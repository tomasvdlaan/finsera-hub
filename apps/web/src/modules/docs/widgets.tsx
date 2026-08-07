import { Card } from '../../shell/ui/card.js';
import { DocumentsWidget } from './DocumentsWidget.js';
import type { WidgetDef } from '../types.js';

export const docsWidgets: Record<string, WidgetDef> = {
  /**
   * Files under one record.
   *
   * The only widget in the app that serves two kinds of page, which is why `entityTypes` is a
   * list rather than a single value. The component already takes either `clientId` or
   * `projectId` and queries accordingly — it just has to be told which one it has been handed,
   * and the slot's `entityType` is what tells it.
   */
  'docs:document-list': {
    title: 'Documents',
    description: 'Files filed under this record.',
    slot: 'entity-page',
    entityTypes: ['client', 'project'],
    defaultSpan: 6,
    permission: 'docs.read',
    Component: ({ entityId, entityType }) =>
      entityId ? (
        <Card title="Documents">
          <DocumentsWidget
            clientId={entityType === 'client' ? entityId : undefined}
            projectId={entityType === 'project' ? entityId : undefined}
          />
        </Card>
      ) : null,
  },
};
