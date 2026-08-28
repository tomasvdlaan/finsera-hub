import { libraryFor } from '../widgets.js';
import { useCan } from '../useCan.js';
import type { EntityKind } from '../../modules/types.js';

/**
 * Whatever the installed modules want to say about this record.
 *
 * The client page used to import five widget components by name and the project page three,
 * which meant CRM had to know that billing, sales, docs, meetings, scrum and time all exist —
 * the exact coupling every manifest in this codebase is arranged to avoid, sitting in the two
 * pages people open most. Adding a module meant editing CRM.
 *
 * Now a module declares an `entity-page` widget and it appears. CRM names nobody.
 *
 * There is deliberately no ordering control. Which of four widgets a person wants first is not
 * something a module can know about a page it does not own, and the honest options were an
 * alphabetical sort or a priority number that every module would set to 1. Alphabetical at
 * least does not pretend.
 */
export function EntityWidgets({ entityId, entityType }: { entityId: string; entityType: EntityKind }) {
  // Permission is not re-checked here: this renders on a page the viewer has already been let
  // into, and each widget's own request is authorised on the server anyway. The check in the
  // dashboard's picker exists to avoid *offering* something that would fail — a different job.
  const { can } = useCan();
  const blocks = libraryFor('entity-page', can).filter(({ def }) =>
    def.entityTypes?.includes(entityType),
  );

  return (
    <>
      {blocks.map(({ key, def }) => {
        const Widget = def.Component;
        return (
          <div key={key} data-span={def.defaultSpan} className="entity-widget">
            <Widget settings={{}} entityId={entityId} entityType={entityType} />
          </div>
        );
      })}
    </>
  );
}
