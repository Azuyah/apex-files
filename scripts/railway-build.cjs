const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const kind = String(process.env.APEX_SERVICE_KIND || process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();

if (kind.includes('backend')) {
  run('python', ['-m', 'pip', 'install', '-r', 'backend/requirements.txt']);
  process.exit(0);
}

run('npm', ['run', 'build']);
