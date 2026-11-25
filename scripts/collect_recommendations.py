#!/usr/bin/env python3
"""Rebuild the recommendation file from open, valid GitHub song-request issues.

GitHub Issues is the source of truth. Closing/deleting a request removes it from
the next rebuild; reopening adds it back. Repeated song/artist pairs produce one
line. This script never creates issues or comments and never executes issue text.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


PREFIX = "[歌曲推荐]"
FORM_FIELDS = {"歌名", "演唱者", "备注"}
MAX_FIELD_LENGTH = 120
REPOSITORY_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


def normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def clean_field(value: str, *, required: bool = False) -> str | None:
    """Accept one short plain-text line; None means malformed input."""
    value = value.strip()
    if value in {"_No response_", "_无回应_"}:
        value = ""
    if required and not value:
        return None
    if len(value) > MAX_FIELD_LENGTH:
        return None
    if any(unicodedata.category(char).startswith("C") or char in "\u2028\u2029" for char in value):
        return None
    return value


def parse_recommendation(issue: dict) -> tuple[str, str] | None:
    """Parse GitHub's issue-form Markdown, ignoring unrelated or closed issues."""
    if "pull_request" in issue or issue.get("state") != "open":
        return None
    title = issue.get("title")
    body = issue.get("body")
    if not isinstance(title, str) or not title.startswith(PREFIX) or not isinstance(body, str):
        return None
    fields: dict[str, str] = {}
    sections = re.split(r"(?m)^### ([^\r\n]+)\r?$", body)
    for index in range(1, len(sections), 2):
        heading = sections[index].strip()
        if heading not in FORM_FIELDS:
            continue
        if heading in fields:
            return None
        fields[heading] = sections[index + 1]
    song = clean_field(fields.get("歌名", ""), required=True)
    artist = clean_field(fields.get("演唱者", ""))
    if song is None or artist is None:
        return None
    return song, artist


def render_recommendations(issues: Iterable[dict]) -> str:
    """Deduplicate by normalized song and artist and render a deterministic list."""
    requests: dict[tuple[str, str], tuple[str, str]] = {}
    for issue in issues:
        request = parse_recommendation(issue)
        if request is None:
            continue
        key = tuple(normalize(field) for field in request)
        # Choose consistently even if an API response returns duplicates out of order.
        requests[key] = min(requests.get(key, request), request)
    ordered = [requests[key] for key in sorted(requests)]
    return "".join(f"{song} - {artist}\n" if artist else f"{song}\n" for song, artist in ordered)


def fetch_issues(repository: str, token: str, opener=urlopen) -> list[dict]:
    if not REPOSITORY_RE.fullmatch(repository):
        raise ValueError("GITHUB_REPOSITORY must be an owner/repository name")
    if not token:
        raise ValueError("GITHUB_TOKEN is required")
    issues = []
    page = 1
    while True:
        # Keeping closed issues in the pagination makes closing a request less
        # likely to shift records between pages while a rebuild is in progress.
        query = urlencode({"state": "all", "sort": "created", "direction": "asc", "per_page": 100, "page": page})
        request = Request(
            f"https://api.github.com/repos/{repository}/issues?{query}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
                "User-Agent": "karaoke-recommendation-collector",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with opener(request, timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list) or any(not isinstance(issue, dict) for issue in batch):
            raise ValueError("Unexpected response from the GitHub issues API")
        issues.extend(batch)
        if len(batch) < 100:
            return issues
        page += 1


def write_atomic(path: Path, contents: str) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(contents)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if event_path:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
        event_repository = event.get("repository", {}).get("full_name")
        if event_repository != repository:
            raise ValueError("Event repository does not match GITHUB_REPOSITORY")
    issues = fetch_issues(repository, os.environ.get("GITHUB_TOKEN", ""))
    contents = render_recommendations(issues)
    output = Path(__file__).resolve().parents[1] / "recommended_to_add.txt"
    write_atomic(output, contents)
    print(f"Saved {len(contents.splitlines())} unique open song recommendations.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, HTTPError, URLError) as error:
        print(f"Recommendation update failed: {error}", file=sys.stderr)
        raise SystemExit(1)
