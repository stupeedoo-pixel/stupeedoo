# ZiroClips worker: FFmpeg + OpenCV + Whisper/Claude clients.
# Build from the ziroclips/ directory:  docker build -f worker/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# ffmpeg (with libass for captions) + caption fonts + colour emoji font for emoji overlays.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg fonts-montserrat fonts-inter fonts-dejavu-core fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/requirements.txt worker/requirements-local-whisper.txt worker/
RUN pip install -r worker/requirements.txt
# Uncomment for self-hosted transcription (adds ~1 GB; use a CUDA base image for GPUs):
# RUN pip install -r worker/requirements-local-whisper.txt

COPY shared/ shared/
COPY worker/ziro_worker worker/ziro_worker
WORKDIR /app/worker

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"
CMD ["python", "-m", "ziro_worker"]
