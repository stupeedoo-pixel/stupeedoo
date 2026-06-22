"""
Voice-over generation.

Priority:
  1. ElevenLabs  – best quality (requires ELEVENLABS_API_KEY)
  2. gTTS        – free fallback (requires internet)
"""

import os
import requests
from pathlib import Path
from config import ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID


def generate(text: str, output_path: str | Path, speed: float = 1.0) -> Path:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if ELEVENLABS_API_KEY:
        return _elevenlabs(text, output_path)
    return _gtts(text, output_path, speed)


def _elevenlabs(text: str, output_path: Path) -> Path:
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": "eleven_monolingual_v1",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    output_path.write_bytes(response.content)
    print(f"  [voice] ElevenLabs → {output_path}")
    return output_path


def _gtts(text: str, output_path: Path, speed: float) -> Path:
    from gtts import gTTS

    # gTTS has a ~5000-char limit per request; chunk if needed
    chunks = _chunk_text(text, 4500)
    if len(chunks) == 1:
        tts = gTTS(text=chunks[0], lang="en", slow=(speed < 0.9))
        tts.save(str(output_path))
    else:
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            p = output_path.with_suffix(f".chunk{i}.mp3")
            gTTS(text=chunk, lang="en", slow=(speed < 0.9)).save(str(p))
            chunk_paths.append(str(p))
        _concat_mp3(chunk_paths, str(output_path))
        for p in chunk_paths:
            os.remove(p)

    print(f"  [voice] gTTS → {output_path}")
    return output_path


def _chunk_text(text: str, max_len: int) -> list[str]:
    if len(text) <= max_len:
        return [text]
    chunks, current = [], ""
    for sentence in text.replace(".", ".|").split("|"):
        if len(current) + len(sentence) > max_len:
            chunks.append(current.strip())
            current = sentence
        else:
            current += sentence
    if current.strip():
        chunks.append(current.strip())
    return chunks


def _concat_mp3(paths: list[str], output: str):
    import subprocess
    list_file = output + ".list.txt"
    with open(list_file, "w") as f:
        for p in paths:
            f.write(f"file '{os.path.abspath(p)}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
         "-c", "copy", output],
        check=True, capture_output=True,
    )
    os.remove(list_file)
