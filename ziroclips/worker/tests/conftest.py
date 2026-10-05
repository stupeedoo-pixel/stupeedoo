import os
import subprocess
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://postgres@localhost:5433/ziroclips")


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """3-minute 720p test video with speech-like audio bursts (no real speech/faces)."""
    out = tmp_path_factory.mktemp("media") / "sample.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=180",
        "-f", "lavfi", "-i", "aevalsrc='0.4*sin(2*PI*180*t)*(0.6+0.4*sin(2*PI*3*t))*gt(sin(2*PI*t/7),-0.6)':s=16000:d=180",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(out),
    ], check=True)
    return out
