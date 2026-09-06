import { api, type PortalPage } from '../lib/api.js';
import { Listing, Page, useList } from './shared.js';

/**
 * The reports built for this client, each a link on their own address.
 *
 * A page is deliberately a plain `<a href>` rather than anything clever: the point of the
 * whole feature is that `duce.finsera.nl/rapportage-q3` is an ordinary URL that survives
 * being pasted into an email, so it must behave like one here too.
 */
export function Pages() {
  const { rows, error } = useList<PortalPage>(api.pages);

  return (
    <Page title="Rapporten" lead="De rapportages die we voor u gebouwd hebben.">
      <Listing rows={rows} error={error} empty="Er staan nog geen rapportages voor u klaar.">
        {(pages) => (
        <ul className="pages">
          {pages.map((p) => (
            <li key={p.slug}>
              <a href={`/${p.slug}/`}>{p.title}</a>
              <span className="tag">/{p.slug}</span>
            </li>
          ))}
          </ul>
        )}
      </Listing>
    </Page>
  );
}
