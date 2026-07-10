# Billingmgmt — Web App (Vercel)

**Version 0.1.0** — Warehouse billing configuration management.

Repository: [github.com/sidmsmith/billingmgmt](https://github.com/sidmsmith/billingmgmt)

## Deploy to Vercel

1. Import the GitHub repo in Vercel (root directory = repo root).
2. Set environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `MANHATTAN_PASSWORD` | Yes | MAWM auth |
| `MANHATTAN_SECRET` | Yes | MAWM auth |
| `GITHUB_TOKEN` | Yes (for Save & Deploy) | Personal access token with `repo` scope |
| `GITHUB_REPO` | Yes | `sidmsmith/billingmgmt` |
| `GITHUB_REF` | No | Default `main` |
| `MANHATTAN_USAGE_INGEST_URL` | No | Usage dashboard |

3. Deploy. Vercel will rebuild automatically when Save & Deploy commits to `main`.

## Configuration workflow

1. Authenticate with ORG.
2. Select Facility → Business Unit → Client.
3. Edit rules in the UI (changes stay in browser memory).
4. **Export** — download JSON backup (optional).
5. **Save & Deploy** — writes `config/orgs/{ORG}.json` to GitHub; wait ~1 minute for redeploy.

UI preferences (last scope/tab) are stored in `localStorage` only.

## Local dev

```bash
npm install
pip install -r requirements.txt
vercel dev
```

## Apps homepage

After deploy, add an entry to `apps_homepage/api/index.py` with the live URL.
