#!/usr/bin/env python3
"""
YouTube Automation Pipeline
Usage: python main.py --topic "..." [options]
"""

import argparse
import json
import sys
import time
from pathlib import Path

from generators import script as script_gen
from generators import voice as voice_gen
from generators import video as video_gen


def parse_args():
    p = argparse.ArgumentParser(description="YouTube video automation pipeline")
    p.add_argument("--topic",    required=True,  help="Video topic")
    p.add_argument("--duration", type=int, default=10, help="Target duration in minutes (default: 10)")
    p.add_argument("--style",    default="educational",
                   choices=["educational", "entertainment", "news", "tutorial", "motivation"])
    p.add_argument("--niche",    default="", help="Target niche (e.g. 'fitness', 'tech')")
    p.add_argument("--keywords", default="", help="Comma-separated SEO keywords")
    p.add_argument("--privacy",  default="private",
                   choices=["private", "unlisted", "public"],
                   help="YouTube privacy setting (default: private)")
    p.add_argument("--upload",   action="store_true", help="Upload to YouTube after assembling")
    p.add_argument("--output",   default="output", help="Output directory base (default: output)")
    return p.parse_args()


def main():
    args = parse_args()
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    job_id = f"{int(time.time())}_{args.topic[:20].replace(' ', '_')}"
    job_dir = Path(args.output) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'─' * 56}")
    print(f"  YouTube Automation Pipeline")
    print(f"  Job: {job_id}")
    print(f"{'─' * 56}\n")

    # ── 1. Script ────────────────────────────────────────────
    print("[ 1/4 ] Generating script via Claude…")
    result = script_gen.generate(
        topic=args.topic,
        duration=args.duration,
        style=args.style,
        niche=args.niche,
        keywords=keywords,
    )
    (job_dir / "script.txt").write_text(result["script"])
    (job_dir / "metadata.json").write_text(
        json.dumps(result["metadata"], indent=2)
    )
    print(f"  Title: {result['metadata'].get('title', '')}")
    print(f"  Scenes: {len(result['metadata'].get('scenes', []))}")

    # ── 2. Voice-over ────────────────────────────────────────
    print("\n[ 2/4 ] Generating voice-over…")
    audio_path = voice_gen.generate(
        text=result["narration"],
        output_path=job_dir / "voiceover.mp3",
    )

    # ── 3. Video assembly ────────────────────────────────────
    scenes = result["metadata"].get("scenes", [])
    if not scenes:
        print("  [warn] No scene breakdown returned — creating single-scene video")
        scenes = [{
            "id": 1,
            "duration_seconds": args.duration * 60,
            "script": result["narration"][:200],
            "visual_description": args.topic,
            "keywords": keywords,
            "music_mood": "upbeat",
        }]

    print(f"\n[ 3/4 ] Assembling video ({len(scenes)} scenes)…")
    video_path = video_gen.assemble(
        scenes=scenes,
        audio_path=audio_path,
        output_dir=job_dir,
    )

    # ── 4. Upload ────────────────────────────────────────────
    youtube_url = None
    if args.upload:
        print("\n[ 4/4 ] Uploading to YouTube…")
        from publisher import youtube as yt
        youtube_url = yt.upload(
            video_path=video_path,
            metadata=result["metadata"],
            privacy=args.privacy,
        )
    else:
        print("\n[ 4/4 ] Skipping upload  (pass --upload to publish)")

    # ── Summary ──────────────────────────────────────────────
    print(f"\n{'─' * 56}")
    print("  DONE")
    print(f"  Output dir  : {job_dir}")
    print(f"  Video       : {video_path}")
    print(f"  Script      : {job_dir / 'script.txt'}")
    print(f"  Metadata    : {job_dir / 'metadata.json'}")
    if youtube_url:
        print(f"  YouTube URL : {youtube_url}")

    metadata = result["metadata"]
    if metadata.get("alternative_titles"):
        print("\n  Alternative titles:")
        for t in metadata["alternative_titles"]:
            print(f"    • {t}")
    print(f"{'─' * 56}\n")


if __name__ == "__main__":
    main()
