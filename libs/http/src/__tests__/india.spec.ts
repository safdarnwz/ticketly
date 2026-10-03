import { describe, expect, it } from 'vitest';

import {
  ifscBankName,
  ifscSchema,
  isKnownIfsc,
  lookupPincode,
  pincodeSchema,
} from '../dto/india.dto';

describe('PIN codes', () => {
  it('a known PIN gives its city, state and localities', () => {
    const jaipur = lookupPincode('302001')!;
    expect(jaipur).toMatchObject({ pincode: '302001', city: 'Jaipur', state: 'Rajasthan' });
    expect(jaipur.localities.length).toBeGreaterThan(0);
    // Post-office kinds and brackets are trimmed: "Ashok Nagar S.O (Jaipur)" → "Ashok Nagar".
    expect(jaipur.localities).toContain('Ashok Nagar');
    expect(lookupPincode('110006')).toMatchObject({ state: 'Delhi' });
  });

  it('a PIN that does not exist, or is not a PIN, gives nothing', () => {
    expect(lookupPincode('999999')).toBeNull();
    expect(lookupPincode('012345')).toBeNull();
    expect(lookupPincode('30200')).toBeNull();
    expect(lookupPincode('abcdef')).toBeNull();
  });

  it('the schema accepts only PINs that exist', () => {
    expect(pincodeSchema.safeParse(' 560001 ').success).toBe(true);
    expect(pincodeSchema.safeParse('999999').success).toBe(false);
    expect(pincodeSchema.safeParse('012345').success).toBe(false);
  });
});

describe('IFSCs', () => {
  it('a branch in the RBI list is known; its bank is named', () => {
    expect(isKnownIfsc('HDFC0000123')).toBe(true);
    expect(isKnownIfsc('sbin0000691')).toBe(true);
    expect(ifscBankName('HDFC0000123')).toBe('HDFC Bank');
    expect(ifscBankName('SBIN0000691')).toBe('State Bank of India');
  });

  it('a wrong shape, an unknown bank or an unknown branch is not', () => {
    expect(isKnownIfsc('HDFC123')).toBe(false);
    expect(isKnownIfsc('HDFC1000123')).toBe(false); // 5th character must be 0
    expect(isKnownIfsc('XXXX0000001')).toBe(false);
    expect(isKnownIfsc('HDFC0ZZZZZZ')).toBe(false);
  });

  it('the schema upper-cases and refuses unknown branches', () => {
    expect(ifscSchema.parse(' hdfc0000123 ')).toBe('HDFC0000123');
    expect(ifscSchema.safeParse('XXXX0000001').success).toBe(false);
    expect(ifscSchema.safeParse('HDFC123').success).toBe(false);
  });
});
