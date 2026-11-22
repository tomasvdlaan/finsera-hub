import { describe, expect, it } from 'vitest';
import { languageInstruction, parseLanguage } from './transcription-language.js';

describe('transcription language', () => {
  it('accepts a known code and treats everything else as auto-detect', () => {
    expect(parseLanguage('nl')).toBe('nl');
    expect(parseLanguage('auto')).toBeNull();
    expect(parseLanguage('xx')).toBeNull();
    expect(parseLanguage(undefined)).toBeNull();
  });

  it('pins the prompt to the language, and adds nothing when unpinned', () => {
    expect(languageInstruction('nl')).toContain('spoken in Dutch');
    expect(languageInstruction('nl')).toContain('never translate');
    expect(languageInstruction(null)).toBe('');
  });
});
