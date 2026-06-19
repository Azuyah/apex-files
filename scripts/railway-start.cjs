const { spawnSync } = require('node:child_process');

const kind = String(process.env.APEX_SERVICE_KIND || process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const port = process.env.PORT || '8080';

const command = kind.includes('backend')
  ? `python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${port} --no-access-log --log-level info`
  : `npm run preview -- --host 0.0.0.0 --port ${port}`;

const result = spawnSync(command, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status || 0);
