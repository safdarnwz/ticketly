import type { FastifyReply } from 'fastify';

/**
 * Send a stored file safely: exact type, nosniff, no caching of KYC/fleet
 * papers by shared caches, and a sandbox CSP so even a hostile PDF opened
 * inline cannot run script against our origin.
 */
export function sendStoredFile(reply: FastifyReply, file: { fileName: string; mimeType: string; content: Buffer }, download = false): void {
  const encoded = encodeURIComponent(file.fileName);
  void reply
    .header('Content-Type', file.mimeType)
    .header('Content-Length', String(file.content.length))
    .header('Content-Disposition', `${download || /msword|officedocument/.test(file.mimeType) ? 'attachment' : 'inline'}; filename="${file.fileName}"; filename*=UTF-8''${encoded}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', reply.getHeader('Cache-Control') ?? 'private, no-store')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .send(file.content);
}
