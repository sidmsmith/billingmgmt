#!/usr/bin/env python3
"""MAWM OAuth helpers for billingmgmt."""

import os
import urllib3
from typing import Optional

import requests
from requests.auth import HTTPBasicAuth

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

AUTH_HOST = os.getenv("MANHATTAN_AUTH_HOST", "salep-auth.sce.manh.com")
API_HOST = os.getenv("MANHATTAN_API_HOST", "salep.sce.manh.com")
USERNAME_BASE = os.getenv("MANHATTAN_USERNAME_BASE", "sdtadmin@")
CLIENT_ID = os.getenv("MANHATTAN_CLIENT_ID", "omnicomponent.1.0.0")
REQUEST_TIMEOUT = 30

_session = requests.Session()
_session.trust_env = False
_NO_PROXY = {"http": None, "https": None}


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
