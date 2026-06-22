import json
import re
import anthropic
from config import ANTHROPIC_API_KEY

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


SCRIPT_PROMPT = """\
You are an expert YouTube scriptwriter for faceless, monetizable channels.

Topic: {topic}
Target duration: {duration} minutes
Style: {style}
Niche: {niche}
SEO keywords: {keywords}

Write a complete video script that:
- Opens with a compelling hook in the first 10 seconds (question, shocking fact, or bold claim)
- Delivers clear value throughout
- Uses conversational, natural language with [PAUSE:2] for 2-second breath pauses
- Includes [SCENE: one-line visual description] markers every 30-60 seconds
- Closes with a strong call-to-action (like, subscribe, comment)
- Targets ~{word_count} words for the duration

After the script, output a JSON block wrapped in ```json ... ``` with this exact structure:
{{
  "title": "SEO-optimized title (max 60 chars)",
  "description": "2-3 engaging paragraphs with keywords naturally woven in",
  "tags": ["tag1", "tag2"],
  "thumbnail_text": "SHORT PUNCHY TEXT",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3",
  "category": "Education",
  "alternative_titles": [
    "Alt title 1",
    "Alt title 2",
    "Alt title 3",
    "Alt title 4",
    "Alt title 5"
  ],
  "scenes": [
    {{
      "id": 1,
      "duration_seconds": 30,
      "script": "The spoken words for this scene",
      "visual_description": "What should appear on screen",
      "keywords": ["keyword1"],
      "music_mood": "upbeat"
    }}
  ]
}}
"""

WORDS_PER_MINUTE = 150


def generate(
    topic: str,
    duration: int = 10,
    style: str = "educational",
    niche: str = "",
    keywords: list[str] | None = None,
) -> dict:
    keywords = keywords or []
    word_count = duration * WORDS_PER_MINUTE

    response = _get_client().messages.create(
        model="claude-opus-4-8",
        max_tokens=8096,
        messages=[{
            "role": "user",
            "content": SCRIPT_PROMPT.format(
                topic=topic,
                duration=duration,
                style=style,
                niche=niche,
                keywords=", ".join(keywords),
                word_count=word_count,
            ),
        }],
    )

    text = response.content[0].text
    json_match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)

    if json_match:
        script_text = text[: json_match.start()].strip()
        metadata = json.loads(json_match.group(1))
    else:
        script_text = text
        metadata = {
            "title": topic[:60],
            "description": "",
            "tags": keywords,
            "thumbnail_text": topic.upper()[:20],
            "hashtags": "",
            "category": "Education",
            "alternative_titles": [],
            "scenes": [],
        }

    # Strip [SCENE:...] and [PAUSE:N] markers from the narration text
    narration = re.sub(r"\[SCENE:[^\]]*\]", "", script_text)
    narration = re.sub(r"\[PAUSE:\d+\]", " ", narration)
    narration = re.sub(r"\s{2,}", " ", narration).strip()

    return {
        "script": script_text,
        "narration": narration,
        "metadata": metadata,
    }
