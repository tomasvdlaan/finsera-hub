export { noteExtensions, noteSchema, emptyDoc, replacing } from './schema.js';
export { docToMarkdown, noteSerializer } from './markdown/serialize.js';
export { markdownToDoc } from './markdown/parse.js';
export { headingsOf, sectionRange, endOfDoc, type SectionRange } from './sections.js';

/*
 * ProseMirror itself, re-exported.
 *
 * Not laziness — necessity. The schema is an object identity: a `Step` deserialised against
 * one copy of prosemirror-model does not apply to a document built with another, and the
 * failure is a confusing "Invalid content" rather than anything that names the real cause.
 * Consumers taking their own dependency is exactly how two copies end up installed, so the
 * package that owns the schema hands out the library that built it.
 */
export { DOMSerializer, Fragment, Node, Slice, type Schema } from '@tiptap/pm/model';
export { Mapping, ReplaceStep, Step, Transform } from '@tiptap/pm/transform';
