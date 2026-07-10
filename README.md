# Billing Management (billingmgmt)

Configurable warehouse billing rules browser and editor. View and edit client activities, rate cards, transaction/storage rules, bill-to codes, and billing log definitions scoped by **Facility → Business Unit → Client**.

Live app: [billingmgmt.vercel.app](https://billingmgmt.vercel.app) (after Vercel setup)

## Features (v0.1.0)

- MAWM ORG authentication (same as Flowthrough / Inspection)
- Scope picker: Facility, Business Unit, Client
- Tabbed configuration editor with search
- Export / Import JSON (local draft)
- **Save & Deploy** — commits `config/orgs/{ORG}.json` to GitHub; Vercel redeploys
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
├── data/defaults/    # Shipped demo config
├── config/orgs/      # Per-ORG overrides (Save & Deploy)
├── billing_config_service.py
├── mawm_client.py
├── server.js
└── vercel.json
```

## URL parameters

| Parameter | Effect |
|-----------|--------|
| `Organization` | Pre-fill ORG and auto-authenticate |

Example: `https://billingmgmt.vercel.app/?Organization=SS-DEMO`
