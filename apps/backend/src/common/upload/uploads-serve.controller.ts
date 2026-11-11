// Fallback GET route for /api/uploads/<file>. The static middleware in
// main.ts serves whatever this container still has on disk and calls next()
// on a miss, which lands here. On hosts with object storage configured
// (see object-storage.ts) this streams the image from the bucket, so
// URLs saved in the database keep resolving after a cold start wipes the
// local disk (Render free tier wake, serverless invocation, redeploy).
//
// The filename shape is validated before touching storage — this path is
// publicly reachable from <img> tags, so it must never behave like a
// directory lookup.

import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { extname } from 'node:path';
import { fetchStoredImage } from './object-storage';

// Same extensions image-upload.config.ts's fileFilter accepts.
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

@Controller('uploads')
export class UploadsServeController {
  @Get(':file')
  async serve(@Param('file') file: string, @Res() res: Response): Promise<void> {
    // image-upload.config.ts only ever writes `${randomUUID()}${ext}` —
    // a 36-char hex/hyphen uuid plus a whitelisted extension. Anything else
    // was never written by this app (also rejects path traversal, which the
    // uuid shape can't express in the first place).
    const ext = extname(file).toLowerCase();
    const isUploadShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$/i.test(
      file,
    );
    if (!isUploadShape || !EXT_MIME[ext]) {
      throw new NotFoundException();
    }

    const stream = await fetchStoredImage(file);
    if (!stream) {
      throw new NotFoundException();
    }

    // Uploaded files are immutable (random names, never overwritten — see
    // image-upload.config.ts), so cache aggressively at the browser/CDN.
    res.setHeader('Content-Type', EXT_MIME[ext]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    stream.pipe(res);
  }
}
