import { Extension } from '@tiptap/core';
import { collab } from 'prosemirror-collab';

/**
 * The collaboration plugin, as a TipTap extension.
 *
 * TipTap has no opinion about collaboration beyond letting an extension contribute
 * ProseMirror plugins, which is all this needs to be. The version and client id come from the
 * server's first message, so it is configured when the editor is created and never again —
 * the plugin counts from the version it was given, and changing that under a running editor
 * would make every subsequent step describe a document nobody has.
 *
 * Kept apart from useNoteDoc deliberately. That module owns the socket and reaches for the
 * signed-in user; this one is pure editor configuration, so tests can build the schema
 * without pulling authentication and a browser environment in behind it.
 */
export const CollabExtension = Extension.create<{ version: number; clientId: string }>({
  name: 'noteCollab',
  addOptions() {
    return { version: 0, clientId: 'local' };
  },
  addProseMirrorPlugins() {
    return [collab({ version: this.options.version, clientID: this.options.clientId })];
  },
});
