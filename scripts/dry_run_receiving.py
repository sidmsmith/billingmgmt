"""
Dry-run: apply DEMO-RECV receiving rules to sample activity rows.

  python scripts/dry_run_receiving.py

Reads:
  data/samples/activity_receiving.json
  data/defaults/billing.default.json  (client DEMO-RECV under SS-DEMO-DM1 / DM1)
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "data" / "samples" / "activity_receiving.json"
DEFAULTS = ROOT / "data" / "defaults" / "billing.default.json"

FACILITY = "SS-DEMO-DM1"
BU = "DM1"
CLIENT = "DEMO-RECV"


def get_path(obj: dict, path: str):
    """Resolve a simple dotted path (no array wildcards)."""
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def resolve_field(txn: dict, ref: dict | None):
    if not ref:
        return None
    obj = ref.get("object") or "activity"
    path = ref.get("path")
    if not path:
        return None
    if obj == "activity":
        return get_path(txn, path)
    # Future: enriched objects keyed on txn
    enriched = txn.get("_enriched") or {}
    source = enriched.get(obj) or txn
    return get_path(source, path)


def match_condition(txn: dict, cond: dict) -> bool:
    # New style: object/path; legacy: field
    if "path" in cond or "object" in cond:
        left = resolve_field(txn, cond)
    else:
        left = txn.get(cond.get("field"))
    op = (cond.get("operator") or "eq").lower()
    right = cond.get("value")
    if op == "eq":
        return left == right
    if op == "in":
        if isinstance(right, str):
            options = [x.strip() for x in right.split(",") if x.strip()]
        else:
            options = list(right or [])
        return left in options
    if op == "ne":
        return left != right
    if op == "exists":
        return left is not None
    return False


def match_rule(txn: dict, rule: dict) -> bool:
    if not rule.get("active", True):
        return False
    conds = rule.get("conditions") or []
    if not conds:
        return True
    return all(match_condition(txn, c) for c in conds)


def charge_units(txn: dict, rule: dict) -> float:
    col = rule.get("chargeColumn") or {}
    path = col.get("path") or ""
    val = resolve_field(txn, col)
    # Numeric charge columns (Quantity) multiply; ids count as 1
    if path.lower() == "quantity" or isinstance(val, (int, float)):
        try:
            return float(val)
        except (TypeError, ValueError):
            return 0.0
    return 1.0 if val is not None else 0.0


def find_client(config: dict) -> dict:
    for fac in config.get("facilities") or []:
        if fac.get("id") != FACILITY:
            continue
        for bu in fac.get("businessUnits") or []:
            if bu.get("id") != BU:
                continue
            for client in bu.get("clients") or []:
                if client.get("id") == CLIENT:
                    return client
    raise SystemExit(f"Client {CLIENT} not found under {FACILITY}/{BU}")


def main() -> None:
    samples = json.loads(SAMPLES.read_text(encoding="utf-8"))
    config = json.loads(DEFAULTS.read_text(encoding="utf-8"))
    client = find_client(config)
    rules = client.get("rulesTransaction") or []
    rates = {r["id"]: r for r in client.get("rateCards") or []}
    txns = samples.get("Results") or []

    print(f"Client {CLIENT} - {len(txns)} sample txns, {len(rules)} rules\n")
    charges = []
    for txn in txns:
        for rule in rules:
            if not match_rule(txn, rule):
                continue
            rc = rates.get(rule.get("rateCardId") or "")
            if not rc:
                continue
            units = charge_units(txn, rule)
            if units <= 0:
                continue
            rate = float(rc.get("rate") or 0)
            amount = round(rate * units, 4)
            col = rule.get("chargeColumn") or {}
            charges.append(
                {
                    "ruleId": rule["id"],
                    "ruleName": rule.get("name"),
                    "transactionId": txn.get("TransactionId"),
                    "asnId": txn.get("AsnId"),
                    "containerId": txn.get("ContainerId"),
                    "chargeColumn": f"{col.get('object')}.{col.get('path')}",
                    "chargeValue": resolve_field(txn, col),
                    "units": units,
                    "rate": rate,
                    "amount": amount,
                    "uom": rc.get("uom"),
                    "activityDateTime": txn.get("ActivityDateTime"),
                }
            )

    for c in charges:
        print(
            f"{c['ruleId']:22} {c['transactionId']:24} "
            f"{c['chargeColumn']}={c['chargeValue']}  "
            f"{c['units']} x ${c['rate']} = ${c['amount']:.2f}"
        )

    by_rule: dict[str, float] = {}
    for c in charges:
        by_rule[c["ruleId"]] = by_rule.get(c["ruleId"], 0) + c["amount"]
    print("\n--- Totals ---")
    for rid, total in by_rule.items():
        print(f"  {rid}: ${total:.2f}")
    print(f"  ALL: ${sum(by_rule.values()):.2f}")
    print(f"\nCharge lines: {len(charges)}")


if __name__ == "__main__":
    main()
