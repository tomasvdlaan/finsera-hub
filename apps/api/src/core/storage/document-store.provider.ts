import type { Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { GraphClient } from '../graph/graph.client.js';
import { GraphDriveService } from '../graph/graph-drive.service.js';
import { DocumentStore } from './document-store.js';
import { LocalDocumentStore } from './local-document-store.js';
import { SharePointDocumentStore } from './sharepoint-document-store.js';
import { StorageService } from './storage.service.js';

/**
 * Which backend documents use, decided once at boot from DOCS_STORE.
 *
 * Fails closed in the direction that matters. Unset, misspelled, or anything other than
 * 'sharepoint' leaves documents on the local disk exactly as they were before D8 — so a
 * forgotten variable in deploy/.env is a deployment that still works, not one that loses
 * files. The same instinct as PORTAL_ROLE_CHECK: a security or durability default that a
 * typo can switch off is not a default.
 *
 * But DOCS_STORE=sharepoint with no credentials throws at boot rather than quietly writing to
 * disk, following StorageService's own precedent. That combination is not a degraded mode, it
 * is somebody believing files are going somewhere they are not, and the time to find out is
 * the deploy rather than the restore.
 */
export const documentStoreProvider: Provider = {
  provide: DocumentStore,
  inject: [StorageService, GraphDriveService, GraphClient],
  useFactory: (
    storage: StorageService,
    drive: GraphDriveService,
    graph: GraphClient,
  ): DocumentStore => {
    const logger = new Logger('DocumentStore');
    const configured = (process.env.DOCS_STORE ?? 'local').trim().toLowerCase();

    if (configured === 'sharepoint') {
      if (!graph.configured) {
        throw new Error(
          `DOCS_STORE is 'sharepoint' but Graph is not configured: ${graph.unconfiguredReason}. ` +
            'Set the credentials, or set DOCS_STORE=local — refusing to start and write ' +
            'documents to the local disk while the configuration says otherwise.',
        );
      }
      logger.log(`Documents: SharePoint (site ${graph.siteId})`);
      return new SharePointDocumentStore(drive, graph);
    }

    if (configured !== 'local') {
      // Named rather than swallowed: a typo here is silent data placement, and the whole
      // point of failing closed is that somebody still gets told.
      logger.warn(`DOCS_STORE '${configured}' is not a backend — using local disk`);
    }
    logger.log('Documents: local disk');
    return new LocalDocumentStore(storage);
  },
};
