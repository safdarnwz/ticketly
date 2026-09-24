import { describe, it, expect } from 'vitest';

import { translate, resolveLocaleChain, hasTranslation, type Catalogs } from '../domain/translator';

const catalogs: Catalogs = {
  en: { 'ticket.subject': 'Your ticket {pnr}', 'greeting': 'Hello' },
  hi: { 'ticket.subject': 'आपका टिकट {pnr}' },
  'hi-IN': { greeting: 'नमस्ते' },
};

describe('resolveLocaleChain', () => {
  it('builds requested → base → fallback → fallback-base', () => {
    expect(resolveLocaleChain('hi-IN', 'en')).toEqual(['hi-IN', 'hi', 'en']);
    expect(resolveLocaleChain('en', 'en')).toEqual(['en']);
  });
});

describe('translate', () => {
  it('happy: resolves in the requested locale with interpolation', () => {
    expect(translate(catalogs, 'hi', 'ticket.subject', { pnr: 'YB12' })).toBe('आपका टिकट YB12');
  });

  it('positive: falls back to base language then to fallback locale', () => {
    // hi-IN has no ticket.subject → falls to hi
    expect(translate(catalogs, 'hi-IN', 'ticket.subject', { pnr: 'YB12' })).toBe('आपका टिकट YB12');
    // fr missing entirely → falls to en
    expect(translate(catalogs, 'fr', 'greeting')).toBe('Hello');
  });

  it('edge: unknown key returns the key itself (never throws in prod)', () => {
    expect(translate(catalogs, 'en', 'does.not.exist')).toBe('does.not.exist');
  });

  it('edge: a missing interpolation var is left as a visible placeholder', () => {
    expect(translate(catalogs, 'en', 'ticket.subject')).toBe('Your ticket {pnr}');
  });

  it('negative: an empty key throws', () => {
    expect(() => translate(catalogs, 'en', '')).toThrow();
  });

  it('hasTranslation reports coverage across the chain', () => {
    expect(hasTranslation(catalogs, 'hi-IN', 'greeting')).toBe(true);
    expect(hasTranslation(catalogs, 'fr', 'ticket.subject')).toBe(true); // via en fallback
    expect(hasTranslation(catalogs, 'fr', 'nope')).toBe(false);
  });
});
