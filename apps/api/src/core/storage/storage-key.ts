import { BadRequestException } from '@nestjs/common';

/**
 * A storage key that is safe to read.
 *
 * Keys are random paths chosen at upload, so a malformed one means somebody is trying it on.
 * Checked rather than trusted: without this, `../../` in the path would read anything the
 * process can.
 *
 * In core rather than in a module because two modules now serve images from the same tree —
 * meeting notes and whiteboards — and a module may not import another module's controller.
 * Copying it would be worse than moving it: a path-traversal guard that exists twice is a
 * guard that gets fixed once.
 */
export function safeStorageKey(key: string | string[]): string {
  const joined = Array.isArray(key) ? key.join('/') : key;
  const decoded = decodeURIComponent(joined);
  if (!decoded || decoded.includes('..') || decoded.startsWith('/') || decoded.includes('\\')) {
    throw new BadRequestException('Bad image key');
  }
  return decoded;
}

/**
 * What to serve a stored file as.
 *
 * From the extension we chose at upload, never from anything the uploader supplied, and
 * falling back to a type no browser will execute.
 */
export function mimeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext ?? ''] ?? 'application/octet-stream'
  );
}

/**
 * Headers for serving user-uploaded image bytes.
 *
 * These were written for meeting-note images and the reasoning applies identically to boards,
 * so they live in one place: the bytes were uploaded by anybody who can write, an SVG served
 * inline can carry script, and a mislabelled file must not be reinterpreted as one. The CSP
 * denies the document everything and `nosniff` closes the reinterpretation.
 */
export function imageResponseHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': mimeFromKey(key),
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    // A leaked URL a crawler has indexed is a worse problem than a leaked URL.
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
