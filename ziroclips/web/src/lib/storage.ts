import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

/**
 * Storage abstraction with two drivers:
 *  - local: files on disk (shared volume with the worker). Reads are served by
 *           /api/files/[...key] behind HMAC-signed, expiring URLs.
 *  - s3:    any S3-compatible bucket (Cloudflare R2 recommended: zero egress).
 *
 * Uploads are always chunked so 5–10 GB files work and can be retried per part:
 *  - s3:    browser PUTs straight to presigned multipart part URLs (no server bandwidth).
 *  - local: browser PUTs parts to /api/uploads/[projectId]/parts/[n], which writes
 *           each chunk at its offset into a pre-sized file (no concat step).
 */

export const keys = {
  source: (userId: string, projectId: string, ext: string) => `users/${userId}/projects/${projectId}/source${ext}`,
  logo: (userId: string, ext: string) => `users/${userId}/brand/logo-${Date.now()}${ext}`,
};

// ---------------------------------------------------------------- helpers

function localRoot(): string {
  return path.resolve(process.cwd(), env().STORAGE_LOCAL_DIR);
}

/** Resolve a storage key to an absolute path, refusing path traversal. */
export function localPath(key: string): string {
  const root = localRoot();
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return p;
}

let s3client: S3Client | null = null;
function s3(): S3Client {
  if (!s3client) {
    const e = env();
    s3client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials:
        e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  return s3client;
}
const bucket = () => {
  const b = env().S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not configured");
  return b;
};

function hmac(data: string): string {
  return crypto.createHmac("sha256", env().AUTH_SECRET).update(data).digest("base64url");
}

/** Sign an arbitrary purpose+key for the local driver (constant-time verified). */
export function signToken(purpose: string, key: string, expiresAt: number): string {
  return hmac(`${purpose}\n${key}\n${expiresAt}`);
}
export function verifyToken(purpose: string, key: string, expiresAt: number, sig: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signToken(purpose, key, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------- reads

export async function signedReadUrl(key: string, opts: { downloadName?: string; ttlSec?: number } = {}): Promise<string> {
  const e = env();
  const ttl = opts.ttlSec ?? e.SIGNED_URL_TTL_SEC;
  if (e.STORAGE_DRIVER === "s3") {
    return getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        ResponseContentDisposition: opts.downloadName ? `attachment; filename="${opts.downloadName}"` : undefined,
      }),
      { expiresIn: ttl },
    );
  }
  // Round expiry up to a 5-minute bucket so URLs are stable between polls
  // (lets the browser cache video/thumbnail responses).
  const exp = Math.ceil((Date.now() / 1000 + ttl) / 300) * 300;
  const params = new URLSearchParams({ exp: String(exp), sig: signToken("read", key, exp) });
  if (opts.downloadName) params.set("dl", opts.downloadName);
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}?${params}`;
}

export async function signedReadUrlOrNull(key: string | null | undefined, opts?: { downloadName?: string }) {
  return key ? signedReadUrl(key, opts) : null;
}

// ---------------------------------------------------------------- writes

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (env().STORAGE_DRIVER === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const p = localPath(key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, body);
}

export async function deleteObject(key: string): Promise<void> {
  if (env().STORAGE_DRIVER === "s3") {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    return;
  }
  await fsp.rm(localPath(key), { force: true });
}

/** Delete everything under a prefix (e.g. a whole project). */
export async function deletePrefix(prefix: string): Promise<void> {
  if (env().STORAGE_DRIVER === "s3") {
    let token: string | undefined;
    do {
      const list = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
      const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length) await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    return;
  }
  await fsp.rm(localPath(prefix.replace(/\/$/, "")), { recursive: true, force: true });
}

// ---------------------------------------------------------------- chunked uploads

export interface UploadPlan {
  uploadId: string;
  partSize: number;
  partCount: number;
}

export async function startUpload(key: string, size: number, contentType: string): Promise<UploadPlan> {
  const e = env();
  // S3 allows max 10k parts; grow the part size for huge files.
  const partSize = Math.max(e.UPLOAD_PART_BYTES, Math.ceil(size / 9000));
  const partCount = Math.max(1, Math.ceil(size / partSize));
  if (e.STORAGE_DRIVER === "s3") {
    const res = await s3().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }));
    return { uploadId: res.UploadId!, partSize, partCount };
  }
  const p = localPath(key);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const fh = await fsp.open(p, "w");
  await fh.truncate(size); // pre-size so parts can be written at their offsets in any order
  await fh.close();
  return { uploadId: `local-${crypto.randomUUID()}`, partSize, partCount };
}

export async function partUploadUrls(
  projectId: string,
  key: string,
  uploadId: string,
  partNumbers: number[],
): Promise<Record<number, string>> {
  const e = env();
  const out: Record<number, string> = {};
  if (e.STORAGE_DRIVER === "s3") {
    await Promise.all(
      partNumbers.map(async (n) => {
        out[n] = await getSignedUrl(s3(), new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: n }), {
          expiresIn: 6 * 3600,
        });
      }),
    );
    return out;
  }
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  for (const n of partNumbers) {
    const sig = signToken("upload", `${projectId}:${uploadId}:${n}`, exp);
    out[n] = `/api/uploads/${projectId}/parts/${n}?exp=${exp}&sig=${sig}`;
  }
  return out;
}

/** Local driver: write one chunk at its offset. Returns a pseudo-ETag. */
export async function writeLocalPart(key: string, offset: number, body: ReadableStream<Uint8Array>): Promise<{ etag: string; bytes: number }> {
  const p = localPath(key);
  const fh = await fsp.open(p, "r+");
  const hash = crypto.createHash("md5");
  let pos = offset;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await fh.write(value, 0, value.length, pos);
      hash.update(value);
      pos += value.length;
    }
  } finally {
    await fh.close();
  }
  return { etag: `"${hash.digest("hex")}"`, bytes: pos - offset };
}

export async function completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  if (env().STORAGE_DRIVER === "s3") {
    await s3().send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket(),
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }
  // local: nothing to do — parts were written in place.
}

export async function abortUpload(key: string, uploadId: string) {
  if (env().STORAGE_DRIVER === "s3") {
    await s3().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId })).catch(() => {});
  } else {
    await deleteObject(key).catch(() => {});
  }
}

export function localFileStat(key: string) {
  return fs.statSync(localPath(key), { throwIfNoEntry: false });
}
