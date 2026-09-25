import { describe, expect, it } from 'vitest';

import { csvField, toCsv } from '../csv';

describe('csv', () => {
  it('quotes only when needed', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });

  it('writes a header and rows in column order, typed cells as-is', () => {
    const csv = toCsv(
      ['name', 'count', 'ok', 'at', 'meta', 'missing'],
      [
        {
          name: 'Ann',
          count: 3,
          ok: true,
          at: new Date('2026-01-01T00:00:00Z'),
          meta: { k: 1 },
          missing: null,
        },
      ],
    );
    expect(csv).toBe(
      'name,count,ok,at,meta,missing\nAnn,3,true,2026-01-01T00:00:00.000Z,"{""k"":1}",',
    );
  });

  it('defuses spreadsheet formulas in text cells', () => {
    expect(toCsv(['v'], [{ v: '=HYPERLINK("x")' }, { v: '+91 98765' }, { v: -5 }])).toBe(
      'v\n"\'=HYPERLINK(""x"")"\n\'+91 98765\n-5',
    );
  });
});
