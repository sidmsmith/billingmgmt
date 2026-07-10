# api/index.py
import base64
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from billing_config_service import (  # noqa: E402
    build_org_save_document,
    get_config_for_scope,
    get_scope_hierarchy,
    load_default_config,
    load_org_config,
    merge_configs,
    validate_org_draft,
)
from mawm_client import get_manhattan_token, verify_manhattan_token  # noqa: E402

app = Flask(__name__)

PASSWORD = os.getenv("MANHATTAN_PASSWORD")
CLIENT_SECRET = os.getenv("MANHATTAN_SECRET")
USAGE_INGEST_URL = os.getenv("MANHATTAN_USAGE_INGEST_URL", "").strip()
APP_NAME = "billingmgmt-app"
APP_VERSION = "0.1.0"

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()
GITHUB_REPO = os.getenv("GITHUB_REPO", "sidmsmith/billingmgmt").strip()
GITHUB_REF = os.getenv("GITHUB_REF", "main").strip()

if not PASSWORD or not CLIENT_SECRET:
    raise Exception("Missing MANHATTAN_PASSWORD or MANHATTAN_SECRET environment variables")


def _json():
    return request.get_json(silent=True) or {}


def _require_auth_fields(data):
    org = (data.get("org") or "").strip().upper()
    token = (data.get("token") or "").strip()
    if not org or not token:
        return None, None, jsonify({"success": False, "error": "ORG and token required"})
    return org, token, None


def forward_usage_event(payload):
    if not USAGE_INGEST_URL:
        return
    try:
        requests.post(
            USAGE_INGEST_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=8,
            verify=False,
        )
    except Exception as e:
        print(f"[usage] Forward failed: {e}")


def github_api_headers():
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def github_contents_url(file_path):
    parts = GITHUB_REPO.split("/", 1)
    if len(parts) != 2:
        raise ValueError("GITHUB_REPO must be owner/repo")
    owner, repo = parts
    return f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}"


def load_merged_config(org: str) -> dict:
    default_cfg = load_default_config()
    org_cfg = load_org_config(org)
    return merge_configs(default_cfg, org_cfg)


@app.route("/api/app_opened", methods=["POST"])
def app_opened():
    return jsonify({"success": True})


@app.route("/api/auth", methods=["POST"])
def auth():
    org = (_json().get("org") or "").strip().upper()
    if not org:
        return jsonify({"success": False, "error": "ORG required"})
    token = get_manhattan_token(org)
    if token:
        return jsonify({"success": True, "token": token})
    return jsonify({"success": False, "error": "Auth failed"})


@app.route("/api/scope", methods=["POST"])
def scope():
    data = _json()
    org, token, err = _require_auth_fields(data)
    if err:
        return err
    if not verify_manhattan_token(org, token):
        return jsonify({"success": False, "error": "Session expired — authenticate again"}), 401

    config = load_merged_config(org)
    hierarchy = get_scope_hierarchy(config)
    return jsonify({"success": True, "org": org, **hierarchy})


@app.route("/api/config", methods=["POST"])
def config():
    data = _json()
    org, token, err = _require_auth_fields(data)
    if err:
        return err
    if not verify_manhattan_token(org, token):
        return jsonify({"success": False, "error": "Session expired — authenticate again"}), 401

    facility_id = (data.get("facilityId") or "").strip()
    bu_id = (data.get("businessUnitId") or "").strip()
    client_id = (data.get("clientId") or "").strip()
    entity = (data.get("entity") or "all").strip()

    if not facility_id or not bu_id or not client_id:
        return jsonify({"success": False, "error": "facilityId, businessUnitId, and clientId required"})

    merged = load_merged_config(org)
    result = get_config_for_scope(merged, facility_id, bu_id, client_id, entity)
    status = 200 if result.get("success") else 400
    return jsonify(result), status


@app.route("/api/load_billing_config", methods=["POST"])
def load_billing_config():
    """Return full merged config tree for client-side orgDraft initialization."""
    data = _json()
    org, token, err = _require_auth_fields(data)
    if err:
        return err
    if not verify_manhattan_token(org, token):
        return jsonify({"success": False, "error": "Session expired — authenticate again"}), 401

    merged = load_merged_config(org)
    return jsonify({"success": True, "org": org, "config": merged})


@app.route("/api/save_billing_config", methods=["POST"])
def save_billing_config():
    data = _json()
    org, token, err = _require_auth_fields(data)
    if err:
        return err
    if not verify_manhattan_token(org, token):
        return jsonify({"success": False, "error": "Session expired — authenticate again"}), 401

    config = data.get("config")
    if not isinstance(config, dict):
        return jsonify({"success": False, "error": "Missing config"})

    validation_error = validate_org_draft(config)
    if validation_error:
        return jsonify({"success": False, "error": validation_error})

    if not GITHUB_TOKEN:
        return jsonify({
            "success": False,
            "error": "Save not configured — set GITHUB_TOKEN on the server (Vercel env)",
        })

    save_doc = build_org_save_document(org, config)
    file_path = f"config/orgs/{org}.json"
    commit_message = f"Billing config: update {org} (billingmgmt v0.1)"

    try:
        gh_headers = github_api_headers()
        get_url = f"{github_contents_url(file_path)}?ref={GITHUB_REF}"
        existing_sha = None
        gr = requests.get(get_url, headers=gh_headers, timeout=30)
        if gr.status_code == 200:
            existing_sha = gr.json().get("sha")
        elif gr.status_code != 404:
            return jsonify({"success": False, "error": f"GitHub read failed (HTTP {gr.status_code})"})

        content_text = json.dumps(save_doc, indent=2, ensure_ascii=False) + "\n"
        payload = {
            "message": commit_message,
            "content": base64.b64encode(content_text.encode("utf-8")).decode("ascii"),
            "branch": GITHUB_REF,
        }
        if existing_sha:
            payload["sha"] = existing_sha

        pr = requests.put(
            github_contents_url(file_path),
            headers=gh_headers,
            json=payload,
            timeout=30,
        )
        if not pr.ok:
            detail = pr.text.replace("\n", " ").strip()[:200]
            return jsonify({"success": False, "error": f"GitHub save failed (HTTP {pr.status_code}): {detail}"})

        commit_sha = pr.json().get("commit", {}).get("sha")
        return jsonify({
            "success": True,
            "message": f"Saved {org} billing config — Please wait 1 minute for redeploy",
            "commit": commit_sha,
            "path": file_path,
        })
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)})
    except Exception:
        print(f"[BILLING SAVE] Exception: {traceback.format_exc()}")
        return jsonify({"success": False, "error": "Save failed"})


@app.route("/api/usage-track", methods=["POST"])
def usage_track():
    data = _json()
    payload = {
        "app_name": APP_NAME,
        "app_version": APP_VERSION,
        "event_name": data.get("event_name"),
        "metadata": data.get("metadata") or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    forward_usage_event(payload)
    return jsonify({"success": True})


@app.route("/config/<path:filename>")
def serve_config(filename):
    try:
        return send_from_directory(ROOT / "config", filename)
    except Exception:
        return "File not found", 404


@app.route("/data/<path:filename>")
def serve_data(filename):
    try:
        return send_from_directory(ROOT / "data", filename)
    except Exception:
        return "File not found", 404
