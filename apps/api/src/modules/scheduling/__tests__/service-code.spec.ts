import { describe, expect, it } from 'vitest';

import {
  allocateServiceCode,
  normaliseServiceCode,
  SERVICE_CODE_PATTERN,
  serviceCodeBase,
  type CodeHolder,
} from '../domain/service-code';

/** DEL-PAT-1500: route cities + departure time; -A / -B when two leave together. */
describe('service codes', () => {
  const base = 'DEL-PAT-2130';
  const holder = (code: string, over: Partial<CodeHolder> = {}): CodeHolder => ({
    id: code,
    code,
    live: true,
    sameSlot: true,
    ...over,
  });

  it('builds the base from city codes and the 24-hour time', () => {
    expect(serviceCodeBase('DEL', 'PAT', 15 * 60)).toBe('DEL-PAT-1500');
    expect(serviceCodeBase('DEL', 'PAT', 21 * 60 + 30)).toBe('DEL-PAT-2130');
    expect(serviceCodeBase('JAI', 'DEL', 5)).toBe('JAI-DEL-0005');
  });

  it('the first service at a time gets the plain code', () => {
    expect(allocateServiceCode(base, [])).toEqual({ code: base });
  });

  it('a second one at the same time: the first becomes -A, the new one -B', () => {
    expect(allocateServiceCode(base, [holder(base)])).toEqual({
      code: `${base}-B`,
      rename: { id: base, from: base, to: `${base}-A` },
    });
  });

  it('a third is -C, and the plain code is not handed out again while -A/-B run', () => {
    expect(allocateServiceCode(base, [holder(`${base}-A`), holder(`${base}-B`)])).toEqual({
      code: `${base}-C`,
    });
  });

  it('a gap is filled first', () => {
    expect(allocateServiceCode(base, [holder(`${base}-A`), holder(`${base}-C`)])).toEqual({
      code: `${base}-B`,
    });
  });

  it('an ended service keeps its code and is not renamed', () => {
    expect(allocateServiceCode(base, [holder(base, { live: false })])).toEqual({
      code: `${base}-A`,
    });
  });

  it('a service moved to another time keeps its old code; the new one takes a letter', () => {
    expect(allocateServiceCode(base, [holder(base, { sameSlot: false })])).toEqual({
      code: `${base}-A`,
    });
  });

  it('once every same-time service has ended, the plain code is free again', () => {
    expect(allocateServiceCode(base, [holder(`${base}-A`, { live: false })])).toEqual({
      code: base,
    });
  });

  it('all 26 letters taken → no code', () => {
    const all = [base, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) =>
      holder(l === base ? base : `${base}-${l}`),
    );
    expect(allocateServiceCode(base, all)).toBeNull();
  });

  it('an operator-typed code is upper-cased and checked', () => {
    expect(normaliseServiceCode('  del-pat night ')).toBe('DEL-PAT-NIGHT');
    for (const ok of ['DEL-PAT-1500', '101', 'VOLVO-2130-B'])
      expect(SERVICE_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ['A', '-DEL', 'DEL-', 'DEL--PAT', 'DEL_PAT', 'दिल्ली', 'X'.repeat(41)])
      expect(SERVICE_CODE_PATTERN.test(bad)).toBe(false);
  });
});
