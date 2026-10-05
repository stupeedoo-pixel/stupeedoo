"use client";
import { api } from "./client";

/**
 * Resumable-ish chunked uploader. Works identically for the local driver and
 * S3/R2 presigned multipart: request signed part URLs in batches, PUT chunks
 * with limited concurrency, retry each chunk with backoff, then complete.
 */
export interface UploadOptions {
  projectId: string;
  file: File;
  partSize: number;
  partCount: number;
  concurrency?: number;
  onProgress?: (fraction: number, bytesPerSec: number) => void;
  signal?: AbortSignal;
}

export async function uploadInParts(o: UploadOptions): Promise<void> {
  const concurrency = o.concurrency ?? 4;
  const loaded = new Map<number, number>();
  const etags: { partNumber: number; etag: string }[] = [];
  const started = performance.now();
  const report = () => {
    const sent = [...loaded.values()].reduce((a, b) => a + b, 0);
    const secs = (performance.now() - started) / 1000;
    o.onProgress?.(sent / o.file.size, secs > 0 ? sent / secs : 0);
  };

  const queue = Array.from({ length: o.partCount }, (_, i) => i + 1);
  const urls = new Map<number, string>();
  async function urlFor(n: number): Promise<string> {
    if (!urls.has(n)) {
      const batch = queue.filter((p) => !urls.has(p) && p >= n).slice(0, 50);
      const res = await api<{ urls: Record<string, string> }>(`/api/projects/${o.projectId}/upload/parts`, { method: "POST", json: { partNumbers: batch } });
      for (const [k, v] of Object.entries(res.urls)) urls.set(Number(k), v);
    }
    return urls.get(n)!;
  }

  async function putPart(n: number): Promise<void> {
    const blob = o.file.slice((n - 1) * o.partSize, Math.min(n * o.partSize, o.file.size));
    for (let attempt = 1; ; attempt++) {
      try {
        const url = await urlFor(n);
        const etag = await xhrPut(url, blob, (b) => {
          loaded.set(n, b);
          report();
        }, o.signal);
        etags.push({ partNumber: n, etag });
        return;
      } catch (err) {
        if (o.signal?.aborted || attempt >= 4) throw err;
        loaded.set(n, 0);
        urls.delete(n); // URL may have expired
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  let next = 0;
  async function workerLoop() {
    while (next < queue.length) {
      const n = queue[next++];
      await putPart(n);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, workerLoop));
  await api(`/api/projects/${o.projectId}/upload/complete`, { method: "POST", json: { parts: etags } });
}

function xhrPut(url: string, body: Blob, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // S3/R2 bucket CORS must expose the ETag header (see README).
        const etag = xhr.getResponseHeader("ETag");
        if (!etag) return reject(new Error("Upload server didn't return an ETag (check bucket CORS ExposeHeaders)."));
        onProgress(body.size);
        resolve(etag);
      } else reject(new Error(`Chunk upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Read duration from the browser so quota checks can happen before uploading GBs. */
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}
