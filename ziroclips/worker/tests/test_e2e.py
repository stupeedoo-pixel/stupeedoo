"""End-to-end: DB job -> process -> clips -> export, using offline providers.

Requires Postgres with the Prisma schema applied (see README). Skips otherwise.
"""
import os

import pytest

os.environ.update(TRANSCRIBE_PROVIDER="mock", LLM_PROVIDER="heuristic", STORAGE_DRIVER="local", WORKER_CONCURRENCY="1")


@pytest.fixture(scope="module")
def dbmod(tmp_path_factory):
    os.environ["STORAGE_LOCAL_DIR"] = str(tmp_path_factory.mktemp("storage"))
    from ziro_worker import config, db

    config.settings.cache_clear()
    try:
        db.q1("SELECT 1 FROM jobs LIMIT 1")
    except Exception as e:  # pragma: no cover
        pytest.skip(f"database not available: {e}")
    return db


def test_process_and_export(dbmod, sample_video):
    import shutil

    from ziro_worker import storage
    from ziro_worker.runner import Worker

    db = dbmod
    uid, pid = db.new_id(), db.new_id()
    key = f"users/{uid}/projects/{pid}/source.mp4"
    dest = storage._local(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(sample_video, dest)
    db.q("INSERT INTO users (id, email, plan, updated_at) VALUES (%s, %s, 'UNLIMITED', now())", (uid, f"{uid}@test.dev"))
    db.q("""INSERT INTO projects (id, user_id, title, source_type, source_key, status, settings, updated_at)
            VALUES (%s, %s, 'Test', 'UPLOAD', %s, 'QUEUED', '{"clipCount": 3, "minSec": 15, "maxSec": 40}', now())""", (pid, uid, key))
    db.q("INSERT INTO jobs (id, type, user_id, project_id, updated_at) VALUES (%s, 'PROCESS_PROJECT', %s, %s, now())", (db.new_id(), uid, pid))

    w = Worker()
    job = db.claim_job("test")
    while job and job["project_id"] != pid:  # ignore leftovers from other runs
        db.finish_job(job["id"])
        job = db.claim_job("test")
    w._run(job)

    project = db.get_project(pid)
    assert project["status"] == "READY", project["error"]
    assert storage._local(project["proxy_key"]).exists()
    clips = db.q("SELECT * FROM clips WHERE project_id = %s ORDER BY position", (pid,))
    assert 1 <= len(clips) <= 3
    assert all(0 < c["virality_score"] <= 100 for c in clips)
    usage = db.q1("SELECT SUM(amount) AS m FROM usage_events WHERE project_id=%s AND kind='MINUTES_PROCESSED'", (pid,))
    assert float(usage["m"]) == pytest.approx(3.0, abs=0.11)

    # Export with captions, a text overlay, an emoji overlay and a B-roll placeholder.
    c = clips[0]
    snapshot = {
        "startSec": c["start_sec"], "endSec": c["start_sec"] + 6, "words": c["words"], "cropTrack": c["crop_track"],
        "captionStyle": {"template": "emoji-pop"}, "aspectRatio": "9:16", "title": c["title"], "brand": None, "watermark": False,
        "overlays": [
            {"id": "a", "type": "text", "text": "Watch this", "x": 0.5, "y": 0.15, "start": 0, "end": 3, "sizePct": 0.04, "color": "#FFFFFF"},
            {"id": "b", "type": "emoji", "text": "🔥", "x": 0.8, "y": 0.3, "start": 1, "end": 4, "sizePct": 0.06, "color": "#FFFFFF"},
            {"id": "c", "type": "broll", "text": "city skyline", "x": 0.5, "y": 0.4, "start": 3, "end": 5, "sizePct": 0.04, "color": "#FFFFFF"},
        ],
    }
    eid = db.new_id()
    db.q("INSERT INTO exports (id, clip_id, user_id, resolution, snapshot, updated_at) VALUES (%s,%s,%s,'1080p',%s,now())", (eid, c["id"], uid, db.J(snapshot)))
    db.q("""INSERT INTO jobs (id, type, user_id, project_id, clip_id, payload, priority, updated_at)
            VALUES (%s,'EXPORT_CLIP',%s,%s,%s,%s,5,now())""", (db.new_id(), uid, pid, c["id"], db.J({"exportId": eid})))
    w._run(db.claim_job("test"))
    exp = db.q1("SELECT * FROM exports WHERE id=%s", (eid,))
    assert exp["status"] == "DONE", exp["error"]
    out = storage._local(exp["output_key"])
    from ziro_worker.pipeline import media
    info = media.probe(str(out))
    assert (info.width, info.height) == (1080, 1920)
    assert 5.5 < info.duration < 6.6

    db.q("DELETE FROM users WHERE id=%s", (uid,))
