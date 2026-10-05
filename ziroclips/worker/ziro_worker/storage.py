"""Storage driver mirror of web/src/lib/storage.ts (local disk or S3/R2)."""
from __future__ import annotations

import shutil
from functools import lru_cache
from pathlib import Path

from .config import settings


def _local(key: str) -> Path:
    root = Path(settings().storage_local_dir).resolve()
    p = (root / key).resolve()
    if root not in p.parents:
        raise ValueError("invalid storage key")
    return p


@lru_cache
def _s3():
    import boto3

    s = settings()
    return boto3.client(
        "s3",
        region_name=s.s3_region,
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key_id,
        aws_secret_access_key=s.s3_secret_access_key,
    )


def is_local() -> bool:
    return settings().storage_driver == "local"


def fetch(key: str, dest_dir: Path) -> Path:
    """Return a local path for `key`. Local driver: no copy at all."""
    if is_local():
        p = _local(key)
        if not p.exists():
            raise FileNotFoundError(key)
        return p
    dest = dest_dir / Path(key).name
    _s3().download_file(settings().s3_bucket, key, str(dest))
    return dest


def ffmpeg_input(key: str) -> str:
    """Path or presigned URL usable directly as an ffmpeg input. For S3 this lets
    ffmpeg range-read only the seconds it needs (no 5 GB download per export)."""
    if is_local():
        return str(_local(key))
    return _s3().generate_presigned_url("get_object", Params={"Bucket": settings().s3_bucket, "Key": key}, ExpiresIn=6 * 3600)


def put(path: Path, key: str, content_type: str) -> None:
    if is_local():
        dest = _local(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if path.resolve() != dest:
            shutil.copyfile(path, dest)
        return
    _s3().upload_file(str(path), settings().s3_bucket, key, ExtraArgs={"ContentType": content_type})


def delete(key: str) -> None:
    if is_local():
        _local(key).unlink(missing_ok=True)
        return
    _s3().delete_object(Bucket=settings().s3_bucket, Key=key)


def exists(key: str) -> bool:
    if is_local():
        return _local(key).exists()
    try:
        _s3().head_object(Bucket=settings().s3_bucket, Key=key)
        return True
    except Exception:
        return False


def project_prefix(user_id: str, project_id: str) -> str:
    return f"users/{user_id}/projects/{project_id}"
