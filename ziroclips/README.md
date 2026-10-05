# ZiroClips

**Turn long videos into viral shorts — automatically.** Upload a podcast, stream or talk (or paste a YouTube URL). ZiroClips transcribes it, finds the most engaging self-contained moments, reframes them to 9:16 around the speaker, adds animated word-by-word captions, scores each clip's viral potential, and gives you a browser editor plus 1080p/4K export.

> Personal tool first, SaaS-ready later: multi-user auth, plan limits, a usage ledger and an admin panel are already built in.

```
ziroclips/
├── web/        Next.js 15 app: UI, auth, REST API, upload, job producer
├── worker/     Python worker: FFmpeg, Whisper, Claude, OpenCV face tracking, rendering
├── shared/     caption-templates.json, used by both (so preview == export)
├── docs/       ARCHITECTURE.md: architecture, API reference, costs, roadmap
├── docker-compose.yml
└── .env.example
```

---

## What works today

| Area | Status |
|---|---|
| Upload | Drag & drop MP4/MOV/WebM/MKV up to 10 GB, **chunked + retried** (direct-to-R2/S3 multipart, or to local disk) |
| YouTube import | yt-dlp, public/unlisted only, no live or age-restricted videos, user must confirm they have rights |
| Transcription | OpenAI Whisper API, **any OpenAI-compatible Whisper** (e.g. Groq large-v3-turbo), self-hosted **faster-whisper large-v3**, or `mock` for offline dev |
| Highlight detection | Claude reads numbered transcript segments and returns segment ranges, so clips **never start or end mid-sentence**. Offline heuristic fallback |
| Virality Score | 0–100 from hook, completeness, engagement, emotion and pacing (model) plus measured words/sec, opening loudness and duration |
| AI Reframe | OpenCV face tracking → smoothed "virtual camera" with a dead zone and hard cuts on speaker switches. Falls back to a centre crop |
| Captions | Word-level timing, 4 templates (Bold Modern, Clean Minimal, High Contrast, Emoji Pop), pop/highlight animation, auto emoji |
| Editor | Live 9:16 / 1:1 / 4:5 / 16:9 preview, trim (including extending into surrounding footage), split, merge, drag to reorder, caption styling, word fixes, draggable text/emoji/B-roll placeholders, autosave, keyboard shortcuts |
| Export | 1080p / 4K MP4 with burned-in captions, overlays, brand logo, −14 LUFS loudness; single or batch |
| Accounts | Email/password + Google OAuth, single-user mode (first account = admin), plan limits, monthly usage, admin panel |
| Ops | Postgres job queue with retries, backoff and stale-job recovery; health endpoints; temp-file cleanup; retention janitor; rate limits |

---

## Quick start (local, about 10 minutes)

### Prerequisites
- Node.js 20+ and npm
- Python 3.11+
- **FFmpeg** with libass (`ffmpeg -filters | grep ass`). macOS: `brew install ffmpeg`. Ubuntu: `apt install ffmpeg`
- PostgreSQL 14+ (or just run `docker compose up postgres`)
- Optional caption fonts for exports: Montserrat, Inter and Noto Color Emoji (`apt install fonts-montserrat fonts-inter fonts-noto-color-emoji`), or drop TTFs into `worker/fonts/`

### 1. Configure
```bash
cd ziroclips
cp .env.example .env            # then edit: AUTH_SECRET, API keys
ln -s ../.env web/.env          # the web app reads web/.env; the worker reads ziroclips/.env
openssl rand -base64 32         # paste as AUTH_SECRET
```

**Zero-cost trial with no API keys:** set `TRANSCRIBE_PROVIDER=mock` and `LLM_PROVIDER=heuristic`. The whole pipeline (upload → clips → editor → export) runs, but captions are placeholder words.

### 2. Database
```bash
docker compose up -d postgres   # or point DATABASE_URL at your own Postgres
cd web && npm install && npx prisma migrate deploy
```

### 3. Run the web app
```bash
npm run dev                     # http://localhost:3000
```

### 4. Run the worker (second terminal)
```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# optional local transcription: pip install -r requirements-local-whisper.txt
python -m ziro_worker           # health: http://localhost:8000/health
```

### 5. Use it
Open http://localhost:3000 and **register**. In single-user mode the first account becomes **ADMIN** on the **UNLIMITED** plan. Then set `ALLOW_REGISTRATION=false` to lock the instance. Upload a video and watch it process.

### Or everything in Docker
```bash
cp .env.example .env   # add keys
docker compose up --build        # web :3000, worker :8000, postgres :5432
docker compose up --scale worker=3   # more parallel processing
```

---

## API keys and where to get them

| Variable | Needed for | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI highlight picks, titles, hooks, scoring (`LLM_PROVIDER=anthropic`) | https://console.anthropic.com |
| `OPENAI_API_KEY` | Whisper transcription (`TRANSCRIBE_PROVIDER=openai`) | https://platform.openai.com. Or a **Groq** key with `OPENAI_BASE_URL=https://api.groq.com/openai/v1` and `OPENAI_TRANSCRIBE_MODEL=whisper-large-v3-turbo` |
| `AUTH_GOOGLE_ID/SECRET` | Google sign-in (optional) | Google Cloud Console → OAuth client. Redirect URI `{APP_URL}/api/auth/callback/google` |
| `S3_*` | Cloud storage (optional) | Cloudflare R2 (recommended: zero egress fees) or AWS S3 |

The default LLM is `claude-sonnet-5-5` (`LLM_MODEL`, `LLM_EFFORT`). Requests use structured JSON output, prompt caching on the transcript, and server-side refusal fallback. If the LLM call fails for any reason, the worker falls back to the heuristic picker instead of failing the job.

### Using R2 / S3
Set `STORAGE_DRIVER=s3` and the `S3_*` vars. The browser uploads parts **directly to the bucket**, so the bucket needs CORS:
```json
[{ "AllowedOrigins": ["https://your-app.com", "http://localhost:3000"],
   "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["*"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```
Exports read the source through presigned URLs with HTTP range requests, so FFmpeg only pulls the seconds it needs.

---

## Deploying

| Piece | Suggested host | Notes |
|---|---|---|
| web | **Vercel** or Railway/Render/Fly | On Vercel you **must** use `STORAGE_DRIVER=s3`, because serverless has no shared disk. Set `REDIS_URL` (Upstash) for shared rate limits |
| worker | **Railway / Render / Fly.io** (CPU), **Modal / RunPod** for GPU faster-whisper | Long-running process. Scale by adding instances; they coordinate through Postgres `SKIP LOCKED`. 2–4 vCPU / 4 GB RAM per instance is comfortable |
| Postgres | Neon, Supabase, Railway | |
| Storage | Cloudflare R2 | |

Cheapest "personal" setup: one small VPS (Hetzner/DO) running `docker compose up` with local storage.

---

## Tests
```bash
cd worker && pytest -q          # unit tests + full DB end-to-end (process → export) with offline providers
cd web && npm run typecheck && npm run lint && npm run build
```
The end-to-end test needs Postgres with the schema applied (`DATABASE_URL`, default `localhost:5433/ziroclips`). It skips if the database is unreachable.

---

## Naming

"ZiroClips" works. If you want something more brandable before promoting it, a few ideas (check domain and trademark availability): **Clipwise**, **Hookcut**, **Shortsmith**, **ViralForge**, **Reelcraft**. The name lives in one place, `web/src/lib/brand.ts`.

## More
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: architecture, data model, full API reference, pipeline details, **cost optimisation**, **Phase 2 roadmap**, and known limitations.

> ⚖️ Only process content you own or have rights to. YouTube import may violate YouTube's Terms of Service for content you don't own; disable it with `ENABLE_YOUTUBE=false`.
