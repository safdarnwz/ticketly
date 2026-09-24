import { describe, expect, it } from 'vitest';

import { applyPageEdit, isValidWindow, type PageState } from '../domain/content';

const published: PageState = {
  kind: 'page',
  title: 'About',
  body: 'v1',
  status: 'published',
  version: 3,
};

describe('applyPageEdit', () => {
  it('creates a page at version 1 (draft by default)', () => {
    const r = applyPageEdit(null, { title: 'About', body: 'x' });
    expect(r).toEqual({
      next: { kind: 'page', title: 'About', body: 'x', status: 'draft', version: 1 },
      bumped: false,
    });
  });
  it('bumps the version when a published body changes', () => {
    const r = applyPageEdit(published, { title: 'About', body: 'v2' });
    expect('next' in r && r.next.version).toBe(4);
    expect('bumped' in r && r.bumped).toBe(true);
  });
  it('does not bump for an unchanged re-save or a draft edit', () => {
    expect(applyPageEdit(published, { title: 'About', body: 'v1' })).toMatchObject({
      bumped: false,
      next: { version: 3 },
    });
    const draft = { ...published, status: 'draft' as const };
    expect(applyPageEdit(draft, { title: 'About', body: 'changed' })).toMatchObject({
      bumped: false,
      next: { version: 3 },
    });
  });
  it('bumps when a draft is published', () => {
    const draft = { ...published, status: 'draft' as const };
    expect(applyPageEdit(draft, { title: 'About', body: 'v1', status: 'published' })).toMatchObject(
      { bumped: true, next: { version: 4 } },
    );
  });
  it('legal pages are always published and cannot change kind', () => {
    expect(applyPageEdit(null, { kind: 'legal', title: 'Terms', body: 't' })).toMatchObject({
      next: { status: 'published' },
    });
    const terms: PageState = { ...published, kind: 'legal' };
    expect(applyPageEdit(terms, { title: 'Terms', body: 'x', status: 'draft' })).toEqual({
      error: 'Legal pages cannot be unpublished',
    });
    expect(applyPageEdit(terms, { kind: 'page', title: 'Terms', body: 'x' })).toEqual({
      error: 'A page cannot change kind',
    });
  });
});

describe('isValidWindow', () => {
  it('requires the end after the start when both are given', () => {
    expect(isValidWindow('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false);
    expect(isValidWindow('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(true);
    expect(isValidWindow(undefined, '2026-01-02T00:00:00Z')).toBe(true);
  });
});
