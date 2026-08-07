import { DocumentsWidget } from './DocumentsWidget.js';
import type { WidgetDef } from '../types.js';

export const docsWidgets: Record<string, WidgetDef> = {
  /*
   * Files under one record.
   *
   * The component already takes `clientId` or `projectId` and does the right thing with
   * either, so the slot's `entityId` is passed as both: a client page and a project page each
   * hand it their own id, and only one of the two queries can match anything.
   *
   * That is a little crude and it is honest about what the slot knows. The alternative would
   * be a second field on WidgetProps naming the entity *type*, which every widget would then
   * have to switch on — for the one widget in the app that can serve two kinds of page.
   */
  'docs:document-list': {
    title: 'Documents',
    description: 'Files filed under this record.',
    slot: 'entity-page',
    defaultSpan: 6,
    permission: 'docs.read',
    Component: ({ entityId }) => (entityId ? <DocumentsWidget clientId={entityId} projectId={entityId} /> : null),
  },
};
