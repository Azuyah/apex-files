const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT || 8080);
const root = path.resolve(__dirname, '..', 'app-dist');
const serviceKind = String(process.env.APEX_SERVICE_KIND || process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const isAdminService = serviceKind.includes('admin');

const securityHeaders = {
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://apex-files-backend-production.up.railway.app http://127.0.0.1:* http://localhost:*",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, {
        ...securityHeaders,
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      ...securityHeaders,
      'content-type': types[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': filePath.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const decodedPath = decodeURIComponent(url.pathname);

  if (!isAdminService && /^\/admin(?:\/|$)/i.test(decodedPath)) {
    response.writeHead(404, {
      ...securityHeaders,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('Not found');
    return;
  }

  const requested = path.resolve(root, `.${decodedPath}`);
  const indexPath = path.join(root, 'index.html');

  if (!requested.startsWith(root)) {
    response.writeHead(400, { ...securityHeaders, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  fs.stat(requested, (error, stat) => {
    if (!error && stat.isFile()) {
      sendFile(response, requested);
      return;
    }
    sendFile(response, indexPath);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Apex Files frontend listening on 0.0.0.0:${port}`);
});
