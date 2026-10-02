// Seeds Congress — Guess Who
// Zero-dependency Node server.  `/` = game, `/admin` = editor.
// Run:  node server.js        (Node 18+)
// Env:  PORT (default 3000), ADMIN_PASSWORD (if unset, a random one is printed at startup)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
const DATA_FILE = path.join(ROOT, 'data', 'data.json');
const UA = 'SeedsCongressGuessWho/1.0 (event game; contact via seedsofleadership.ca)';

fs.mkdirSync(UPLOADS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const tokens = new Set();

function readData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeData(d) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function isAuthed(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') && tokens.has(h.slice(7));
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}

function safeJoin(base, p) {
  const full = path.normalize(path.join(base, decodeURIComponent(p)));
  return full.startsWith(base) ? full : null;
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'img'; }

function extFromType(t) {
  if (/png/.test(t)) return '.png';
  if (/webp/.test(t)) return '.webp';
  if (/gif/.test(t)) return '.gif';
  if (/svg/.test(t)) return '.svg';
  return '.jpg';
}

async function downloadImage(url, nameHint) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('Image download failed (' + r.status + ')');
  const type = r.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error('URL is not an image');
  const buf = Buffer.from(await r.arrayBuffer());
  const file = slug(nameHint) + '-' + crypto.randomBytes(3).toString('hex') + extFromType(type);
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return '/uploads/' + file;
}

// Look up a person on Wikipedia → { title, description, imageUrl, pageUrl }
async function wikiQuery(params) {
  const api = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', redirects: '1',
    prop: 'pageimages|description|info', piprop: 'thumbnail|original', pithumbsize: '800', inprop: 'url', ...params,
  });
  const r = await fetch(api, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('Wikipedia lookup failed (' + r.status + ')');
  const j = await r.json();
  return (j.query && j.query.pages ? Object.values(j.query.pages) : []).filter(p => !('missing' in p));
}

async function wikiLookup(query) {
  // Accept a full Wikipedia URL, an exact title, or a loose search.
  const m = /wikipedia\.org\/wiki\/([^?#]+)/.exec(query);
  const title = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : query.trim();
  let pages = await wikiQuery({ titles: title });
  if (!pages.length) pages = await wikiQuery({ generator: 'search', gsrsearch: title, gsrlimit: '1' });
  if (!pages.length) throw new Error('No Wikipedia page found for "' + query + '"');
  const p = pages[0];
  const img = (p.thumbnail && p.thumbnail.source) || (p.original && p.original.source);
  if (!img) throw new Error('"' + p.title + '" has no main image on Wikipedia');
  return { title: p.title, description: p.description || '', imageUrl: img, pageUrl: p.fullurl };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // ---------- API ----------
    if (p === '/api/data' && req.method === 'GET') {
      const d = readData();
      // Public view never exposes anything admin-only (there is none stored here, but keep the boundary).
      return send(res, 200, d);
    }
    if (p === '/api/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (password !== ADMIN_PASSWORD) return send(res, 401, { error: 'Wrong password' });
      const t = crypto.randomBytes(24).toString('hex');
      tokens.add(t);
      return send(res, 200, { token: t });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAuthed(req)) return send(res, 401, { error: 'Not signed in' });

      if (p === '/api/admin/check') return send(res, 200, { ok: true });
      if (p === '/api/admin/data' && req.method === 'PUT') {
        const d = await readBody(req);
        if (!Array.isArray(d.people) || !Array.isArray(d.questions) || typeof d.settings !== 'object')
          return send(res, 400, { error: 'Invalid data' });
        writeData(d);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/upload' && req.method === 'POST') {
        const { dataUrl, name } = await readBody(req);
        const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || '');
        if (!m) return send(res, 400, { error: 'Not an image' });
        const file = slug(name) + '-' + crypto.randomBytes(3).toString('hex') + extFromType(m[1]);
        fs.writeFileSync(path.join(UPLOADS, file), Buffer.from(m[2], 'base64'));
        return send(res, 200, { image: '/uploads/' + file });
      }
      if (p === '/api/admin/wiki' && req.method === 'POST') {
        const { query } = await readBody(req);
        const info = await wikiLookup(query);
        const image = await downloadImage(info.imageUrl, info.title);
        return send(res, 200, { ...info, image });
      }
      if (p === '/api/admin/image-url' && req.method === 'POST') {
        const { url: imgUrl, name } = await readBody(req);
        const image = await downloadImage(imgUrl, name || 'image');
        return send(res, 200, { image });
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }

    // ---------- Pages & static ----------
    if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(PUBLIC, 'admin.html'));
    if (p.startsWith('/uploads/')) {
      const f = safeJoin(UPLOADS, p.slice('/uploads/'.length));
      return f ? serveFile(res, f) : send(res, 403, 'Forbidden', 'text/plain');
    }
    const f = safeJoin(PUBLIC, p.slice(1));
    if (f && f !== path.join(PUBLIC, 'admin.html')) return serveFile(res, f);
    return send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    return send(res, 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Guess Who running:  http://localhost:${PORT}   (admin: http://localhost:${PORT}/admin)`);
    if (!process.env.ADMIN_PASSWORD) console.log(`Admin password (random, changes each restart): ${ADMIN_PASSWORD}
Set ADMIN_PASSWORD to choose your own.`);
  });
}

module.exports = { wikiLookup, downloadImage };
