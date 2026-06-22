"""
Video assembler.

Each scene → one 1920×1080 PNG frame (Pillow).
Frames + voiceover audio → final MP4 (FFmpeg).
If PEXELS_API_KEY is set, fetches a short stock-footage clip per scene instead.
"""

import os
import json
import subprocess
import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import requests
from config import VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS, PEXELS_API_KEY


# ── Gradient palette per music mood ─────────────────────────────────────────
PALETTES = {
    "upbeat":    [(15, 32, 80),    (30, 90, 120)],
    "calm":      [(10, 20, 40),    (20, 55, 75)],
    "dramatic":  [(10, 0, 20),     (60, 10, 10)],
    "inspiring": [(20, 10, 50),    (80, 30, 10)],
    "default":   [(12, 12, 30),    (25, 25, 60)],
}


def _gradient_background(mood: str) -> Image.Image:
    top, bottom = PALETTES.get(mood, PALETTES["default"])
    img = Image.new("RGB", (VIDEO_WIDTH, VIDEO_HEIGHT))
    draw = ImageDraw.Draw(img)
    for y in range(VIDEO_HEIGHT):
        t = y / VIDEO_HEIGHT
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        draw.line([(0, y), (VIDEO_WIDTH, y)], fill=(r, g, b))
    return img


def _get_font(size: int) -> ImageFont.FreeTypeFont:
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _render_frame(scene: dict, scene_index: int, total_scenes: int) -> Image.Image:
    mood = scene.get("music_mood", "default").split(",")[0].strip().lower()
    img = _gradient_background(mood)
    draw = ImageDraw.Draw(img)

    W, H = VIDEO_WIDTH, VIDEO_HEIGHT

    # Subtle vignette overlay
    vignette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    for i in range(200):
        alpha = int(180 * (i / 200) ** 2)
        vd.rectangle([i, i, W - i, H - i], outline=(0, 0, 0, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), vignette).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Scene number chip
    chip_font = _get_font(22)
    chip_text = f"{scene_index + 1:02d} / {total_scenes:02d}"
    draw.text((60, 55), chip_text, font=chip_font, fill=(255, 255, 255, 120))

    # Visual description (smaller, upper area)
    vis_font = _get_font(28)
    vis_text = scene.get("visual_description", "")
    if vis_text:
        wrapped = textwrap.fill(vis_text, width=70)
        draw.text((W // 2, 130), wrapped, font=vis_font, fill=(180, 200, 255),
                  anchor="mm", align="center")

    # Main script text (centre)
    main_font = _get_font(52)
    script = scene.get("script", "")
    # Show first ~120 chars as the on-screen text
    preview = script[:120].rsplit(" ", 1)[0] + ("…" if len(script) > 120 else "")
    wrapped_main = textwrap.fill(preview, width=38)
    draw.text((W // 2, H // 2), wrapped_main, font=main_font, fill=(255, 255, 255),
              anchor="mm", align="center")

    # Keywords chips at bottom
    kw_font = _get_font(24)
    keywords = scene.get("keywords", [])[:4]
    kw_text = "  ·  ".join(f"#{k}" for k in keywords)
    if kw_text:
        draw.text((W // 2, H - 80), kw_text, font=kw_font, fill=(120, 180, 255),
                  anchor="mm")

    # Progress bar
    progress = (scene_index + 1) / total_scenes
    bar_y = H - 8
    draw.rectangle([0, bar_y, W, H], fill=(30, 30, 60))
    draw.rectangle([0, bar_y, int(W * progress), H], fill=(100, 150, 255))

    return img


def _fetch_pexels_clip(query: str, output_path: Path, duration: int) -> bool:
    if not PEXELS_API_KEY:
        return False
    try:
        headers = {"Authorization": PEXELS_API_KEY}
        r = requests.get(
            "https://api.pexels.com/videos/search",
            headers=headers,
            params={"query": query, "per_page": 1, "orientation": "landscape"},
            timeout=10,
        )
        r.raise_for_status()
        videos = r.json().get("videos", [])
        if not videos:
            return False
        # Pick best HD file
        files = sorted(
            [f for f in videos[0]["video_files"] if f.get("width", 0) >= 1280],
            key=lambda x: x.get("width", 0), reverse=True,
        )
        if not files:
            return False
        video_url = files[0]["link"]
        clip_data = requests.get(video_url, timeout=30).content
        raw_path = output_path.with_suffix(".raw.mp4")
        raw_path.write_bytes(clip_data)
        # Trim to scene duration
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_path), "-t", str(duration),
             "-vf", f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
                    f"pad={VIDEO_WIDTH}:{VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2",
             "-c:v", "libx264", "-an", str(output_path)],
            check=True, capture_output=True,
        )
        raw_path.unlink()
        return True
    except Exception as e:
        print(f"  [video] Pexels failed for '{query}': {e}")
        return False


def _image_to_clip(frame_path: Path, duration: int, clip_path: Path):
    subprocess.run(
        ["ffmpeg", "-y",
         "-loop", "1", "-i", str(frame_path),
         "-t", str(duration),
         "-vf", f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT},format=yuv420p",
         "-c:v", "libx264", "-r", str(VIDEO_FPS),
         str(clip_path)],
        check=True, capture_output=True,
    )


def assemble(scenes: list[dict], audio_path: str | Path, output_dir: str | Path) -> Path:
    output_dir = Path(output_dir)
    frames_dir = output_dir / "frames"
    clips_dir = output_dir / "clips"
    frames_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    total = len(scenes)
    clip_paths = []

    for i, scene in enumerate(scenes):
        duration = scene.get("duration_seconds", 30)
        clip_path = clips_dir / f"clip_{i:03d}.mp4"
        clip_paths.append(clip_path)

        print(f"  [video] Scene {i + 1}/{total}: '{scene.get('visual_description', '')[:50]}'")

        # Try stock footage first, fall back to generated frame
        if not _fetch_pexels_clip(scene.get("visual_description", "landscape"), clip_path, duration):
            frame_path = frames_dir / f"frame_{i:03d}.png"
            frame = _render_frame(scene, i, total)
            frame.save(str(frame_path))
            _image_to_clip(frame_path, duration, clip_path)

    # Concatenate all clips
    concat_list = output_dir / "concat.txt"
    with concat_list.open("w") as f:
        for p in clip_paths:
            f.write(f"file '{p.resolve()}'\n")

    silent_video = output_dir / "silent.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-c", "copy", str(silent_video)],
        check=True, capture_output=True,
    )

    # Merge with voiceover
    final_path = output_dir / "final_video.mp4"
    subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(silent_video),
         "-i", str(audio_path),
         "-c:v", "copy", "-c:a", "aac",
         "-shortest",
         str(final_path)],
        check=True, capture_output=True,
    )

    print(f"  [video] Final → {final_path}")
    return final_path
