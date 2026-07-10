"""Load, merge, filter, and validate billing configuration JSON."""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT / "data" / "defaults" / "billing.default.json"
ORG_CONFIG_DIR = ROOT / "config" / "orgs"

ENTITY_KEYS = [
    "clientActivities",
    "rateCards",
    "rulesTransaction",
    "rulesStorage",
    "billToCodes",
    "billingLogDefinitions",
]


def _read_json(path: Path) -> Optional[dict]:
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_default_config() -> dict:
    data = _read_json(DEFAULT_CONFIG_PATH)
    if not data:
        return {"version": "1.0.0", "facilities": []}
    return data


def load_org_config(org: str) -> Optional[dict]:
    org = str(org or "").strip().upper()
    if not org:
        return None
    return _read_json(ORG_CONFIG_DIR / f"{org}.json")


def _index_by_id(items: List[dict], key: str = "id") -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for item in items or []:
        if isinstance(item, dict) and item.get(key):
            out[str(item[key])] = item
    return out


def _merge_entity_lists(base: List[dict], override: List[dict]) -> List[dict]:
    if not override:
        return copy.deepcopy(base or [])
    if not base:
        return copy.deepcopy(override or [])
    merged = _index_by_id(base)
    for item in override:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        if item_id and item_id in merged:
            merged[item_id] = {**merged[item_id], **item}
        elif item_id:
            merged[item_id] = copy.deepcopy(item)
        else:
            merged[f"__new_{len(merged)}"] = copy.deepcopy(item)
    return list(merged.values())


def _merge_client(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if key in ENTITY_KEYS:
            result[key] = _merge_entity_lists(result.get(key, []), value)
        elif key not in ("id", "name"):
            result[key] = copy.deepcopy(value)
    return result


def _merge_business_unit(base: dict, override: dict) -> dict:
    clients_out: Dict[str, dict] = {}
    for client in base.get("clients", []):
        clients_out[client["id"]] = copy.deepcopy(client)

    for client in (override or {}).get("clients", []):
        cid = client.get("id")
        if not cid:
            continue
        if cid in clients_out:
            clients_out[cid] = _merge_client(clients_out[cid], client)
        else:
            clients_out[cid] = copy.deepcopy(client)

    result = copy.deepcopy(base)
    result["clients"] = list(clients_out.values())
    if override:
        for key in ("id", "name"):
            if override.get(key):
                result[key] = override[key]
    return result


def _merge_facility(base: dict, override: dict) -> dict:
    bu_out: Dict[str, dict] = {}
    for bu in base.get("businessUnits", []):
        bu_out[bu["id"]] = copy.deepcopy(bu)

    for bu in (override or {}).get("businessUnits", []):
        bu_id = bu.get("id")
        if not bu_id:
            continue
        if bu_id in bu_out:
            bu_out[bu_id] = _merge_business_unit(bu_out[bu_id], bu)
        else:
            bu_out[bu_id] = copy.deepcopy(bu)

    result = copy.deepcopy(base)
    result["businessUnits"] = list(bu_out.values())
    if override:
        for key in ("id", "name"):
            if override.get(key):
                result[key] = override[key]
    return result


def merge_configs(default: dict, org_override: Optional[dict]) -> dict:
    if not org_override:
        return copy.deepcopy(default)

    facilities_out: Dict[str, dict] = {}
    for fac in default.get("facilities", []):
        facilities_out[fac["id"]] = copy.deepcopy(fac)

    for fac in org_override.get("facilities", []):
        fac_id = fac.get("id")
        if not fac_id:
            continue
        if fac_id in facilities_out:
            facilities_out[fac_id] = _merge_facility(facilities_out[fac_id], fac)
        else:
            facilities_out[fac_id] = copy.deepcopy(fac)

    merged = {
        "version": org_override.get("version") or default.get("version", "1.0.0"),
        "facilities": list(facilities_out.values()),
    }
    if org_override.get("org"):
        merged["org"] = org_override["org"]
    if org_override.get("updatedAt"):
        merged["updatedAt"] = org_override["updatedAt"]
    return merged


def get_scope_hierarchy(config: dict) -> dict:
    facilities = []
    for fac in config.get("facilities", []):
        business_units = []
        for bu in fac.get("businessUnits", []):
            clients = [
                {"id": c.get("id"), "name": c.get("name", c.get("id"))}
                for c in bu.get("clients", [])
                if c.get("id")
            ]
            business_units.append({
                "id": bu.get("id"),
                "name": bu.get("name", bu.get("id")),
                "clients": clients,
            })
        facilities.append({
            "id": fac.get("id"),
            "name": fac.get("name", fac.get("id")),
            "businessUnits": business_units,
        })
    return {"facilities": facilities}


def _find_client(config: dict, facility_id: str, bu_id: str, client_id: str) -> Optional[dict]:
    for fac in config.get("facilities", []):
        if fac.get("id") != facility_id:
            continue
        for bu in fac.get("businessUnits", []):
            if bu.get("id") != bu_id:
                continue
            for client in bu.get("clients", []):
                if client.get("id") == client_id:
                    return client
    return None


def get_config_for_scope(
    config: dict,
    facility_id: str,
    business_unit_id: str,
    client_id: str,
    entity: Optional[str] = None,
) -> dict:
    client = _find_client(config, facility_id, business_unit_id, client_id)
    if not client:
        return {"success": False, "error": "Client not found for selected scope"}

    scope = {
        "facilityId": facility_id,
        "businessUnitId": business_unit_id,
        "clientId": client_id,
        "clientName": client.get("name", client_id),
    }

    if entity and entity != "all":
        if entity not in ENTITY_KEYS:
            return {"success": False, "error": f"Unknown entity type: {entity}"}
        return {
            "success": True,
            "scope": scope,
            "entity": entity,
            "records": copy.deepcopy(client.get(entity, [])),
        }

    entities = {key: copy.deepcopy(client.get(key, [])) for key in ENTITY_KEYS}
    return {"success": True, "scope": scope, "entities": entities}


def build_org_save_document(org: str, org_draft: dict) -> dict:
    org = str(org or "").strip().upper()
    facilities = org_draft.get("facilities")
    if not isinstance(facilities, list):
        facilities = []
    return {
        "org": org,
        "updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "version": org_draft.get("version", "1.0.0"),
        "facilities": facilities,
    }


def validate_org_draft(org_draft: dict) -> Optional[str]:
    if not isinstance(org_draft, dict):
        return "Config must be an object"
    facilities = org_draft.get("facilities")
    if facilities is not None and not isinstance(facilities, list):
        return "facilities must be an array"
    return None
