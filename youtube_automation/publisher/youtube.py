"""
YouTube Data API v3 uploader.

First run triggers a browser-based OAuth flow and saves a token file.
Subsequent runs reuse the saved token.
"""

import os
import pickle
from pathlib import Path
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from config import YOUTUBE_CLIENT_SECRETS

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
TOKEN_FILE = "youtube_token.pickle"

CATEGORY_IDS = {
    "Film & Animation": "1",
    "Music": "10",
    "Pets & Animals": "15",
    "Sports": "17",
    "Travel & Events": "19",
    "Gaming": "20",
    "People & Blogs": "22",
    "Comedy": "23",
    "Entertainment": "24",
    "News & Politics": "25",
    "Howto & Style": "26",
    "Education": "27",
    "Science & Technology": "28",
    "Nonprofits & Activism": "29",
}


def _get_credentials():
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(YOUTUBE_CLIENT_SECRETS):
                raise FileNotFoundError(
                    f"YouTube OAuth file not found: {YOUTUBE_CLIENT_SECRETS}\n"
                    "Download it from Google Cloud Console → APIs & Services → Credentials."
                )
            flow = InstalledAppFlow.from_client_secrets_file(YOUTUBE_CLIENT_SECRETS, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)

    return creds


def upload(
    video_path: str | Path,
    metadata: dict,
    privacy: str = "private",
    notify_subscribers: bool = False,
) -> str:
    """Upload video and return the YouTube video URL."""
    creds = _get_credentials()
    youtube = build("youtube", "v3", credentials=creds)

    category_name = metadata.get("category", "Education")
    category_id = CATEGORY_IDS.get(category_name, "27")

    tags = metadata.get("tags", [])
    hashtags = metadata.get("hashtags", "").split()
    all_tags = list(dict.fromkeys(tags + [h.lstrip("#") for h in hashtags]))[:30]

    body = {
        "snippet": {
            "title": metadata.get("title", "")[:100],
            "description": metadata.get("description", ""),
            "tags": all_tags,
            "categoryId": category_id,
        },
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": False,
            "notifySubscribers": notify_subscribers,
        },
    }

    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    print("  [youtube] Uploading…")
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  [youtube] {int(status.progress() * 100)}% uploaded…")

    video_id = response["id"]
    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"  [youtube] Published → {url}")
    return url
