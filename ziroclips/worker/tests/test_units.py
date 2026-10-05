"""Fast unit tests (no DB, no network)."""
import subprocess

from ziro_worker.pipeline import captions, highlights, media, reframe, render
from ziro_worker.pipeline.transcribe import _mock, segment


def words(text: str, start=0.0, step=0.4):
    out = []
    t = start
    for w in text.split():
        out.append({"w": w, "s": t, "e": t + step * 0.8})
        t += step
    return out


def test_group_words_breaks_on_sentence_and_count():
    pages = captions.group_words(words("one two three four. five six"), 3)
    assert [len(p.words) for p in pages] == [3, 1, 2]
    assert pages[0].end <= pages[1].start + 1e-9


def test_ass_color_and_doc():
    assert captions.ass_color("#FF0000") == "&H000000FF"
    assert captions.ass_color("#00000080") == "&H7F000000"
    doc, emojis = captions.build_ass(words("make money fast!"), 0, 3, {"template": "emoji-pop"}, [], 1080, 1920)
    assert "Dialogue:" in doc and "MONEY" in doc
    assert emojis and emojis[0].emoji == "💰"


def test_piecewise_crop_expression_is_valid_ffmpeg(tmp_path):
    track = [{"t": 10, "x": 0.3, "y": 0.5}, {"t": 12, "x": 0.7, "y": 0.5}, {"t": 15, "x": 0.5, "y": 0.5}]
    f = render.crop_filter(track, 10, 6, 1280, 720, 9 / 16)
    out = tmp_path / "o.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6",
                    "-vf", f, "-t", "6", str(out)], check=True)
    dims = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                           "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout.strip()
    assert dims == "404,720"


def test_center_at_matches_ts_semantics():
    tr = [{"t": 0, "x": 0.2, "y": 0.5}, {"t": 10, "x": 0.8, "y": 0.5}]
    assert reframe.center_at(tr, -1) == (0.2, 0.5)
    assert abs(reframe.center_at(tr, 5)[0] - 0.5) < 1e-9
    assert reframe.center_at(tr, 20) == (0.8, 0.5)


def test_heuristic_highlights_respect_bounds(sample_video, tmp_path):
    wav = media.extract_audio(str(sample_video), tmp_path / "a.wav")
    energy = media.audio_energy(wav)
    tr = _mock(180, energy)
    segs = segment(tr.words)
    cands = highlights.detect(segs, energy, 180, highlights.Options(count=4, min_sec=15, max_sec=45))
    assert cands
    for c in cands:
        assert 14 <= c.end - c.start <= 46
    spans = sorted((c.start, c.end) for c in cands)
    assert all(a[1] <= b[0] + 1.0 for a, b in zip(spans, spans[1:]))
