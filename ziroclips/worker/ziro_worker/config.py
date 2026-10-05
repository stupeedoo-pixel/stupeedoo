"""Environment-driven worker configuration.

Every expensive component has a cheap/offline alternative so the same code can
run as a free personal tool or a scaled SaaS worker:

  TRANSCRIBE_PROVIDER = openai | faster_whisper | mock
  LLM_PROVIDER        = anthropic | heuristic
  STORAGE_DRIVER      = local | s3
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # ziroclips/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / "worker" / ".env"), extra="ignore")

    database_url: str
    worker_id: str = ""
    worker_concurrency: int = 1          # jobs processed in parallel by this process
    poll_interval_sec: float = 2.0
    heartbeat_stale_sec: int = 300       # RUNNING jobs without heartbeat for this long are requeued
    tmp_dir: str = ""                    # defaults to system temp
    log_level: str = "INFO"
    log_json: bool = False

    # --- storage (must match the web app)
    storage_driver: Literal["local", "s3"] = "local"
    storage_local_dir: str = str(ROOT / "storage")
    s3_bucket: str | None = None
    s3_region: str = "auto"
    s3_endpoint: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    # --- transcription
    transcribe_provider: Literal["openai", "faster_whisper", "mock"] = "openai"
    openai_api_key: str | None = None
    # Point at any OpenAI-compatible endpoint, e.g. Groq (https://api.groq.com/openai/v1,
    # model whisper-large-v3-turbo) for ~5-10x cheaper Whisper large-v3.
    openai_base_url: str | None = None
    openai_transcribe_model: str = "whisper-1"
    transcribe_chunk_sec: int = 600       # split long audio; each chunk is transcribed in parallel
    transcribe_parallelism: int = 4
    whisper_model: str = "large-v3"       # faster_whisper model size/name
    whisper_device: str = "auto"          # auto | cpu | cuda
    whisper_compute_type: str = "auto"    # auto | int8 | float16 ...

    # --- highlight detection / scoring
    llm_provider: Literal["anthropic", "heuristic"] = "anthropic"
    anthropic_api_key: str | None = None
    llm_model: str = "claude-sonnet-5-5"
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"

    # --- media
    proxy_height: int = 540               # editor preview proxy resolution
    face_sample_fps: float = 3.0
    reframe_parallelism: int = 4
    ffmpeg_threads: int = 0               # 0 = ffmpeg default
    export_preset: str = "medium"         # x264 preset for final exports
    export_crf: int = 20
    fonts_dir: str = str(ROOT / "worker" / "fonts")

    # --- youtube
    enable_youtube: bool = True
    youtube_max_height: int = 1080
    youtube_cookies_file: str | None = None

    # --- limits & retention
    max_video_minutes: int = 240
    export_ttl_days: int = 14             # janitor deletes rendered MP4s after this
    source_ttl_days: int = 0              # 0 = keep originals forever; >0 deletes source (keeps proxy)

    @property
    def captions_templates_path(self) -> Path:
        return ROOT / "shared" / "caption-templates.json"


@lru_cache
def settings() -> Settings:
    s = Settings()  # type: ignore[call-arg]
    if not s.worker_id:
        import os
        import socket

        s.worker_id = f"{socket.gethostname()}-{os.getpid()}"
    # Relative paths are relative to the repo root (same as the web app's default "../storage").
    if not Path(s.storage_local_dir).is_absolute():
        s.storage_local_dir = str((ROOT / "web" / s.storage_local_dir).resolve())
    return s
