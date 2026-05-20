#!/usr/bin/env node
/**
 * OEMポータル backend サーバ
 * - 静的ファイル配信
 * - /api/scrape-reviews POST: ASINリストを受け取り、scrape-reviews.js を起動
 * - /api/scrape-status GET: 現在のscrapeステータス返す
 * - /api/reviews/:asin GET: 取得済みレビューを返す
 *
 * 起動: node portal/server.js
 * URL:  http://localhost:8901/
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8901);
const PORTAL_DIR = __dirname;
const ROOT_DIR = path.join(__dirname, '..');
const REVIEWS_DIR = path.join(PORTAL_DIR, 'data', 'reviews');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

let scrapeProcess = null;

function readStatus() {
  const p = path.join(REVIEWS_DIR, '_status.json');
  if (!fs.existsSync(p)) return { state: 'idle' };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { state: 'idle' }; }
}

function jsonResp(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API: scrape status
  if (url.pathname === '/api/scrape-status') {
    return jsonResp(res, 200, readStatus());
  }

  // API: get reviews for asin
  if (url.pathname.startsWith('/api/reviews/')) {
    const asin = url.pathname.split('/').pop().replace(/[^A-Za-z0-9]/g, '');
    const fp = path.join(REVIEWS_DIR, `${asin}.json`);
    if (!fs.existsSync(fp)) return jsonResp(res, 404, { error: 'not scraped yet' });
    return jsonResp(res, 200, JSON.parse(fs.readFileSync(fp, 'utf8')));
  }

  // API: trigger scrape
  if (url.pathname === '/api/scrape-reviews' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let asins = [];
      try {
        const data = JSON.parse(body || '{}');
        asins = (data.asins || []).filter((a) => /^[A-Z0-9]{8,12}$/i.test(a));
      } catch (e) {
        return jsonResp(res, 400, { error: 'invalid body' });
      }
      if (!asins.length) return jsonResp(res, 400, { error: 'no valid asins' });

      // 既に実行中ならエラー
      const cur = readStatus();
      if (cur.state === 'running') {
        return jsonResp(res, 409, { error: 'already running', status: cur });
      }

      const arg = asins.join(',');
      const scriptPath = path.join(ROOT_DIR, 'scripts', 'scrape-reviews-full.js');
      console.log(`[server] starting scrape: ${arg}`);
      scrapeProcess = spawn('node', [scriptPath, arg], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      scrapeProcess.stdout.on('data', (d) => process.stdout.write(`[scrape] ${d}`));
      scrapeProcess.stderr.on('data', (d) => process.stderr.write(`[scrape-err] ${d}`));
      scrapeProcess.on('exit', (code) => {
        console.log(`[server] scrape exited with code ${code}`);
        scrapeProcess = null;
      });

      return jsonResp(res, 202, { state: 'started', asins, total: asins.length });
    });
    return;
  }

  // API: deep-dive on demand
  if (url.pathname === '/api/build-deepdive' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let catId = null;
      try { catId = String(JSON.parse(body || '{}').categoryId || ''); } catch { return jsonResp(res, 400, { error: 'invalid body' }); }
      if (!/^\d+$/.test(catId)) return jsonResp(res, 400, { error: 'invalid categoryId' });
      const existing = path.join(PORTAL_DIR, `deepdive-${catId}.html`);
      if (fs.existsSync(existing)) {
        return jsonResp(res, 200, { state: 'cached', url: `/deepdive-${catId}.html` });
      }
      const scriptPath = path.join(ROOT_DIR, 'scripts', 'build-deepdive.js');
      console.log(`[server] building deepdive: ${catId}`);
      const p = spawn('node', [scriptPath, catId], { cwd: ROOT_DIR });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      p.on('exit', (code) => {
        if (code === 0 && fs.existsSync(existing)) {
          jsonResp(res, 200, { state: 'built', url: `/deepdive-${catId}.html` });
        } else {
          jsonResp(res, 500, { error: stderr.slice(0, 500) || `exit ${code}` });
        }
      });
    });
    return;
  }

  // Static files
  let filePath = path.join(PORTAL_DIR, url.pathname === '/' ? '/index.html' : url.pathname);
  if (!filePath.startsWith(PORTAL_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`OEM portal server: http://localhost:${PORT}/`);
});
