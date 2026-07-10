#!/usr/bin/env python3
"""MAWM OAuth / Bearer token helpers for billingmgmt."""

import os
import urllib3
from pathlib import Path
from typing import Optional, Tuple

import requests
from requests.auth import HTTPBasicAuth

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

AUTH_HOST = os.getenv("MANHATTAN_AUTH_HOST", "salep-auth.sce.manh.com")
API_HOST = os.getenv("MANHATTAN_API_HOST", "salep.sce.manh.com")
USERNAME_BASE = os.getenv("MANHATTAN_USERNAME_BASE", "sdtadmin@")
CLIENT_ID = os.getenv("MANHATTAN_CLIENT_ID", "omnicomponent.1.0.0")
REQUEST_TIMEOUT = 30
DEFAULT_TOKEN_FILE = ".token"

_session = requests.Session()
_session.trust_env = False
_NO_PROXY = {"http": None, "https": None}


def normalize_token(token: str) -> str:
    """Clean pasted tokens: strip whitespace, quotes, and redundant Bearer prefix."""
    token = (token or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in ('"', "'"):
        token = token[1:-1].strip()
    return token


def read_token_from_file(path: str | Path) -> str:
    """Read a refreshable Bearer token from a local file (e.g. `.token`)."""
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    token = normalize_token(text)
    if not token:
        raise ValueError(f"Token file is empty: {path}")
    return token


def resolve_token(
    org: str,
    *,
    token_arg: Optional[str] = None,
    token_file: Optional[str] = None,
    prefer_default_token_file: bool = True,
) -> Tuple[Optional[str], str]:
    """
    Resolve a Bearer token for CLI scripts.

    Priority: --token-file > --token > ./.token (if present) > OAuth env vars.

    Returns (token_or_None, source_description).
    """
    if token_file:
        token = read_token_from_file(token_file)
        return token, f"token-file:{token_file}"

    if token_arg:
        token = normalize_token(token_arg)
        if token:
            return token, "cli --token"

    if prefer_default_token_file:
        default_path = Path(DEFAULT_TOKEN_FILE)
        if not default_path.is_file():
            # Also check billingmgmt root when cwd is elsewhere
            alt = Path(__file__).resolve().parent / DEFAULT_TOKEN_FILE
            if alt.is_file():
                default_path = alt
        if default_path.is_file():
            token = read_token_from_file(default_path)
            return token, f"token-file:{default_path}"

    oauth = get_manhattan_token(org)
    if oauth:
        return normalize_token(oauth), "oauth-env"

    return None, "none"


def get_manhattan_token(org: str) -> Optional[str]:
    password = os.getenv("MANHATTAN_PASSWORD", "").strip()
    secret = os.getenv("MANHATTAN_SECRET", "").strip()
    if not password or not secret or not org:
        return None

    url = f"https://{AUTH_HOST}/oauth/token"
    username = f"{USERNAME_BASE}{org.lower()}"
    data = {
        "grant_type": "password",
        "username": username,
        "password": password,
    }
    auth = HTTPBasicAuth(CLIENT_ID, secret)
    try:
        r = _session.post(
            url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            auth=auth,
            timeout=REQUEST_TIMEOUT,
            verify=False,
            proxies=_NO_PROXY,
        )
        if r.status_code == 200:
            return r.json().get("access_token")
    except Exception as e:
        print(f"[AUTH] Error: {e}")
    return None


def manhattan_api_headers(org: str, token: str) -> dict:
    org = org.upper()
    token = normalize_token(token)
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "selectedOrganization": org,
        "selectedLocation": f"{org}-DM1",
    }


def verify_manhattan_token(org: str, token: str) -> bool:
    if not org or not token:
        return False
    url = f"https://{API_HOST}/dcinventory/api/dcinventory/conditionCode/search"
    payload = {"Query": "", "Template": {"ConditionCodeId": None}, "Size": 1, "Page": 0}
    try:
        r = _session.post(
            url,
            json=payload,
            headers=manhattan_api_headers(org, token),
            timeout=20,
            verify=False,
            proxies=_NO_PROXY,
        )
        return r.ok
    except Exception:
        return False
