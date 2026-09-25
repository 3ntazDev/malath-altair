require('./env');
// خادم التطوير المحلي: ملفات public + نفس API الخاص بـVercel + Realtime عبر SSE
// DATABASE_URL=postgres://... npm run dev
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handler, auth } = require('../lib/api');
const realtime = require('../lib/realtime');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/realtime/stream' && realtime.sse) {
    try {
      const user = await auth({ headers: { authorization: `Bearer ${url.searchParams.get('token') || ''}` } });
      return realtime.sse.attach(user.id, res);
    } catch {
      res.statusCode = 401;
      return res.end();
    }
  }
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

if (require.main === module) server.listen(PORT, () => console.log(`🦅  ملاذ الطير — dev server → http://localhost:${PORT}  (realtime: ${realtime.name})`));
module.exports = { server };
