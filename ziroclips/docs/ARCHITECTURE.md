# ZiroClips architecture

## 1. Final tech stack (and where it differs from the brief)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn-style components (Radix) + Framer Motion | As requested |
| API | Next.js route handlers (REST, Zod-validated) | As requested |
| Heavy processing | **Python worker** (FFmpeg, OpenCV, Whisper, Claude) with a FastAPI health endpoint | Python has the best media/ML ecosystem, so this isn't pure Node |
| Database | PostgreSQL + Prisma | As requested |
| Job queue | **Postgres table + `FOR UPDATE SKIP LOCKED`** instead of BullMQ/Redis | **Changed.** BullMQ is Node-only, and the consumer is Python. A Postgres queue is transactional with the rows it touches (project + job created atomically), needs no extra service in personal mode, and scales fine to thousands of jobs per hour. Redis stays optional, used only for shared rate limits. |
| Transcription | OpenAI Whisper API, any OpenAI-compatible Whisper (Groq), or self-hosted faster-whisper large-v3 | Env switch |
| AI analysis | Claude (`claude-sonnet-5-5` by default) with structured JSON output | Env switch, with heuristic fallback |
| Storage | Local disk or S3-compatible (R2 recommended) | Env switch |
| Auth | Auth.js v5: Credentials (bcrypt) + Google, JWT sessions | Magic link is on the roadmap |
| Editor preview | **Client-side rendering over a low-res proxy** | **Design decision.** The worker makes one 540p H.264 proxy of the whole source. The editor applies the reframe (CSS transform from the face-track keyframes), captions (HTML) and overlays in the browser, so trims, style changes and aspect-ratio switches preview instantly with no server render. Export reproduces the same geometry in FFmpeg/libass from the same data and the same `shared/caption-templates.json`. |

## 2. High-level architecture

```
 Browser ──────────────────────────────────────────────────────────────┐
  │  Next.js UI (dashboard, upload, project, editor, settings, admin)  │
  │    · chunked upload ──PUT parts──► R2/S3 presigned  (or /api/uploads/… local)
  │    · polls /api/projects/:id/status every 2s                       │
  │    · editor plays proxy.mp4 + CSS reframe + HTML captions          │
  └───────────────┬────────────────────────────────────────────────────┘
                  │ REST (cookies / JWT session)
        ┌─────────▼──────────┐   INSERT job (same tx as project row)
        │  Next.js API       │──────────────┐
        │  auth · zod · rate │              ▼
        │  limits · signing  │       ┌──────────────┐
        └─────────┬──────────┘       │  PostgreSQL  │◄─── claim (SKIP LOCKED), heartbeat,
                  │                  │ users, projects,   progress, results
                  │ signed URLs      │ clips, jobs,  │
                  ▼                  │ exports, usage│
        ┌────────────────────┐       └──────▲───────┘
        │ Storage (disk/R2)  │◄─────────────┼──────────────┐
        │ source · proxy ·   │              │              │
        │ thumbs · exports · │       ┌──────┴───────────────┴───────┐
        │ logos              │◄─────►│ Python worker(s) ×N          │
        └────────────────────┘       │  ffprobe → audio → Whisper   │──► OpenAI / Groq / local
                                     │  → Claude highlights → score │──► Anthropic API
                                     │  → OpenCV reframe → proxy    │
                                     │  → FFmpeg/libass export      │
                                     │  janitor: stale jobs, TTLs   │
                                     └──────────────────────────────┘
```

**Separation:** the web tier never touches media bytes beyond streaming upload chunks (local driver) or signing URLs. All CPU-heavy work runs in workers, which scale independently and statelessly. Each one claims jobs, writes to a per-job temp dir that is always deleted, and reports progress through the DB.

## 3. Processing pipeline (PROCESS_PROJECT)

| % | Stage | Implementation |
|---|---|---|
| 0–12 | Source | Upload already in storage, or `yt-dlp` (public only, ≤ plan max length) |
| 13 | Probe + quota | `ffprobe`. The **real** duration is checked against plan limits (the browser's estimate is only a pre-check) |
| 13→ | Proxy (background thread) | 540p H.264, 1 s GOP for snappy scrubbing |
| 14–19 | Audio + energy | 16 kHz mono WAV, RMS loudness envelope (0.25 s hop, z-scored) |
| 20–55 | Transcribe | Whisper word timestamps. Long audio is split at the **quietest point** near each 10-minute boundary, and chunks run in parallel (4×). Punctuation is re-attached from the full text |
| 56–64 | Highlights | Transcript → numbered sentence segments → Claude returns `{start_segment, end_segment, title, hook, reasoning, hashtags, scores}`. Snapped to sentence boundaries, clamped to min/max length, with 0.15 s / 0.35 s breathing room, no overlaps |
| 65–90 | Reframe + thumbnails | Per clip in parallel: ffmpeg → 320 px gray frames @ 3 fps → Haar face detection → fill gaps → median filter → dead-zone virtual camera with hard cuts → RDP-simplified keyframes |
| 91–100 | Save | Proxy upload, clips inserted (sorted by score), usage ledger (charged once per project, even on retry) |

**Timing target:** for a 60-minute video, transcription takes about 1–2 minutes via API (parallel chunks), the LLM about 30–60 seconds, face tracking about 2 minutes (4 parallel), and the proxy runs concurrently in about 2–4 minutes. That comes to **roughly 5–8 minutes on 4 vCPUs**. Self-hosted Whisper on CPU is much slower; use a GPU or Groq.

**Virality Score** (`worker/ziro_worker/pipeline/scoring.py`):
`10 × (0.28·hook + 0.22·completeness + 0.22·engagement + 0.14·emotion + 0.14·pacing)`, where pacing blends the model's 0–10 with measured words/sec (peak at 3 wps). Then ±4 for opening loudness (z-score) and +3/−3 for duration (20–60 s sweet spot / >75 s). Clamped to 1–99. The breakdown is stored and shown in the editor.

**Export** (`render.py`): one FFmpeg pass: input seek → `crop` with a piecewise-linear time expression from the keyframes → lanczos scale → `ass` captions/text/B-roll boxes → emoji PNG overlays (Pillow + Noto Color Emoji, since libass can't draw colour glyphs) → logo → H.264 high/CRF 20 → AAC 160k with `loudnorm` at −14 LUFS. Rendered from an **immutable snapshot** taken at export time.

## 4. Data model

See `web/prisma/schema.prisma` (fully commented). Core tables:

- `users` (role, plan) plus Auth.js `accounts`/`sessions`/`verification_tokens`
- `projects`: source/proxy keys, media metadata, status/progress/stage/error, settings (clip count, length range, language, template)
- `transcripts`: word-level timings `[{w,s,e}]`, sentence segments, full text
- `clips`: source range, score + breakdown, **editable words**, crop track, caption style, overlays, aspect ratio, position
- `exports`: resolution, status, output key, **snapshot**
- `jobs`: type, status, payload/result, progress/stage, attempts/backoff, heartbeat, priority
- `brand_kits`: logo, placement, colours, font, default caption style
- `usage_events`: append-only ledger (minutes, videos, clips, exports), which maps directly to Stripe metered billing later

## 5. API reference

All endpoints are JSON and require a session unless noted. Errors look like `{ error: { code, message, details? } }`, where `message` is safe to show the user. 5xx responses include a log reference id.

### Auth
| Method | Path | Body / notes |
|---|---|---|
| POST | `/api/auth/register` | `{ name?, email, password }` (rate-limited per IP; the UI uses an equivalent server action) |
| GET/POST | `/api/auth/*` | Auth.js (credentials, Google, session, sign-out) |

### Projects & upload
| Method | Path | Body / response |
|---|---|---|
| GET | `/api/projects` | → `{ projects: ProjectDTO[] }` |
| POST | `/api/projects` | `{ title?, settings?, source: {type:"upload", fileName, fileSize, contentType, durationSec?} \| {type:"youtube", url, acceptTerms:true} }` → `{ project, upload?: {partSize, partCount} }`. Quota pre-check, 20/h |
| POST | `/api/projects/:id/upload/parts` | `{ partNumbers: number[] }` (≤100) → `{ urls: {n: url} }` |
| PUT | `/api/uploads/:projectId/parts/:n?exp&sig` | Raw chunk body (local driver only, HMAC-signed, no cookie) → `ETag` header |
| POST | `/api/projects/:id/upload/complete` | `{ parts: [{partNumber, etag}] }` → queues processing |
| GET | `/api/projects/:id` | → `{ project, clips, jobs }` |
| PATCH | `/api/projects/:id` | `{ title }` |
| DELETE | `/api/projects/:id` | Deletes rows + all media, cancels jobs |
| GET | `/api/projects/:id/status` | Cheap poll → `{ status, progress, stage, error, clipsVersion, jobs }` |
| POST | `/api/projects/:id/retry` | Re-queue a FAILED project |
| POST | `/api/projects/:id/find-more` | `{ count? = 5 }` → AI looks for new, non-overlapping clips |
| POST | `/api/projects/:id/export-all` | `{ resolution, minScore? }` → batch export |

### Clips & editor
| Method | Path | Body / response |
|---|---|---|
| GET | `/api/projects/:id/clips?sort=score\|position` | → `{ clips }` |
| POST | `/api/projects/:id/clips/reorder` | `{ ids: string[] }` (must include every clip) |
| GET | `/api/clips/:id` | → `{ clip }` |
| PATCH | `/api/clips/:id` | Any of `{ title, startSec, endSec, words, captionStyle, overlays, aspectRatio }`. Trims re-slice words from the transcript for newly exposed ranges and keep manual edits |
| DELETE | `/api/clips/:id` | |
| POST | `/api/clips/:id/split` | `{ at }` (source seconds) → `{ clip }` (second half) |
| POST | `/api/clips/:id/merge-next` | Merge with the next clip in order |
| POST | `/api/clips/:id/regenerate-captions` | Re-transcribe this clip's audio |

### Exports
| Method | Path | Body / response |
|---|---|---|
| GET | `/api/clips/:id/exports` | → `{ exports: ExportDTO[] }` with signed `downloadUrl` |
| POST | `/api/clips/:id/exports` | `{ resolution: "1080p"\|"4k" }` (plan-gated, 60/h) |
| GET | `/api/exports/:id` | Poll one export |

### Files, brand, usage, admin
| Method | Path | Notes |
|---|---|---|
| GET | `/api/files/<key>?exp&sig[&dl]` | Local driver file server: HMAC-signed, expiring, supports HTTP Range |
| GET/PUT | `/api/brand-kit` | Colours, font, logo placement, default caption style, `removeLogo` |
| POST | `/api/brand-kit/logo` | multipart `file` (PNG/JPG/WebP ≤ 5 MB) |
| GET | `/api/usage` | This month's usage vs plan limits |
| GET | `/api/admin/users` | Admin only: users and monthly usage |
| PATCH | `/api/admin/users/:id` | Admin only: `{ plan?, role? }` |
| GET | `/api/health` | No auth: DB + queue depth (queued/running/stale) |
| GET | worker `:8000/health` | Worker threads, current jobs, provider config |

## 6. Security & abuse protection

- **Ownership checks** on every resource. Missing or foreign ids return 404 (not 403) so ids can't be probed.
- **Signed URLs** for all media (S3 presign or HMAC with expiry for local); no public bucket.
- **Rate limits** (fixed window; Redis if configured, otherwise in-memory): registration/login per IP; project creation, exports, find-more and caption regeneration per user.
- **Quota enforcement twice:** a pre-check from the client-reported duration, then the authoritative check after `ffprobe` in the worker.
- **Input validation** with Zod everywhere. Storage keys are path-traversal-safe. Uploads are type- and size-checked. Upload chunk sizes are verified.
- **Retries:** user-facing errors (bad file, quota) fail immediately. Transient errors retry with exponential backoff. Dead workers are detected by heartbeat, and their jobs are re-queued.
- **Cleanup:** per-job temp dirs are always removed. The janitor expires exports (`EXPORT_TTL_DAYS`), optionally purges originals (`SOURCE_TTL_DAYS`, after which exports fall back to the proxy), and deletes abandoned uploads after 24 h.

## 7. Cost optimisation

Rough per **60 minutes of source video** (verify current provider pricing):

| Item | Default | Cheaper options |
|---|---|---|
| Transcription | OpenAI `whisper-1` ≈ **$0.36** | **Groq `whisper-large-v3-turbo`** via `OPENAI_BASE_URL`: about an order of magnitude cheaper and faster. **Self-hosted faster-whisper** costs about $0 per minute (GPU time only; a spot/Modal GPU transcribes an hour in about 1–2 minutes) |
| Highlights (Claude Sonnet 5.5) | ~20k input + ~3k output tokens ≈ **$0.07** | "Find more clips" re-reads the **cached** transcript at about 10% of the input price. `LLM_EFFORT=low` reduces thinking tokens. `LLM_MODEL=claude-haiku-4-5` for bulk/free tier. Batch API (50% off) for non-interactive backfills |
| Compute | ~5–8 vCPU-min per hour of video | Proxy at 540p/CRF 28 with veryfast; face tracking at 320 px/3 fps; `EXPORT_PRESET=veryfast` for drafts |
| Storage | Source (1–4 GB/h) + proxy (~150–250 MB/h) + exports | **Cloudflare R2**: no egress fees, which matters because video is egress-heavy. `SOURCE_TTL_DAYS=7` deletes big originals (the editor and exports keep working from the proxy at lower quality). `EXPORT_TTL_DAYS` expires renders, which are cheap to regenerate. For YouTube imports, cap at `YOUTUBE_MAX_HEIGHT=1080` |
| Bandwidth | | Exports read only the needed byte ranges via presigned URLs. Uploads go browser → bucket directly, never through your server |

**Rule of thumb:** about **$0.45 per hour** of video with OpenAI + Sonnet, about **$0.10–0.15** with Groq + Sonnet, and about **$0.07** with local Whisper. For freemium pricing, cap free users at 60 min/month (at most ~$0.45 of cost each).

More levers:
- Use voice-activity detection (silero/faster-whisper `vad_filter`) to skip silence before paid transcription.
- Cache transcripts by content hash (sha256 of the audio) to avoid re-billing duplicate uploads.
- Route paid-tier jobs to higher `priority` and free-tier jobs to cheaper/slower workers.

## 8. Roadmap (Phase 2+)

Search the code for `ROADMAP` to find each hook.

| Feature | Where it plugs in |
|---|---|
| **Multi-language captions + AI dubbing** | Transcript already stores `language`. Add a `translations` table (clipId, lang, words). Translate with Claude, preserving word timing per caption page. Dubbing: TTS (ElevenLabs) per segment + `atempo` alignment, then mux in `render.py` |
| **Direct social posting** | `Publication` model (see `schema.prisma` comment), OAuth connections for TikTok, YouTube Shorts and IG Reels, a `PUBLISH_CLIP` job type, scheduling via `run_after`. Button stub in the Export panel |
| **Team workspaces** | `Workspace` + `Membership(role)`. Move `userId` → `workspaceId` on projects, brand kits and usage. Plan limits per workspace |
| **Analytics** | Pull views/retention from the platform APIs and regress against the stored `score_breakdown.signals` to learn per-creator virality weights (see `scoring.py`) |
| **Billing** | Stripe Checkout + customer portal on `/settings`. Report `usage_events` as metered usage. Webhook sets `users.plan` |
| **Better reframing** | Active-speaker detection (lip motion / TalkNet), YuNet/MediaPipe detector for profiles, split-screen layout for two-person podcasts, re-track when trims extend beyond the track |
| **Auto B-roll** | Keyword extraction → Pexels/Storyblocks search → replace placeholder boxes with footage in `render.py` |
| **Realtime progress** | Postgres `LISTEN/NOTIFY` → SSE endpoint instead of polling; `NOTIFY` on job insert so workers wake instantly |
| **Magic links** | Auth.js email provider (Resend). `verification_tokens` table already exists |
| **GPU pool** | Route transcription to a GPU worker type (Modal) and keep FFmpeg work on CPU boxes |

## 9. Known limitations

- Face detection uses OpenCV Haar cascades: fast and dependency-free, but weaker on profiles and small faces. With several people on screen it follows the largest face, not the active speaker.
- Caption fonts at export depend on fonts installed in the worker (Docker installs Montserrat, Inter and Noto Color Emoji). Poppins, Bebas Neue, Anton and Roboto preview in the browser via Google Fonts; to export them, drop TTFs in `worker/fonts/` (or libass falls back to a default face).
- The browser preview approximates libass layout (line height and outline thickness differ by a few pixels).
- The local storage driver needs the web app and worker to share a disk (same host or shared volume). Use S3/R2 when running them apart (and always on Vercel).
- The editor proxy is H.264, which Chrome, Safari and Edge play. Some open-source Chromium builds without proprietary codecs can't.
