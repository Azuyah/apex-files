# Railway setup

Project: `Apex Files`

Project id: `e6b827bb-77db-4528-b68d-1154d595a2b1`

Repository: `Azuyah/apex-files`

Branch: `main`

## Services

Create or verify these services in the Railway project.

| Service | Source | Root directory | Config file |
| --- | --- | --- | --- |
| `apex-files-frontend` | GitHub repo | `/` | `railway.json` |
| `apex-files-backend` | GitHub repo | `/backend` | `backend/railway.json` |
| `apex-files-postgres` | Railway Postgres | n/a | n/a |

## Backend variables

Set on `apex-files-backend`.

```text
APP_ENV=production
APP_SECRET=<random-production-secret>
DATABASE_URL=${{apex-files-postgres.DATABASE_URL}}
CORS_ORIGINS=<frontend-domain>,http://localhost:5173,http://127.0.0.1:5173,null
STORAGE_ROOT=/app/storage
REVTECH_INTEGRATION_MODE=revtech
REVTECH_API_BASE_URL=https://files.revtechfiles.com/api/proxy
REVTECH_SERVICE_TOKEN=<copy RevTech WORKER_TOKEN>
REVTECH_TIMEOUT_SECONDS=600
```

`REVTECH_SERVICE_TOKEN` should use the RevTech backend `WORKER_TOKEN`, because RevTech accepts that bearer token as an owner-level service principal.

## Frontend variables

Set on `apex-files-frontend`.

```text
VITE_API_BASE_URL=<backend-domain>/api
```

## CLI sequence after Railway login

```powershell
railway link --project e6b827bb-77db-4528-b68d-1154d595a2b1 --environment production
railway add --database postgres --service apex-files-postgres
railway add --service apex-files-backend --repo Azuyah/apex-files
railway add --service apex-files-frontend --repo Azuyah/apex-files
railway domain --service apex-files-backend
railway domain --service apex-files-frontend
```

Then set the variables above and verify both services are deploying from `main`.
