import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { localPath, verifyToken } from "@/lib/storage";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * GET /api/files/<key>?exp&sig[&dl=name] — LOCAL driver file server.
 * Signed + expiring (like S3 presigned URLs) and supports HTTP Range so video
 * seeking works in the editor.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  if (env().STORAGE_DRIVER !== "local") return new Response("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyToken("read", key, exp, sig)) return new Response("Link expired", { status: 403 });

  let file: string;
  try {
    file = localPath(key);
  } catch {
    return new Response("Bad key", { status: 400 });
  }
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };
  const dl = req.nextUrl.searchParams.get("dl");
  if (dl) headers["content-disposition"] = `attachment; filename="${dl.replace(/[^\w.\- ]/g, "_")}"`;

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "content-length": String(stat.size) } });
}
