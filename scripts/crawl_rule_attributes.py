#!/usr/bin/env python3
"""
Crawl MAWM Rules Framework attributes into a local inventory for billingmgmt.

Usage (from billingmgmt/):
  # Paste a fresh access token into .token (same pattern as flowthrough create_asns)
  python scripts/crawl_rule_attributes.py --org SS-DEMO
  python scripts/crawl_rule_attributes.py --org SS-DEMO --token-file .token --verify
  python scripts/crawl_rule_attributes.py --org SS-DEMO --all-components

Auth priority: --token-file > --token > ./.token > OAuth env vars (optional).
Writes:
  data/rule_inventory/rule_inventory.json
  data/rule_inventory/rule_inventory.csv
  data/rule_inventory/crawl_errors.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import requests
import urllib3

# Allow `from mawm_client import ...` when run as scripts/crawl_*.py
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mawm_client import (  # noqa: E402
    API_HOST,
    REQUEST_TIMEOUT,
    manhattan_api_headers,
    resolve_token,
    verify_manhattan_token,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

OUT_DIR = ROOT / "data" / "rule_inventory"
DEFAULT_COMPONENTS = [
    "receiving",
    "dcinventory",
    "dcorder",
    "putaway",
    "task",
    "dcallocation",
    "shipment",
]

ACTIVITY_HINTS = {
    "Receiving": {"component": "receiving", "preferredRuleTypes": []},
    "Picking": {"component": "dcorder", "preferredRuleTypes": []},
    "Storage": {"component": "dcinventory", "preferredRuleTypes": []},
    "Putaway": {"component": "putaway", "preferredRuleTypes": []},
    "Tasking": {"component": "task", "preferredRuleTypes": []},
    "Allocation": {"component": "dcallocation", "preferredRuleTypes": []},
    "Shipping": {"component": "shipment", "preferredRuleTypes": []},
}

_NO_PROXY = {"http": None, "https": None}
_session = requests.Session()
_session.trust_env = False


# ---------------------------------------------------------------------------
# Env / HTTP helpers
# ---------------------------------------------------------------------------

def _load_dotenv() -> None:
    """Best-effort load of billingmgmt/.env without requiring python-dotenv."""
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def as_rows(payload: Any) -> list[dict]:
    """Normalize MAWM search / list payloads into a list of dict rows."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ("data", "Data", "items", "Items", "results", "Results", "content"):
        val = payload.get(key)
        if isinstance(val, list):
            return [r for r in val if isinstance(r, dict)]
        if isinstance(val, dict):
            # Nested list under data.Message / data.list etc.
            for nested_key in ("Message", "list", "List", "rows", "Rows"):
                nested = val.get(nested_key)
                if isinstance(nested, list):
                    return [r for r in nested if isinstance(r, dict)]

    # Single wrapped entity
    for wrap in ("RuleType", "AvailableAttribute", "Entity", "Component"):
        if wrap in payload and isinstance(payload[wrap], dict):
            return [payload[wrap]]

    # Dict that already looks like a row
    if any(k in payload for k in ("RuleTypeId", "AvailableAttributeId", "EntityId", "ComponentId", "name", "Name")):
        return [payload]

    return []


def unwrap_field(row: dict, *names: str) -> Any:
    """Read a field that may be nested (e.g. RuleType.RuleTypeId or flat RuleTypeId)."""
    for name in names:
        if name in row and row[name] is not None:
            val = row[name]
            if isinstance(val, dict):
                # Nested object with same-named id
                for inner in (name, f"{name}Id", "Id", "id", "value", "Value"):
                    if inner in val and val[inner] is not None:
                        return val[inner]
                # First scalar value
                for v in val.values():
                    if isinstance(v, (str, int, float, bool)):
                        return v
                continue
            return val
        # Nested path RuleType.RuleTypeId style already handled via names
    # Try nested containers
    for container in ("RuleType", "AvailableAttribute", "Entity", "Attribute"):
        nested = row.get(container)
        if isinstance(nested, dict):
            for name in names:
                if name in nested and nested[name] is not None:
                    return nested[name]
                short = name.replace(container, "").lstrip(".")
                if short in nested and nested[short] is not None:
                    return nested[short]
    return None


def api_request(
    method: str,
    path: str,
    headers: dict,
    *,
    json_body: Any = None,
    params: Optional[dict] = None,
) -> tuple[Optional[Any], Optional[str]]:
    url = f"https://{API_HOST}{path}"
    try:
        r = _session.request(
            method,
            url,
            headers=headers,
            json=json_body,
            params=params,
            timeout=REQUEST_TIMEOUT,
            verify=False,
            proxies=_NO_PROXY,
        )
        if r.status_code >= 400:
            body = (r.text or "")[:500]
            return None, f"HTTP {r.status_code} {path}: {body}"
        if not r.content:
            return {}, None
        try:
            return r.json(), None
        except Exception:
            return {"_raw": r.text[:2000]}, None
    except Exception as exc:
        return None, f"{method} {path}: {exc}"


def search(
    component: str,
    resource: str,
    headers: dict,
    query: str = "",
    *,
    size: int = 500,
    page: int = 0,
) -> tuple[list[dict], Optional[str]]:
    """POST /{component}/api/rules/{resource}/search with paging."""
    path = f"/{component}/api/rules/{resource}/search"
    body = {"Query": query or "", "Size": size, "Page": page}
    payload, err = api_request("POST", path, headers, json_body=body)
    if err:
        return [], err
    rows = as_rows(payload)
    # Follow pages if header present
    header = (payload or {}).get("header") if isinstance(payload, dict) else None
    if isinstance(header, dict):
        try:
            total = int(header.get("totalCount") or header.get("TotalCount") or 0)
            page_size = int(header.get("size") or header.get("Size") or size) or size
        except (TypeError, ValueError):
            total, page_size = 0, size
        next_page = page + 1
        while total and len(rows) < total and next_page * page_size < total + page_size:
            body = {"Query": query or "", "Size": page_size, "Page": next_page}
            more, more_err = api_request("POST", path, headers, json_body=body)
            if more_err:
                break
            batch = as_rows(more)
            if not batch:
                break
            rows.extend(batch)
            next_page += 1
            if next_page > 50:
                break
    return rows, None


# ---------------------------------------------------------------------------
# Crawl steps
# ---------------------------------------------------------------------------

def list_components(headers: dict) -> tuple[list[str], Optional[str]]:
    path = "/fwuifacade/api/fwuifacade/proactive/components/list"
    payload, err = api_request("GET", path, headers)
    if err:
        return [], err
    rows = as_rows(payload)
    names: list[str] = []
    for row in rows:
        name = (
            unwrap_field(row, "name", "Name", "component", "Component", "ComponentId", "id", "Id")
            or row.get("shortName")
        )
        if isinstance(name, str) and name.strip():
            # Values sometimes look like "com-manh-cp-receiving" — take last segment
            short = name.strip()
            if "com-manh-cp-" in short:
                short = short.split("com-manh-cp-")[-1]
            if short.endswith("-1"):
                short = short[:-2]
            names.append(short.lower())
        elif isinstance(row.get("componentName"), str):
            names.append(row["componentName"].lower())
    # Dedupe preserve order
    seen = set()
    out = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out, None


def rule_type_id(row: dict) -> Optional[str]:
    val = unwrap_field(row, "RuleTypeId", "ruleTypeId", "Id", "id")
    return str(val) if val is not None else None


def rule_type_name(row: dict) -> Optional[str]:
    val = unwrap_field(row, "RuleTypeName", "Name", "name", "Description", "description")
    return str(val) if val is not None else None


def entity_id(row: dict) -> Optional[str]:
    val = unwrap_field(row, "EntityId", "entityId", "EntityName", "entityName", "Name", "name")
    # Prefer EntityId over nested RuleType noise
    for key in ("EntityId", "entityId"):
        if row.get(key):
            return str(row[key])
    nested = row.get("Entity")
    if isinstance(nested, dict):
        for key in ("EntityId", "entityId", "Name", "name", "Id", "id"):
            if nested.get(key):
                return str(nested[key])
    return str(val) if val is not None else None


def attribute_id(row: dict) -> Optional[str]:
    for key in (
        "AvailableAttributeId",
        "availableAttributeId",
        "AttributeId",
        "attributeId",
        "AttributeName",
        "attributeName",
        "Name",
        "name",
    ):
        if row.get(key) not in (None, ""):
            val = row[key]
            if isinstance(val, dict):
                inner = unwrap_field(val, "AvailableAttributeId", "AttributeId", "Name", "Id")
                if inner is not None:
                    return str(inner)
            else:
                return str(val)
    nested = row.get("AvailableAttribute") or row.get("Attribute")
    if isinstance(nested, dict):
        for key in ("AvailableAttributeId", "AttributeId", "Name", "name", "Id", "id"):
            if nested.get(key) not in (None, ""):
                return str(nested[key])
    return None


def attribute_meta(row: dict) -> dict:
    field_type = unwrap_field(
        row,
        "FieldType",
        "fieldType",
        "DataType",
        "dataType",
        "AttributeType",
        "attributeType",
        "Type",
        "type",
    )
    label = unwrap_field(row, "Description", "description", "Label", "label", "DisplayName", "displayName")
    entity = entity_id(row)
    attr = attribute_id(row)
    return {
        "attribute": attr,
        "entity": entity,
        "fieldType": str(field_type) if field_type is not None else None,
        "label": str(label) if label is not None else None,
        "rawKeys": sorted(row.keys()),
    }


def crawl_component(
    component: str,
    headers: dict,
    errors: list[dict],
    *,
    include_catalog: bool = True,
) -> dict:
    started = time.time()
    result: dict[str, Any] = {
        "component": component,
        "ruleTypes": [],
        "catalogAttributes": [],
        "entities": [],
    }

    rt_rows, err = search(component, "ruleType", headers)
    if err:
        errors.append({"component": component, "step": "ruleType/search", "error": err})
        # Try alternate resource names
        for alt in ("RuleType", "rule-type"):
            rt_rows, err2 = search(component, alt, headers)
            if not err2 and rt_rows:
                err = None
                break
            if err2:
                errors.append({"component": component, "step": f"{alt}/search", "error": err2})
        if err and not rt_rows:
            result["elapsedSec"] = round(time.time() - started, 2)
            return result

    for rt in rt_rows:
        rtid = rule_type_id(rt)
        if not rtid:
            continue
        entry: dict[str, Any] = {
            "ruleTypeId": rtid,
            "name": rule_type_name(rt),
            "entities": [],
            "attributes": [],
        }

        # Entity xref
        q = f"RuleType.RuleTypeId='{rtid}'"
        ent_rows, ent_err = search(component, "ruleTypeEntityXref", headers, q)
        if ent_err:
            # Alternates
            for alt, q2 in (
                ("ruleTypeEntityXref", f"RuleTypeId='{rtid}'"),
                ("RuleTypeEntityXref", q),
                ("ruleTypeEntity", q),
            ):
                ent_rows, ent_err2 = search(component, alt, headers, q2)
                if not ent_err2:
                    ent_err = None
                    break
            if ent_err:
                errors.append(
                    {
                        "component": component,
                        "ruleTypeId": rtid,
                        "step": "ruleTypeEntityXref/search",
                        "error": ent_err,
                    }
                )
        for er in ent_rows:
            eid = entity_id(er)
            if eid:
                entry["entities"].append({"entityId": eid, "rawKeys": sorted(er.keys())})

        # Attribute xref
        attr_rows, attr_err = search(component, "ruleTypeAvailableAttributeXref", headers, q)
        if attr_err:
            for alt, q2 in (
                ("ruleTypeAvailableAttributeXref", f"RuleTypeId='{rtid}'"),
                ("RuleTypeAvailableAttributeXref", q),
                ("ruleTypeAttributeXref", q),
                ("availableAttributeXref", q),
            ):
                attr_rows, attr_err2 = search(component, alt, headers, q2)
                if not attr_err2:
                    attr_err = None
                    break
            if attr_err:
                errors.append(
                    {
                        "component": component,
                        "ruleTypeId": rtid,
                        "step": "ruleTypeAvailableAttributeXref/search",
                        "error": attr_err,
                    }
                )
        for ar in attr_rows:
            meta = attribute_meta(ar)
            if meta["attribute"]:
                meta["source"] = "ruleTypeAvailableAttributeXref"
                entry["attributes"].append(meta)

        result["ruleTypes"].append(entry)

    if include_catalog:
        cat_rows, cat_err = search(component, "availableAttribute", headers, size=1000)
        if cat_err:
            for alt in ("AvailableAttribute", "available-attribute"):
                cat_rows, cat_err2 = search(component, alt, headers, size=1000)
                if not cat_err2:
                    cat_err = None
                    break
            if cat_err:
                errors.append(
                    {
                        "component": component,
                        "step": "availableAttribute/search",
                        "error": cat_err,
                    }
                )
        for cr in cat_rows:
            meta = attribute_meta(cr)
            if meta["attribute"]:
                meta["source"] = "availableAttribute"
                result["catalogAttributes"].append(meta)

        ent_cat, ent_cat_err = search(component, "entity", headers, size=500)
        if ent_cat_err:
            for alt in ("Entity", "availableEntity", "ruleEntity"):
                ent_cat, ent_cat_err2 = search(component, alt, headers, size=500)
                if not ent_cat_err2:
                    ent_cat_err = None
                    break
            if ent_cat_err:
                errors.append(
                    {
                        "component": component,
                        "step": "entity/search",
                        "error": ent_cat_err,
                    }
                )
        for er in ent_cat:
            eid = entity_id(er)
            if eid:
                result["entities"].append({"entityId": eid, "rawKeys": sorted(er.keys())})

    result["elapsedSec"] = round(time.time() - started, 2)
    return result


def build_billing_index(components: list[dict]) -> dict:
    attrs: list[dict] = []
    seen: set[str] = set()
    for comp in components:
        cname = comp["component"]
        # Prefer xref attributes (tied to rule types); fall back to catalog
        pairs: list[tuple[str, dict]] = []
        for rt in comp.get("ruleTypes") or []:
            for a in rt.get("attributes") or []:
                pairs.append(("ruleTypeAvailableAttributeXref", a))
        for a in comp.get("catalogAttributes") or []:
            pairs.append(("availableAttribute", a))

        for source, a in pairs:
            attr = a.get("attribute")
            if not attr:
                continue
            entity = a.get("entity") or "unknown"
            key = f"{cname}.{entity}.{attr}".lower()
            if key in seen:
                # Merge sources
                for existing in attrs:
                    if existing["key"] == key:
                        if source not in existing["sources"]:
                            existing["sources"].append(source)
                        break
                continue
            seen.add(key)
            label = a.get("label") or f"{entity} / {attr}"
            attrs.append(
                {
                    "key": key,
                    "component": cname,
                    "entity": entity,
                    "attribute": attr,
                    "fieldType": a.get("fieldType"),
                    "label": label,
                    "sources": [source],
                }
            )

    attrs.sort(key=lambda x: x["key"])
    return {"byActivityHint": ACTIVITY_HINTS, "attributes": attrs}


def write_csv(path: Path, components: list[dict]) -> None:
    rows: list[dict] = []
    for comp in components:
        cname = comp["component"]
        for rt in comp.get("ruleTypes") or []:
            rtid = rt.get("ruleTypeId")
            rtname = rt.get("name")
            for a in rt.get("attributes") or []:
                rows.append(
                    {
                        "component": cname,
                        "ruleTypeId": rtid,
                        "ruleTypeName": rtname,
                        "entity": a.get("entity"),
                        "attribute": a.get("attribute"),
                        "fieldType": a.get("fieldType"),
                        "label": a.get("label"),
                        "source": "ruleTypeAvailableAttributeXref",
                    }
                )
        for a in comp.get("catalogAttributes") or []:
            rows.append(
                {
                    "component": cname,
                    "ruleTypeId": "",
                    "ruleTypeName": "",
                    "entity": a.get("entity"),
                    "attribute": a.get("attribute"),
                    "fieldType": a.get("fieldType"),
                    "label": a.get("label"),
                    "source": "availableAttribute",
                }
            )
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "component",
                "ruleTypeId",
                "ruleTypeName",
                "entity",
                "attribute",
                "fieldType",
                "label",
                "source",
            ],
        )
        w.writeheader()
        w.writerows(rows)


def write_sample_inventory(path: Path) -> None:
    """Hand-seeded sample so the rule builder UI can develop offline."""
    sample = {
        "crawledAt": None,
        "org": "SS-DEMO",
        "source": "hand-seeded-sample",
        "note": "Replace by running: python scripts/crawl_rule_attributes.py --org SS-DEMO",
        "components": [
            {
                "component": "receiving",
                "ruleTypes": [
                    {
                        "ruleTypeId": "SAMPLE_ASN_RULE",
                        "name": "Sample ASN rule type",
                        "entities": [{"entityId": "asn"}, {"entityId": "lpnDetail"}],
                        "attributes": [
                            {
                                "attribute": "InventoryAttribute1",
                                "entity": "lpnDetail",
                                "fieldType": "string",
                                "label": "LPN Detail / InventoryAttribute1",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                            {
                                "attribute": "InventoryAttribute2",
                                "entity": "lpnDetail",
                                "fieldType": "string",
                                "label": "LPN Detail / InventoryAttribute2",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                            {
                                "attribute": "AsnStatus",
                                "entity": "asn",
                                "fieldType": "string",
                                "label": "ASN / AsnStatus",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                        ],
                    }
                ],
                "catalogAttributes": [],
                "entities": [{"entityId": "asn"}, {"entityId": "lpnDetail"}],
            },
            {
                "component": "dcorder",
                "ruleTypes": [
                    {
                        "ruleTypeId": "SAMPLE_ORDER_RULE",
                        "name": "Sample order rule type",
                        "entities": [{"entityId": "order"}, {"entityId": "orderLine"}],
                        "attributes": [
                            {
                                "attribute": "ItemAttribute1",
                                "entity": "orderLine",
                                "fieldType": "string",
                                "label": "Order Line / ItemAttribute1",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                            {
                                "attribute": "OrderType",
                                "entity": "order",
                                "fieldType": "string",
                                "label": "Order / OrderType",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                        ],
                    }
                ],
                "catalogAttributes": [],
                "entities": [{"entityId": "order"}, {"entityId": "orderLine"}],
            },
            {
                "component": "dcinventory",
                "ruleTypes": [
                    {
                        "ruleTypeId": "SAMPLE_ILPN_RULE",
                        "name": "Sample iLPN rule type",
                        "entities": [{"entityId": "ilpn"}],
                        "attributes": [
                            {
                                "attribute": "Status",
                                "entity": "ilpn",
                                "fieldType": "string",
                                "label": "iLPN / Status",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                            {
                                "attribute": "CurrentLocationId",
                                "entity": "ilpn",
                                "fieldType": "string",
                                "label": "iLPN / CurrentLocationId",
                                "source": "ruleTypeAvailableAttributeXref",
                            },
                        ],
                    }
                ],
                "catalogAttributes": [],
                "entities": [{"entityId": "ilpn"}],
            },
        ],
        "billingIndex": {},
        "errors": [],
    }
    sample["billingIndex"] = build_billing_index(sample["components"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sample, indent=2) + "\n", encoding="utf-8")
    write_csv(path.with_name("rule_inventory.csv"), sample["components"])
    path.with_name("crawl_errors.json").write_text("[]\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Crawl MAWM Rules Framework attributes")
    p.add_argument("--org", default="SS-DEMO", help="Organization id (default SS-DEMO)")
    p.add_argument(
        "--components",
        default="",
        help="Comma-separated component allowlist (default: billing-relevant set)",
    )
    p.add_argument(
        "--all-components",
        action="store_true",
        help="Crawl every component returned by fwuifacade list",
    )
    p.add_argument(
        "--no-catalog",
        action="store_true",
        help="Skip availableAttribute/entity catalog searches",
    )
    p.add_argument(
        "--seed-sample",
        action="store_true",
        help="Write hand-seeded sample inventory only (no MAWM calls)",
    )
    p.add_argument(
        "--token",
        default=None,
        help="Bearer access token (not including 'Bearer ')",
    )
    p.add_argument(
        "--token-file",
        default=None,
        help="Path to file with Bearer token (default: use .token if present)",
    )
    p.add_argument(
        "--verify",
        action="store_true",
        help="Verify token with a lightweight MAWM search before crawling",
    )
    p.add_argument(
        "--out-dir",
        default=str(OUT_DIR),
        help="Output directory (default data/rule_inventory)",
    )
    return p.parse_args(list(argv) if argv is not None else None)


def main(argv: Optional[Iterable[str]] = None) -> int:
    _load_dotenv()
    args = parse_args(argv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.seed_sample:
        write_sample_inventory(out_dir / "rule_inventory.json")
        print(f"Wrote sample inventory under {out_dir}")
        return 0

    org = args.org.strip().upper()
    token, source = resolve_token(
        org,
        token_arg=args.token,
        token_file=args.token_file,
        prefer_default_token_file=True,
    )
    if not token:
        print(
            "ERROR: No Bearer token found.\n"
            "  1. Paste a fresh access token into billingmgmt/.token and re-run, or\n"
            "  2. Pass --token-file PATH / --token TOKEN, or\n"
            "  3. Use --seed-sample for offline sample data.",
            file=sys.stderr,
        )
        return 1

    print(f"Auth source: {source} ({len(token)} chars)")
    if args.verify:
        if not verify_manhattan_token(org, token):
            print(
                "ERROR: Token verification failed. Refresh .token and try again.",
                file=sys.stderr,
            )
            return 1
        print("Token verified.")

    headers = manhattan_api_headers(org, token)
    errors: list[dict] = []

    discovered, list_err = list_components(headers)
    if list_err:
        errors.append({"step": "components/list", "error": list_err})
        print(f"WARN: component list failed: {list_err}", file=sys.stderr)

    if args.all_components:
        components = discovered or list(DEFAULT_COMPONENTS)
    elif args.components.strip():
        components = [c.strip().lower() for c in args.components.split(",") if c.strip()]
    else:
        components = list(DEFAULT_COMPONENTS)
        # Intersect with discovered when available
        if discovered:
            known = set(discovered)
            missing = [c for c in components if c not in known]
            if missing:
                print(f"WARN: allowlist components not in facade list: {missing}", file=sys.stderr)

    print(f"Crawling org={org} components={components}")
    crawled: list[dict] = []
    for comp in components:
        print(f"  → {comp} ...", flush=True)
        crawled.append(
            crawl_component(
                comp,
                headers,
                errors,
                include_catalog=not args.no_catalog,
            )
        )
        n_rt = len(crawled[-1].get("ruleTypes") or [])
        n_attr = sum(len(rt.get("attributes") or []) for rt in crawled[-1].get("ruleTypes") or [])
        print(f"     ruleTypes={n_rt} xrefAttrs={n_attr} catalog={len(crawled[-1].get('catalogAttributes') or [])}")

    inventory = {
        "crawledAt": datetime.now(timezone.utc).isoformat(),
        "org": org,
        "source": "live-crawl",
        "apiHost": API_HOST,
        "componentsRequested": components,
        "componentsDiscovered": discovered,
        "components": crawled,
        "billingIndex": build_billing_index(crawled),
        "errors": errors,
    }

    inv_path = out_dir / "rule_inventory.json"
    inv_path.write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    write_csv(out_dir / "rule_inventory.csv", crawled)
    (out_dir / "crawl_errors.json").write_text(json.dumps(errors, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {inv_path}")
    print(f"billingIndex.attributes: {len(inventory['billingIndex']['attributes'])}")
    print(f"errors: {len(errors)} → {out_dir / 'crawl_errors.json'}")
    return 0 if not (list_err and not crawled) else 2


if __name__ == "__main__":
    raise SystemExit(main())
