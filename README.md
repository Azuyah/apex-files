# Apex Files

Standalone Windows/web app for tuner file builds, powered by Revtech services.

## Local development

1. Start Postgres:

```powershell
docker compose up -d postgres
```

2. Start the backend:

```powershell
cd backend
copy .env.example .env
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

3. Start the frontend:

```powershell
npm install
npm run dev
```

Set `REVTECH_SERVICE_TOKEN` to the Revtech `WORKER_TOKEN` value. The backend does not mock file delivery.
