/**
 * Upload validation — pure. The client's claimed MIME type and file name are
 * NEVER trusted: the type is decided from the file's own magic bytes, so a
 * renamed .exe / .html cannot be stored as a "PDF" and later served inline.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Absolute ceiling for any single upload. Per-purpose limits may be lower — see upload-policy.ts. */
export const MAX_ANY_FILE_BYTES = 5 * 1024 * 1024;
export type AllowedMime =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/svg+xml'
  | 'application/msword'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Real type from the bytes. SVG is text, so it is only recognised when the
 * caller explicitly allows it (operator logos) — never for compliance papers.
 */
export function sniffMime(buf: Uint8Array, opts: { allowSvg?: boolean } = {}): AllowedMime | null {
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'image/webp'; // RIFF....WEBP
  // Legacy Word .doc — OLE compound file header.
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  )
    return 'application/msword';
  // .docx is a ZIP; only accept it when it really is a Word package.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const text = Buffer.from(buf).toString('latin1');
    if (text.includes('[Content_Types].xml') && text.includes('word/')) return DOCX;
    return null; // any other ZIP (xlsx, apk, jar...) is refused
  }
  if (opts.allowSvg) {
    const head = Buffer.from(buf.slice(0, 1024))
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
      return 'image/svg+xml';
  }
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  )
    return 'application/pdf'; // %PDF-
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return 'image/png';
  return null;
}

/** Accepts raw base64 or a data: URL. Returns the bytes or an error. */
export function decodeBase64Upload(
  input: string,
): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (!input || typeof input !== 'string') return { ok: false, error: 'File content is required' };
  const b64 = input.startsWith('data:') ? input.slice(input.indexOf(',') + 1) : input;
  const clean = b64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean))
    return { ok: false, error: 'File content is not valid base64' };
  // Reject before decoding if it cannot possibly fit (base64 is 4/3 the size).
  if (Math.floor((clean.length * 3) / 4) > MAX_FILE_BYTES + 3)
    return { ok: false, error: 'File is larger than 5 MB' };
  const bytes = Buffer.from(clean, 'base64');
  if (bytes.length === 0) return { ok: false, error: 'File is empty' };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: 'File is larger than 5 MB' };
  return { ok: true, bytes };
}

/** Safe for a Content-Disposition header and for display: no paths, no control chars, bounded length. */
export function safeFileName(name: string | undefined, mime: AllowedMime): string {
  const ext = EXTENSION[mime];
  const base =
    (name ?? 'document')
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]*$/, '')
      .replace(/[^a-zA-Z0-9 _()-]/g, '_')
      .replace(/_+/g, '_')
      .trim()
      .slice(0, 80) || 'document';
  return `${base}.${ext}`;
}

/**
 * SVG can carry script. Logos are served from our CDN domain, so a hostile
 * SVG must be refused outright (not "cleaned" — a sanitiser that misses one
 * vector is worse than a clear rejection). Returns an error or null.
 */
export function checkSvgSafety(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  const lower = text.toLowerCase();
  if (!/<svg[\s>]/i.test(text)) return 'Not an SVG file';
  if (/<script[\s>]/i.test(text)) return 'SVG logos may not contain scripts';
  if (/<foreignobject[\s>]/i.test(text)) return 'SVG logos may not embed HTML (foreignObject)';
  if (/\son[a-z]+\s*=/i.test(text))
    return 'SVG logos may not contain event handlers (on…= attributes)';
  if (
    /(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript|data:text\/html)/i.test(text) ||
    lower.includes('javascript:')
  )
    return 'SVG logos may not contain script links';
  if (/<!entity/i.test(text)) return 'SVG logos may not declare XML entities';
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//i.test(text))
    return 'SVG logos must be self-contained (no external links/images)';
  if (/<(?:iframe|embed|object|audio|video)[\s>]/i.test(text))
    return 'SVG logos may not embed media or frames';
  return null;
}

export const EXTENSION: Record<AllowedMime, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/msword': 'doc',
  [DOCX]: 'docx',
};

/**
 * Word files can carry macros. A .docx whose package contains vbaProject.bin
 * (i.e. a renamed .docm) is refused; legacy .doc macros can't be detected
 * cheaply, so .doc is only accepted for private documents never rendered in
 * a browser (they are always served as a download).
 */
export function checkWordSafety(buf: Buffer, mime: AllowedMime): string | null {
  if (mime !== DOCX) return null;
  const text = buf.toString('latin1');
  if (text.includes('vbaProject.bin') || text.includes('vbaData.xml'))
    return 'Word files with macros are not allowed — save it as a normal .docx or PDF';
  return null;
}

/**
 * Video uploads are not supported anywhere on the platform. Recognised only
 * so the user gets a clear "videos are not allowed" instead of a generic
 * type error. (MP4/MOV/3GP: 'ftyp' box at offset 4, excluding still-image
 * brands; WebM/MKV: EBML header; AVI: RIFF....AVI.)
 */
export function looksLikeVideo(buf: Uint8Array): boolean {
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = Buffer.from(buf.slice(8, 12)).toString('latin1');
    return !/^(heic|heix|heim|heis|mif1|msf1|avif|avis)$/.test(brand);
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)
    return true;
  if (
    buf.length >= 12 &&
    Buffer.from(buf.slice(0, 4)).toString('latin1') === 'RIFF' &&
    Buffer.from(buf.slice(8, 11)).toString('latin1') === 'AVI'
  )
    return true;
  return false;
}
