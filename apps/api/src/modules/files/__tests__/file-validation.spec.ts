import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES, decodeBase64Upload, safeFileName, sniffMime } from '../domain/file-validation';

const pdf = Buffer.from('%PDF-1.4\n%test', 'latin1');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe('file validation', () => {
  it('detects type from magic bytes, not the name', () => {
    expect(sniffMime(pdf)).toBe('application/pdf');
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(jpg)).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('MZ\x90\x00', 'latin1'))).toBeNull(); // .exe renamed to .pdf
    expect(sniffMime(Buffer.from('<html><script>'))).toBeNull();
  });
  it('decodes base64 and data URLs', () => {
    expect(decodeBase64Upload(`data:application/pdf;base64,${pdf.toString('base64')}`).ok).toBe(true);
    expect(decodeBase64Upload(pdf.toString('base64')).ok).toBe(true);
  });
  it('rejects empty, invalid and oversized content', () => {
    expect(decodeBase64Upload('').ok).toBe(false);
    expect(decodeBase64Upload('not base64 !!!').ok).toBe(false);
    expect(decodeBase64Upload(Buffer.alloc(MAX_FILE_BYTES + 1, 1).toString('base64')).ok).toBe(false);
  });
  it('sanitises file names (no path traversal, no header injection, forced extension)', () => {
    expect(safeFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(safeFileName('RC copy (front).jpeg', 'image/jpeg')).toBe('RC copy (front).jpg');
    expect(safeFileName('evil"\r\nX-Header: 1.pdf', 'application/pdf')).toMatch(/^evil_[^"\r\n]*\.pdf$/);
    expect(safeFileName(undefined, 'image/png')).toBe('document.png');
  });
});
