// Optional off-box image storage. On hosts with an ephemeral filesystem
// (Render free tier containers wake from spin-down with a fresh disk; Vercel
// serverless has no writable disk at all) a menu photo saved only to
// uploadsDir() disappears on the next cold start, leaving every saved
// /api/uploads/<file> URL 404ing. When the SUPABASE_S3_* env vars are set,
// every uploaded image is additionally persisted to a Supabase Storage
// bucket (S3-compatible endpoint; @aws-sdk/client-s3 is already a
// dependency for the backup module) and served back through the SAME
// /api/uploads/<file> URL the app has always used — see
// uploads-serve.controller.ts for the cold-start serving path.
//
// Self-hosted Docker deployments (the README path) don't set these vars and
// keep the original local-volume behavior completely unchanged.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_S3_ENDPOINT &&
      process.env.SUPABASE_S3_ACCESS_KEY_ID &&
      process.env.SUPABASE_S3_SECRET_ACCESS_KEY &&
      process.env.SUPABASE_S3_BUCKET,
  );
}

// Lazily built so a self-hosted deployment that never configures storage
// never constructs a client at all.
let s3: S3Client | null | undefined;
function client(): S3Client | null {
  if (s3 === undefined) {
    s3 = isObjectStorageConfigured()
      ? new S3Client({
          // Supabase's S3 gateway is path-style (bucket in the URL path).
          forcePathStyle: true,
          region: process.env.SUPABASE_S3_REGION ?? 'ap-south-1',
          endpoint: process.env.SUPABASE_S3_ENDPOINT,
          credentials: {
            accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID as string,
            secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY as string,
          },
        })
      : null;
  }
  return s3;
}

// Called from the two upload handlers (menu items, restaurant logo) after
// multer has written the file and its bytes passed the magic-number check.
// A failure here fails the request outright: handing back a URL that will
// 404 after the next cold start is worse than the upload erroring visibly
// and the operator simply re-trying.
export async function persistUploadedImage(
  file: Express.Multer.File,
): Promise<void> {
  const c = client();
  if (!c) return; // self-hosted path: local volume only, exactly as before
  await c.send(
    new PutObjectCommand({
      Bucket: process.env.SUPABASE_S3_BUCKET,
      Key: file.filename,
      Body: createReadStream(file.path),
      ContentType: file.mimetype,
    }),
  );
}

// Serves an image that is no longer (or never was) on this container's
// disk. The static middleware in main.ts serves local files first and
// falls through to the router on a miss, so this only ever sees
// object-storage objects. Returns null when storage isn't configured or the
// object doesn't exist, so the route can 404 normally.
export async function fetchStoredImage(
  filename: string,
): Promise<Readable | null> {
  const c = client();
  if (!c) return null;
  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: process.env.SUPABASE_S3_BUCKET,
        Key: filename,
      }),
    );
    return out.Body as Readable;
  } catch (err) {
    // A missing object is a normal 404. Anything else (bad credentials,
    // bucket gone) would be a real misconfiguration — but images are
    // decorative and this route is hit straight from <img> tags, so it
    // still surfaces as 404 rather than a 500 that looks like an outage.
    // The warn keeps the root cause visible in the service logs.
    console.warn(
      `object-storage: fetch failed for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
