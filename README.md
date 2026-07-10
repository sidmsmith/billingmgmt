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

The Rules Framework crawler (`scripts/crawl_rule_attributes.py`) discovers MAWM **rule-type** attributes. It is **not** the primary source for the billing rule builder dropdowns.

**Billing rule fields** come from the object field catalog (ASN, PO, iLPN, Order, …) under `data/field_catalog/`, snapshotted from `../mawm_api_library`. Regenerate with:

```bash
python ../mawm_api_library/_scripts/generate_field_catalogs.py
```

### Rule builder concepts (legacy BM aligned)

- **Charge Type** — per / fixed / tier / conditionalPer / …
- **Charge Column** — what to count or group (`ASN.AsnId`, `iLPN.IlpnId`, …)
- **Charge Sum Type** — line / transaction / transactionByChargeColumn / …
- **Conditions / branches** — optional filters on the same catalog fields

### Future engine sketch

1. Pull WM **activity transaction log** for a date range  
2. Enrich each txn via search APIs + domain joins  
3. Evaluate client rules (charge column + conditions + rate)  
4. Write billing charge records  

Auth for live crawls still uses refreshable **`.token`** (same as flowthrough).

```bash
python scripts/crawl_rule_attributes.py --seed-sample
python scripts/crawl_rule_attributes.py --org SS-DEMO --verify
```

Cross-reference APIs/statuses: `../mawm_api_library/`.

## URL parameters

| Parameter | Effect |
|-----------|--------|
| `Organization` | Pre-fill ORG and auto-authenticate |

Example: `https://billingmgmt.vercel.app/?Organization=SS-DEMO`
