import { api, openFile, type PortalDocument } from '../lib/api.js';
import { Listing, date, useList } from './shared.js';

export function Documents() {
  const { rows, error } = useList<PortalDocument>(api.documents);

  return (
    <Listing rows={rows} error={error} empty="Er zijn nog geen documenten met u gedeeld.">
      {(documents) => (
        <>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Gedeeld op</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td>{date(d.created_at)}</td>
                  <td className="num">
                    <button
                      className="link"
                      onClick={() => openFile(`/documents/${d.id}/download`)}
                    >
                      Downloaden
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Listing>
  );
}
