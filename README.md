# Billing Management (billingmgmt)

Configurable warehouse billing rules browser and editor. View and edit client activities, rate cards, transaction/storage rules, bill-to codes, and billing log definitions scoped by **Facility → Business Unit → Client**.

Live app: [billingmgmt.vercel.app](https://billingmgmt.vercel.app) (after Vercel setup)

## Features (v0.1.0)

- MAWM ORG authentication (same as Flowthrough / Inspection)
- Scope picker: Facility, Business Unit, Client
- Tabbed configuration editor with search
- Export / Import JSON (local draft)
- **Save & Deploy** — commits `config/orgs/{ORG}.json` to GitHub; Vercel redeploys
- **Conditional rule builder** — `chargeType: conditionalPer` with attribute branches (uses `data/rule_inventory/`)
- Default demo data in `data/defaults/billing.default.json`
- No database — all config in JSON files

## Local development

```bash
cd billingmgmt
npm install
pip install -r requirements.txt
vercel dev
```

Open `http://localhost:3000`. Set env vars from `.env.example` (or link Vercel env with `vercel env pull`).

## Project layout

```
billingmgmt/
├── index.html
├── public/           # app.js, config-ui.js, config-admin.js, shared.css
├── api/index.py      # Flask API
├── scripts/
│   └── crawl_rule_attributes.py   # MAWM Rules Framework attribute crawler
├── data/
│   ├── defaults/                  # Shipped demo config
│   └── rule_inventory/            # Crawled / seeded attribute inventory
├── config/orgs/      # Per-ORG overrides (Save & Deploy)
├── billing_config_service.py
├── mawm_client.py
├── server.js
└── vercel.json
```

## Rule attribute inventory (crawler)

Discovers MAWM Rules Framework components → rule types → entities/attributes for the future rule builder.

Auth uses a refreshable **`.token`** file (same pattern as flowthrough `create_asns.py`). Paste a fresh access token into `billingmgmt/.token` (gitignored) when it expires.

```bash
# Offline sample (already under data/rule_inventory/)
python scripts/crawl_rule_attributes.py --seed-sample

# Live crawl — reads ./.token by default
python scripts/crawl_rule_attributes.py --org SS-DEMO
python scripts/crawl_rule_attributes.py --org SS-DEMO --verify
python scripts/crawl_rule_attributes.py --org SS-DEMO --all-components
```

Auth priority: `--token-file` → `--token` → `./.token` → OAuth env vars (optional fallback).

Outputs: `data/rule_inventory/rule_inventory.json`, `rule_inventory.csv`, `crawl_errors.json`.

Cross-reference real object fields/statuses in the sibling library: `../mawm_api_library/`.

## URL parameters

| Parameter | Effect |
|-----------|--------|
| `Organization` | Pre-fill ORG and auto-authenticate |

Example: `https://billingmgmt.vercel.app/?Organization=SS-DEMO`
