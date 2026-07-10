"""
Build stripped Receive activity samples from a raw activity-search JSON file.

  python scripts/extract_receiving_samples.py --input path/to/activity_search.json

If --input is omitted, refreshes metadata only when data/samples/activity_receiving.json
already exists (does not invent rows).
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "samples" / "activity_receiving.json"

WANTED = [
    "Receiving",
    "Receive-Dock Door",
    "Receive-Disposition",
    "Receive Returns",
    "Mobile Receive Returns",
    "Blind Receipt",
    "Receive-Crossdock",
    "Receive LPN Level",
]
PER_TXN = 2


def strip(r: dict) -> dict:
    return {k: v for k, v in r.items() if k not in ("headers", "Messages")}


def pick_samples(results: list[dict]) -> list[dict]:
    receive = [strip(r) for r in results if r.get("TransactionTypeId") == "Receive"]
    by_tid: dict[str | None, list] = defaultdict(list)
    for r in receive:
        by_tid[r.get("TransactionId")].append(r)

    samples: list[dict] = []
    for tid in WANTED:
        samples.extend(by_tid.get(tid, [])[:PER_TXN])

    if len(samples) < 8:
        have = {(s.get("TransactionId"), s.get("businessKeyForElastic")) for s in samples}
        for r in receive:
            key = (r.get("TransactionId"), r.get("businessKeyForElastic"))
            if key in have:
                continue
            samples.append(r)
            have.add(key)
            if len(samples) >= 12:
                break
    return samples, len(receive)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        help="Raw activity search JSON (with data.Results)",
    )
    args = parser.parse_args()
    if not args.input:
        raise SystemExit("Pass --input path/to/activity_search.json")

    payload_in = json.loads(Path(args.input).read_text(encoding="utf-8"))
    results = payload_in.get("data", {}).get("Results") or payload_in.get("Results") or []
    samples, total_receive = pick_samples(results)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "description": (
            "Stripped Receive activity samples (headers/Messages removed). "
            "For local billing dry-run only — not live environment data."
        ),
        "source": {
            "facilityId": samples[0].get("FacilityId") if samples else None,
            "transactionTypeId": "Receive",
            "totalReceiveInDump": total_receive,
            "sampleCount": len(samples),
        },
        "Results": samples,
    }
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(samples)} samples -> {OUT}")
    for r in samples:
        print(
            f"  {str(r.get('TransactionId')):28} AsnId={r.get('AsnId')} "
            f"ContainerId={r.get('ContainerId')} Qty={r.get('Quantity')}"
        )


if __name__ == "__main__":
    main()
