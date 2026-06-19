const { spawnSync } = require('node:child_process');

const kind = String(process.env.APEX_SERVICE_KIND || process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const port = process.env.PORT || '8080';

const [command, args] = kind.includes('backend')
  ? [
      'python',
      [
        '-m',
        'uvicorn',
        'app.main:app',
        '--app-dir',
        'backend',
        '--host',
        '0.0.0.0',
        '--port',
        port,
        '--no-access-log',
        '--log-level',
        'info',
      ],
    ]
  : ['node', ['scripts/static-server.cjs']];

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

process.exit(result.status || 0);
