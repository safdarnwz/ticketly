import { describe, expect, it } from 'vitest';

import { checkWordSafety, looksLikeVideo, sniffMime } from '../domain/file-validation';
import { UPLOAD_POLICIES, allowedLabel, checkSize, policyFor } from '../domain/upload-policy';

const MB = 1024 * 1024;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(20)]);
const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ', 'latin1'), Buffer.alloc(8)]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(8)]);
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('\x9fB\x86\x81\x01B\x82\x84webm', 'latin1')]);
const avi = Buffer.from('RIFF\x00\x00\x00\x00AVI LIST', 'latin1');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const docx = Buffer.from('PK\x03\x04....[Content_Types].xml....word/document.xml', 'latin1');
const docm = Buffer.from('PK\x03\x04....[Content_Types].xml....word/document.xml....word/vbaProject.bin', 'latin1');
const xlsx = Buffer.from('PK\x03\x04....[Content_Types].xml....xl/workbook.xml', 'latin1');
const apk = Buffer.from('PK\x03\x04....AndroidManifest.xml', 'latin1');

describe('videos are not accepted anywhere', () => {
  it('video files are recognised (for a clear error) but never an allowed type', () => {
    for (const v of [mp4, mov, webm, avi]) {
      expect(looksLikeVideo(v)).toBe(true);
      expect(sniffMime(v)).toBeNull();
    }
  });
  it('HEIC photos and normal images are not mistaken for video', () => {
    expect(looksLikeVideo(heic)).toBe(false);
    expect(looksLikeVideo(jpg)).toBe(false);
  });
  it('no upload purpose allows a video type', () => {
    for (const p of Object.values(UPLOAD_POLICIES)) {
      expect((p.allowed as readonly string[]).some((m) => m.startsWith('video/'))).toBe(false);
    }
    expect(policyFor('vehicle_video')).toBeNull();
  });
});

describe('type detection from bytes', () => {
  it('Word: .doc and .docx; other ZIPs (xlsx, apk) refused', () => {
    expect(sniffMime(doc)).toBe('application/msword');
    expect(sniffMime(docx)).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(sniffMime(xlsx)).toBeNull();
    expect(sniffMime(apk)).toBeNull();
  });
  it('macro-enabled Word refused', () => {
    expect(checkWordSafety(docm, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).not.toBeNull();
    expect(checkWordSafety(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBeNull();
  });
});

describe('upload policies', () => {
  it('bus photos: images only, 5 MB', () => {
    const p = policyFor('vehicle_photo')!;
    expect(allowedLabel(p)).toBe('JPG, PNG, WEBP');
    expect(checkSize(p, 5 * MB)).toBeNull();
    expect(checkSize(p, 5 * MB + 1)).toMatch(/5 MB or smaller/);
  });
  it('documents accept PDF, images and Word, private', () => {
    const p = UPLOAD_POLICIES.vehicle_document;
    expect(p.allowed).toContain('application/pdf');
    expect(p.allowed).toContain('application/msword');
    expect(checkSize(p, 5 * MB + 1)).not.toBeNull();
    expect(p.visibility).toBe('private');
  });
  it('logo allows SVG, public, 2 MB', () => {
    const p = policyFor('tenant_logo')!;
    expect(p.allowSvg).toBe(true);
    expect(checkSize(p, 2 * MB + 1)).not.toBeNull();
  });
  it('unknown purpose and empty file rejected', () => {
    expect(policyFor('anything')).toBeNull();
    expect(checkSize(UPLOAD_POLICIES.cms_banner, 0)).toMatch(/empty/);
  });
});
