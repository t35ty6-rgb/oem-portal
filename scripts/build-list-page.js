#!/usr/bin/env node
/**
 * 「車＆バイク」配下のサブカテゴリ一覧 HTMLレポートを生成。
 * categories.json から該当カテゴリ抽出 → 1行ずつ並べた表形式 HTML。
 *
 * 出力: portal/subcategory-list-bike.html (静的、データ埋込)
 * クリックで個別レポートページへ遷移できる構造。
 */
const fs = require('fs');
const path = require('path');

// 引数からL1指定（指定なしなら全L1自動生成）
const ARG_L1 = process.argv[2];
const DATA_PATH = path.join(__dirname, '..', 'data', 'categories.json');
const PRODUCTS_DIR = path.join(__dirname, '..', '..', 'data', 'bestseller-products');
const DETAILS_DIR = path.join(PRODUCTS_DIR, 'details');
const KEEPA_DIR = path.join(PRODUCTS_DIR, 'keepa');

function loadDetail(asin) {
  const p = path.join(DETAILS_DIR, `${asin}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function loadKeepa(asin) {
  const p = path.join(KEEPA_DIR, `${asin}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const REVIEWS_DIR = path.join(__dirname, '..', 'data', 'reviews');

// 横断ヒット情報をプリロード (top1 ASIN → 何カテゴリで上位5入り？)
const _crossHitCache = (() => {
  const counts = {};
  const dirCheck = PRODUCTS_DIR;
  if (!fs.existsSync(dirCheck)) return counts;
  for (const f of fs.readdirSync(dirCheck)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const ps = JSON.parse(fs.readFileSync(path.join(dirCheck, f), 'utf8')).products || [];
      for (let i = 0; i < Math.min(5, ps.length); i++) {
        if (ps[i].asin) counts[ps[i].asin] = (counts[ps[i].asin] || 0) + 1;
      }
    } catch {}
  }
  return counts;
})();
function crossHitCount(asin) { return _crossHitCache[asin] || 0; }
function reviewStatus(asins) {
  // top5 ASIN のレビュー取得状況: { total: N, totalReviews: M }
  let total = 0, totalReviews = 0;
  for (const a of asins.slice(0, 5)) {
    const fp = path.join(REVIEWS_DIR, `${a}.json`);
    if (fs.existsSync(fp)) {
      try {
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (d.reviewCount > 0) { total++; totalReviews += d.reviewCount; }
      } catch {}
    }
  }
  return { count: total, totalReviews };
}

function priceToNumber(s) {
  if (typeof s === 'number') return s;
  if (!s) return null;
  const m = String(s).replace(/[,，]/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// BSR順位から月販個数を推定（scoring.jsと同じ式）
function estimateMonthlyFromBsr(bsr) {
  if (!bsr || bsr <= 0) return null;
  if (bsr <= 10) return 3000;
  if (bsr <= 100) return 1500;
  if (bsr <= 500) return 600;
  if (bsr <= 1000) return 300;
  if (bsr <= 5000) return 100;
  if (bsr <= 10000) return 50;
  if (bsr <= 50000) return 15;
  if (bsr <= 100000) return 5;
  if (bsr <= 500000) return 2;
  return 1;
}

function loadProducts(id) {
  const p = path.join(PRODUCTS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const ps = (JSON.parse(fs.readFileSync(p, 'utf8')).products || []);
    return ps.map((prod) => {
      const d = loadDetail(prod.asin);
      const merged = {
        ...prod,
        priceNum: priceToNumber(prod.price),
      };
      if (d) {
        merged.brand = d.brand;
        merged.overview = d.overview;
        merged.features = (d.features || []).slice(0, 4);
        merged.bsr = d.bsr;
        merged.gallery = (d.images || []).slice(0, 5);
        merged.monthlyBought = d.monthlyBought;
        merged.boughtText = d.boughtText;
        if (!merged.priceNum && d.priceText) merged.priceNum = priceToNumber(d.priceText);
      }
      // Keepa データを上書きマージ（Amazon scraping より信頼性高い）
      const k = loadKeepa(prod.asin);
      if (k) {
        if (k.monthlySold) merged.keepaMonthlySold = k.monthlySold;
        if (k.currentBsr && k.currentBsr > 0) merged.keepaBsr = k.currentBsr;
        if (k.currentPrice && k.currentPrice > 0) {
          merged.keepaPrice = k.currentPrice / 100; // Keepaは銭単位
          if (!merged.priceNum) merged.priceNum = merged.keepaPrice;
        }
        if (k.brand && !merged.brand) merged.brand = k.brand;
        if (k.rating) merged.keepaRating = k.rating;
        if (k.reviewCount) merged.keepaReviews = k.reviewCount;
      }
      // 月販個数: Keepa monthlySold > Amazon monthlyBought > BSR推定
      if (merged.keepaMonthlySold) {
        merged.monthlyBoughtFinal = merged.keepaMonthlySold;
        merged.monthlyBoughtSource = 'keepa';
      } else if (merged.monthlyBought) {
        merged.monthlyBoughtFinal = merged.monthlyBought;
        merged.monthlyBoughtSource = 'badge';
      } else {
        const bsr = merged.keepaBsr || merged.bsr?.[0]?.rank;
        if (bsr) {
          const est = estimateMonthlyFromBsr(bsr);
          if (est) {
            merged.monthlyBoughtFinal = est;
            merged.monthlyBoughtSource = 'bsr-est';
          }
        }
      }
      // 月商: 価格 × 月販個数
      if (merged.priceNum && merged.monthlyBoughtFinal) {
        merged.monthlyRevenue = merged.priceNum * merged.monthlyBoughtFinal;
      }
      return merged;
    });
  } catch { return null; }
}

const L1_SLUG = {
  'ホーム＆キッチン':       'home-kitchen',
  'スポーツ＆アウトドア':   'sports-outdoor',
  '車＆バイク':             'auto-bike',
  'ベビー＆マタニティ':     'baby-maternity',
  'ビューティー':           'beauty',
  'ドラッグストア':         'drugstore',
  '家電＆カメラ':           'electronics',
  'パソコン・周辺機器':     'pc-peripherals',
  '楽器・音響機器':         'instruments',
  'DIY・工具・ガーデン':    'diy',
  'おもちゃ':               'toys',
  'ファッション':           'fashion',
  'ペット用品':             'pet-supplies',
  'ホビー':                 'hobby',
  '大型家電':               'appliances',
  '文房具・オフィス用品':   'office',
  '産業・研究開発用品':     'industrial',
  '食品・飲料・お酒':       'food',
};

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n, prefix = '') {
  if (n == null || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return '-';
  return prefix + num.toLocaleString();
}
function fmtPct(n) {
  if (n == null || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return '-';
  return (num * 100).toFixed(0) + '%';
}

function recoBadge(r) {
  if (!r) return '';
  if (r.includes('強推奨') || r.includes('おすすめ')) return '<span class="b green">🟢 おすすめ</span>';
  if (r.includes('検討') || r.includes('ありかも')) return '<span class="b yellow">🟡 ありかも</span>';
  if (r.includes('保留') || r.includes('様子見')) return '<span class="b gray">⚪ 様子見</span>';
  if (r.includes('月商不足') || r.includes('規模小さい')) return '<span class="b lite">❌ 規模小さい</span>';
  if (r.includes('寡占強') || r.includes('独占')) return '<span class="b red">❌ 1社独占</span>';
  if (r.includes('待機') || r.includes('未調査')) return '<span class="b lite">⏳ 未調査</span>';
  return `<span class="b lite">${esc(r)}</span>`;
}
function tagBadge(t) {
  if (!t) return '';
  if (t.includes('群雄') || t.includes('拮抗') || t.includes('分散')) return `<span class="b green">${esc(t)}</span>`;
  if (t.includes('中間') || t.includes('普通')) return `<span class="b gray">${esc(t)}</span>`;
  if (t.includes('二強') || t.includes('2社') || t.includes('寡占')) return `<span class="b orange">${esc(t)}</span>`;
  if (t.includes('一強') || t.includes('1社')) return `<span class="b red">${esc(t)}</span>`;
  return `<span class="b lite">${esc(t)}</span>`;
}
function scoreBar(score) {
  if (score == null || score === '') return '-';
  const s = Number(score);
  if (isNaN(s)) return '-';
  const color = s >= 70 ? '#66bb6a' : s >= 50 ? '#fdd835' : s >= 30 ? '#fb8c00' : '#e57373';
  return `<div class="sb"><div class="sb-bar"><div class="sb-fill" style="width:${Math.max(0, Math.min(100, s))}%;background:${color}"></div></div><span class="sb-num">${s}</span></div>`;
}

function buildNavbar(currentL1) {
  const tabs = Object.entries(L1_SLUG).map(([name, slug]) => {
    const active = name === currentL1 ? ' active' : '';
    return `<a class="nav-tab${active}" href="subcategory-list-${slug}.html">${esc(name)}</a>`;
  }).join('');
  return `<nav class="topnav">
  <a class="nav-home" href="index-l1.html">🏠 トップ</a>
  <div class="nav-tabs">${tabs}</div>
  <a class="nav-marked" href="marked.html" style="background:#fbbf24;color:#1f2937;padding:8px 14px;text-decoration:none;font-weight:700;font-size:12px;white-space:nowrap;display:flex;align-items:center">⭐ マーク済み</a>
  <a class="nav-cross" href="cross-category-hits.html" style="background:#a78bfa;color:white;padding:8px 14px;text-decoration:none;font-weight:700;font-size:12px;white-space:nowrap;display:flex;align-items:center">🎯 横断ヒット</a>
  <a class="nav-dashboard" href="dashboard.html">📊 ダッシュボード</a>
</nav>`;
}

function buildPrevNextFooter(currentL1) {
  const names = Object.keys(L1_SLUG);
  const i = names.indexOf(currentL1);
  const prev = i > 0 ? names[i - 1] : null;
  const next = i >= 0 && i < names.length - 1 ? names[i + 1] : null;
  const link = (label, name) => name
    ? `<a class="step-link" href="subcategory-list-${L1_SLUG[name]}.html">${label} ${esc(name)}</a>`
    : '<span class="step-link disabled"></span>';
  return `<div class="step-nav">
  ${link('← 前のL1', prev)}
  <a class="step-link step-home" href="index-l1.html">🏠 トップに戻る</a>
  ${link('次のL1 →', next)}
</div>`;
}

function buildOne(targetL1, data) {
  const slug = L1_SLUG[targetL1] || targetL1.replace(/[^a-zA-Z0-9]/g, '');
  const outPath = path.join(__dirname, '..', `subcategory-list-${slug}.html`);
  const cats = data.categories.filter((c) => c.l1Root === targetL1);
  if (cats.length === 0) {
    console.log(`SKIP: ${targetL1} (0件)`);
    return null;
  }
  console.log(`対象: ${targetL1} 配下 ${cats.length}件`);
  return { targetL1, outPath, cats, slug };
}

function buildHTML(targetL1, outPath, cats) {

  // 親パスでグルーピング
  const byParent = {};
  for (const c of cats) {
    const k = (c.parent || '?').split(' / ')[0] || '?';
    if (!byParent[k]) byParent[k] = [];
    byParent[k].push(c);
  }

  // 月商順で各グループ内をソート
  for (const k in byParent) {
    byParent[k].sort((a, b) => (Number(b.totalRevenue) || -1) - (Number(a.totalRevenue) || -1));
  }

  // グループを件数順で並べる
  const groupOrder = Object.entries(byParent).sort((a, b) => b[1].length - a[1].length);

  // 個別レポートページ判定
  const dedicatedReports = {
    '2045235051': 'bike-cover-report.html', // 車体カバー
  };
  const reportLink = (c) => {
    const deepdivePath = path.join(__dirname, '..', `deepdive-${c.id}.html`);
    const hasDeepdive = fs.existsSync(deepdivePath);
    if (dedicatedReports[c.id]) return `<a href="${dedicatedReports[c.id]}" target="_blank" class="report-btn">📄 詳細</a>`;
    if (hasDeepdive) return `<a href="deepdive-${c.id}.html" target="_blank" class="report-btn">🔬 深掘りを見る</a>`;
    return `<button class="deepdive-build-btn report-btn" data-cat-id="${c.id}" data-cat-name="${esc(c.label)}">🔬 深掘り作成</button>`;
  };

  // 統計
  const scanned = cats.filter((c) => c.status?.includes('scan済')).length;
  const strong = cats.filter((c) => c.recommendation?.includes('強推奨') || c.recommendation?.includes('おすすめ')).length;
  const consider = cats.filter((c) => c.recommendation?.includes('検討') || c.recommendation?.includes('ありかも')).length;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>OEMリサーチ: ${targetL1} サブカテゴリ一覧</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
  background: #f5f6f8;
  color: #212121;
  font-size: 12px;
  line-height: 1.4;
}
.container { max-width: 1400px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; }

.report-head {
  background: linear-gradient(180deg, #f97316 0%, #ea580c 100%);
  color: white;
  padding: 14px 20px;
  border-bottom: 3px solid transparent;
}
.report-head .label { font-size: 10px; opacity: 0.85; letter-spacing: 0.15em; }
.report-head h1 { font-size: 20px; margin: 3px 0 6px; }
.report-head .meta { display: flex; gap: 16px; font-size: 11px; opacity: 0.9; }

.kpi-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 6px;
  padding: 10px 16px;
  background: #fafbfc;
  border-bottom: 2px solid #f9a825;
}
.kpi {
  background: white;
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
}
.kpi.kpi-click { cursor: pointer; transition: all 0.1s; }
.kpi.kpi-click:hover { background: #fff7ed; border-color: #f97316; transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
.kpi.kpi-active { background: #f97316; border-color: #ea580c; }
.kpi.kpi-active .kpi-label, .kpi.kpi-active .kpi-value { color: white !important; }
.kpi-label { font-size: 10px; color: #6b7280; }
.kpi-value { font-size: 17px; font-weight: 700; color: #ea580c; }

.group-section { padding: 8px 0; }
.group-head {
  background: #fafbfc;
  color: #212121;
  padding: 6px 16px;
  font-weight: 700;
  font-size: 13px;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 10px;
}
.group-head .group-count {
  background: rgba(0,0,0,0.15);
  color: white;
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 11px;
}
.group-head .group-sum {
  background: rgba(255,255,255,0.85);
  color: #b45309;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
}
.group-head .group-sum strong { font-size: 12px; color: #92400e; }
.group-head .group-sum-meta {
  color: rgba(33,33,33,0.6);
  font-size: 10px;
  margin-left: 4px;
}

table.rows {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
table.rows thead th {
  background: #fafbfc;
  color: #212121;
  border: 1px solid #e5e7eb;
  padding: 4px 6px;
  text-align: center;
  font-weight: 700;
  font-size: 10px;
  position: sticky;
  top: 0;
}
table.rows thead th.sortable { cursor: pointer; user-select: none; }
table.rows thead th.sortable:hover { background: #fff7ed; color: #ea580c; }
table.rows thead th.sortable .sort-arrow::after { content: ' ⇅'; font-size: 9px; color: #cbd5e1; }
table.rows thead th.sortable.sort-asc .sort-arrow::after { content: ' ▲'; color: #ea580c; }
table.rows thead th.sortable.sort-desc .sort-arrow::after { content: ' ▼'; color: #ea580c; }
table.rows tbody td {
  border: 1px solid #e5e7eb;
  padding: 3px 6px;
  vertical-align: middle;
  background: white;
  white-space: nowrap;
}
table.rows tbody tr:nth-child(even) td { background: #fafbfc; }
table.rows tbody tr.has-products { cursor: pointer; }
table.rows tbody tr.has-products:hover td { background: #fff7ed; }
table.rows tbody tr.expanded td { background: #fff7ed !important; }
table.rows tbody tr.detail-row td { padding: 0; background: #fafafa !important; }
table.rows tbody tr.detail-row > td { border: 2px solid #f97316; }

.thumb {
  width: 40px; height: 40px; object-fit: contain; background: #fff;
  border: 1px solid #e5e7eb; vertical-align: middle;
}
.thumb-cell { padding: 2px !important; text-align: center; }
.thumb-cell .no-img {
  display: inline-block; width: 40px; height: 40px; background: #f5f6f8;
  border: 1px dashed #e5e7eb; color: #bbb; font-size: 10px;
  line-height: 38px; text-align: center;
}

.mark-cell { padding: 4px !important; min-width: 110px; }
.mark-picker {
  display: inline-flex; gap: 2px;
}
.mark-btn {
  width: 22px; height: 22px;
  border: 1.5px solid #d1d5db; background: white;
  font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; opacity: 0.35;
  border-radius: 3px;
  transition: all 0.12s;
}
.mark-btn:hover { opacity: 1; border-color: #9ca3af; transform: scale(1.15); }
.mark-btn.active {
  opacity: 1;
  transform: scale(1.25);
  border-width: 2.5px;
  font-weight: 700;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  z-index: 5; position: relative;
}
.mark-btn.active.interest { background: #fde047; border-color: #ca8a04; box-shadow: 0 0 0 2px #fef08a, 0 2px 6px rgba(202,138,4,0.4); }
.mark-btn.active.research { background: #fb923c; border-color: #c2410c; box-shadow: 0 0 0 2px #fed7aa, 0 2px 6px rgba(194,65,12,0.4); }
.mark-btn.active.sample { background: #a78bfa; border-color: #6d28d9; box-shadow: 0 0 0 2px #ddd6fe, 0 2px 6px rgba(109,40,217,0.4); }
.mark-btn.active.shipped { background: #4ade80; border-color: #15803d; box-shadow: 0 0 0 2px #bbf7d0, 0 2px 6px rgba(21,128,61,0.4); }
.mark-btn.active.rejected { background: #f87171; border-color: #b91c1c; box-shadow: 0 0 0 2px #fecaca, 0 2px 6px rgba(185,28,28,0.4); }
table.rows tbody tr.row-interest td:not(.mark-cell) { background: #fef9c3 !important; }
table.rows tbody tr.row-research td:not(.mark-cell) { background: #ffedd5 !important; }
table.rows tbody tr.row-sample td:not(.mark-cell) { background: #ede9fe !important; }
table.rows tbody tr.row-shipped td:not(.mark-cell) { background: #dcfce7 !important; }
table.rows tbody tr.row-rejected td:not(.mark-cell) { background: #fee2e2 !important; opacity: 0.65; }

.product-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 10px;
}
.product-card {
  background: white; border: 1px solid #e5e7eb;
  display: flex; flex-direction: column;
  overflow: hidden;
  font-size: 11px;
}
.product-card .rank {
  background: #f97316; color: white; padding: 2px 6px;
  font-weight: 700; font-size: 11px;
}
.product-card .img-wrap {
  width: 100%; height: 140px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; border-bottom: 1px solid #eee;
}
.product-card .img-wrap img {
  max-width: 100%; max-height: 100%; object-fit: contain;
}
.product-card .info { padding: 6px 8px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.product-card .title {
  font-size: 11px; line-height: 1.35; max-height: 56px;
  overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  font-weight: 600;
}
.product-card .meta {
  font-size: 11px;
  display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline;
}
.product-card .price { font-weight: 700; color: #ea580c; font-size: 14px; }
.product-card .star { color: #f57c00; font-weight: 600; }
.product-card .reviews { color: #6b7280; }
.product-card .sales-row {
  display: flex; gap: 6px; flex-wrap: wrap;
  background: linear-gradient(180deg, #fef9c3 0%, #fef3c7 100%);
  border: 1px solid #facc15;
  padding: 4px 6px; border-radius: 3px;
}
.product-card .sales-item {
  display: flex; flex-direction: column; gap: 0; flex: 1;
}
.product-card .sales-key {
  font-size: 9px; color: #92400e; font-weight: 700; letter-spacing: 0.05em;
}
.product-card .sales-val {
  font-size: 13px; color: #b45309; font-weight: 700;
}
.product-card .brand {
  font-size: 11px; color: #1565c0; font-weight: 700;
  background: #e3f2fd; padding: 1px 6px; border-radius: 2px;
  align-self: flex-start;
}
.product-card .bsr-tag {
  font-size: 10px; color: #6d4c41; background: #fff8e1;
  border: 1px solid #ffd54f; padding: 1px 4px; border-radius: 2px;
  align-self: flex-start;
}
.product-card .spec-list {
  font-size: 10px; line-height: 1.5;
  background: #f9fafb; border: 1px solid #e5e7eb;
  padding: 4px 6px; border-radius: 2px;
}
.product-card .spec-list .spec-row {
  display: grid; grid-template-columns: 60px 1fr; gap: 4px;
}
.product-card .spec-list .spec-key { color: #6b7280; font-weight: 600; }
.product-card .spec-list .spec-val { color: #212121; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.product-card .features {
  font-size: 10px; line-height: 1.4; color: #374151;
}
.product-card .features li {
  list-style: none; padding-left: 10px; position: relative; margin-bottom: 2px;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.product-card .features li::before {
  content: '•'; position: absolute; left: 0; color: #f97316;
}
.product-card .gallery {
  display: flex; gap: 3px; margin-top: 2px; overflow-x: auto;
}
.product-card .gallery img {
  width: 32px; height: 32px; object-fit: contain;
  border: 1px solid #e5e7eb; background: white; flex-shrink: 0;
}
.product-card .asin {
  font-size: 9px; color: #888; font-family: monospace;
}
.product-card .link {
  display: block; background: #1565c0; color: white;
  text-align: center; padding: 4px; text-decoration: none;
  font-size: 11px; font-weight: 700;
}
.product-card .link:hover { background: #0d47a1; }
@media (max-width: 1100px) {
  .product-grid { grid-template-columns: repeat(3, 1fr); }
}
.num { text-align: right; font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.cat-name { font-weight: 600; color: #1565c0; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.cat-name a { color: #1565c0; text-decoration: none; }
.cat-name a:hover { text-decoration: underline; }
.parent-tail { color: #6b7280; font-size: 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

.b {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 2px;
  font-weight: 700;
  border: 1px solid;
}
.b.green { background: #c8e6c9; color: #1b5e20; border-color: #66bb6a; }
.b.yellow { background: #fff59d; color: #856404; border-color: #fdd835; }
.b.orange { background: #fff7ed; color: #e65100; border-color: #fafbfc; }
.b.red { background: #ffcdd2; color: #b71c1c; border-color: #e57373; }
.b.gray { background: #eceff1; color: #455a64; border-color: #b0bec5; }
.b.lite { background: #f5f5f5; color: #757575; border-color: #bdbdbd; }

.sb { display: inline-flex; align-items: center; gap: 4px; }
.sb-bar { width: 32px; height: 5px; background: #eee; border: 1px solid #999; }
.sb-fill { height: 100%; }
.sb-num { font-weight: 700; min-width: 22px; text-align: right; }

.report-btn {
  background: #f97316; color: white; border: none;
  padding: 3px 10px; font-size: 11px; font-weight: 700;
  text-decoration: none; border-radius: 3px;
  display: inline-block;
}
.report-btn:hover { background: #ea580c; }

.rev-done {
  display: inline-block;
  font-size: 11px;
  background: linear-gradient(180deg, #34d399, #10b981);
  color: white;
  padding: 3px 6px;
  border-radius: 3px;
  font-weight: 700;
  line-height: 1.2;
}
.rev-done small { font-size: 9px; opacity: 0.9; font-weight: 500; }
.rev-partial {
  display: inline-block;
  font-size: 11px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fbbf24;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  line-height: 1.2;
}
.rev-partial small { font-size: 9px; font-weight: 500; }

.ch-low, .ch-mid, .ch-high {
  display: inline-block; padding: 3px 8px; border-radius: 12px;
  font-weight: 700; font-size: 11px; text-decoration: none;
  transition: transform 0.1s;
}
.ch-low { background: #e0e7ff; color: #3730a3; border: 1px solid #a5b4fc; }
.ch-mid { background: #c4b5fd; color: #5b21b6; border: 1px solid #7c3aed; }
.ch-high { background: linear-gradient(180deg, #f97316, #ea580c); color: white; border: 1px solid #c2410c; box-shadow: 0 0 0 2px #fed7aa; }
.ch-low:hover, .ch-mid:hover, .ch-high:hover { transform: scale(1.15); }
table.rows tbody tr.has-reviews td:first-child {
  border-left: 3px solid #10b981;
}
.report-btn-2 {
  background: white; color: #1565c0; border: 1px solid #1565c0;
  padding: 3px 8px; font-size: 11px;
  text-decoration: none; border-radius: 3px;
}

.toolbar {
  background: #fafbfc;
  border-bottom: 1px solid #f9a825;
  padding: 6px 16px;
  display: flex;
  gap: 8px;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 10;
}
.toolbar input, .toolbar select {
  background: white;
  border: 1px solid #e5e7eb;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 2px;
  font-family: inherit;
}
.toolbar input[type=search] { min-width: 220px; }
.toolbar label { font-size: 11px; font-weight: 700; color: #6b7280; }

.footer {
  padding: 10px 16px;
  font-size: 10px;
  color: #757575;
  text-align: center;
  background: #fafafa;
  border-top: 1px solid #e5e7eb;
}

/* グローバルナビ */
.topnav {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: stretch;
  background: #1e293b; color: white;
  border-bottom: 2px solid #f97316;
  font-size: 11px;
}
.topnav .nav-home, .topnav .nav-dashboard {
  background: #f97316; color: white;
  padding: 8px 14px; text-decoration: none;
  font-weight: 700; font-size: 12px;
  white-space: nowrap;
  display: flex; align-items: center;
}
.topnav .nav-home:hover, .topnav .nav-dashboard:hover { background: #ea580c; }
.topnav .nav-dashboard { background: #1565c0; }
.topnav .nav-dashboard:hover { background: #0d47a1; }
.topnav .nav-tabs {
  flex: 1; display: flex; overflow-x: auto;
  scrollbar-width: thin;
}
.topnav .nav-tab {
  padding: 6px 10px; color: #cbd5e1;
  text-decoration: none; font-size: 11px;
  border-right: 1px solid #334155;
  white-space: nowrap;
  display: flex; align-items: center;
  transition: background 0.1s;
}
.topnav .nav-tab:hover { background: #334155; color: white; }
.topnav .nav-tab.active {
  background: #f97316; color: white; font-weight: 700;
}

/* 前後L1ナビ */
.step-nav {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px;
  background: #fafbfc;
  border-top: 1px solid #e5e7eb;
  gap: 8px;
}
.step-nav .step-link {
  padding: 8px 14px;
  background: white;
  border: 1px solid #e5e7eb;
  color: #1565c0;
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  border-radius: 3px;
  min-width: 100px;
  text-align: center;
}
.step-nav .step-link:hover { background: #f5f6f8; border-color: #1565c0; }
.step-nav .step-link.disabled { background: transparent; border: none; cursor: default; }
.step-nav .step-link.step-home {
  background: #f97316; color: white; border-color: #f97316;
}
.step-nav .step-link.step-home:hover { background: #ea580c; border-color: #ea580c; }
</style>
</head>
<body>
${buildNavbar(targetL1)}
<div class="container">

  <div class="report-head">
    <div class="label"><a href="index-l1.html" style="color:#ffe4cc;text-decoration:none">🏠 トップ</a> / STAGE 1 サブカテゴリ一覧</div>
    <h1>${targetL1} 配下サブカテゴリ ${cats.length}件</h1>
    <div class="meta">
      <span>生成日: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</span>
      <span>データソース: Keepa + Amazon JP HTML scrape</span>
    </div>
  </div>

  <div class="kpi-bar">
    <div class="kpi kpi-click" data-quick-filter="">
      <div class="kpi-label">サブカテゴリ総数</div><div class="kpi-value">${cats.length.toLocaleString()}</div>
    </div>
    <div class="kpi kpi-click" data-quick-filter="scanned" title="クリック=分析済(スコア算出済)のみ表示。Keepa取れてないカテゴリは含まれない">
      <div class="kpi-label">📊 分析済</div><div class="kpi-value">${scanned}</div>
    </div>
    <div class="kpi kpi-click" data-quick-filter="strong" title="クリック=🟢おすすめ(スコア70+)のみ表示。市場魅力度が高いゾーン">
      <div class="kpi-label">🟢 おすすめ</div><div class="kpi-value" style="color:#2e7d32">${strong}</div>
    </div>
    <div class="kpi kpi-click" data-quick-filter="consider" title="クリック=🟡ありかも(スコア50-70)のみ表示。中堅ねらい目">
      <div class="kpi-label">🟡 ありかも</div><div class="kpi-value" style="color:#f57c00">${consider}</div>
    </div>
    <div class="kpi"><div class="kpi-label">親グループ数</div><div class="kpi-value">${groupOrder.length}</div></div>
  </div>

  <details class="usage-guide" style="margin:0 24px 8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:8px 12px">
    <summary style="cursor:pointer;font-weight:700;color:#92400e;font-size:12px;outline:none">💡 このページの使い方（クリックで開く）</summary>
    <div style="margin-top:10px;font-size:11.5px;line-height:1.7;color:#451a03">
      <p style="margin-bottom:6px"><strong>🎯 結論を急ぐなら:</strong> ① 上の「💎 OEM参入可」KPI（index-l1.htmlにある）か、難易度フィルタ「💎 OEM参入可のみ」→ ② 並び替えを「参入難易度 易しい順」→ ③ 各行クリックでTop5商品を確認 → ④ ⭐興味マーク。</p>
      <ul style="margin:6px 0 6px 18px">
        <li><strong>🟢おすすめ / 🟡ありかも:</strong> Jobsが付けた市場魅力度判定 (スコア70+/50-70)</li>
        <li><strong>参入難易度列 (🟢easy/🟡mid/🟠hard/🔴v.hard):</strong> top5最少レビュー数+価格中央値から算出。💎マークは「¥1,500+ & medium以下」= 利益取れて参入余地あり</li>
        <li><strong>データ列 (✅完全/🟡部分):</strong> top5全部のKeepa+レビュー揃ってる=判定が信頼できる。空欄は裏で取得中</li>
        <li><strong>🎯横断:</strong> 1位ASINが他カテゴリTop5にも出てる数。多い=その商品強い、けどカテゴリ分類が雑な可能性も</li>
        <li><strong>B1シェア / 1位%:</strong> 低い=競合分散して入りやすい / 高い=1社独占で勝つの難しい</li>
        <li><strong>マーク (⭐🔍📦✅❌):</strong> 自分で印つける用 (ブラウザに保存される)</li>
      </ul>
      <p style="margin-bottom:0"><strong>💎 OEM適性のサイン:</strong> 単価¥1,500+ / 最少レビュー&lt;500 / B1シェア&lt;40% / 平均★4.0未満 (改善余地)。複数満たすほど狙い目。</p>
    </div>
  </details>

  <div class="toolbar" style="flex-wrap:wrap;gap:6px">
    <input type="search" id="q" placeholder="🔍 カテゴリ名で検索" style="min-width:200px">
    <select id="filter-status" title="Jobsの市場魅力度判定で絞る (スコア70+=おすすめ / 50-70=ありかも)">
      <option value="">判定: 全て</option>
      <option value="scanned">分析済のみ</option>
      <option value="strong">🟢 おすすめだけ</option>
      <option value="consider">🟡 ありかもだけ</option>
      <option value="recommended">🟢+🟡 ねらい目だけ</option>
    </select>
    <select id="filter-mark" title="自分でつけたマークで絞る (ブラウザに保存)">
      <option value="">マーク: 全て</option>
      <option value="any">マーク済のみ</option>
      <option value="interest">⭐興味</option>
      <option value="research">🔍深掘</option>
      <option value="sample">📦サンプル</option>
      <option value="shipped">✅発売</option>
      <option value="rejected">❌却下</option>
      <option value="none">マーク無しのみ</option>
    </select>
    <select id="filter-review" title="レビュー取得済みカテゴリで絞る (不満分析が可能なやつ)">
      <option value="">レビュー: 全て</option>
      <option value="done">📝 取得済のみ</option>
      <option value="none">未取得のみ</option>
    </select>
    <select id="filter-crosshit" title="1位ASINが他カテゴリTop5にも出現する数で絞る。多い=その商品強い">
      <option value="">🎯横断: 全て</option>
      <option value="2">2以上 (横断あり)</option>
      <option value="5">5以上 (強い)</option>
      <option value="10">10以上 (怪物)</option>
    </select>
    <select id="filter-completeness" title="データ取得状況で絞る。✅完全=判定が信頼できる範囲">
      <option value="">データ: 全て</option>
      <option value="verified">✅ 完全のみ</option>
      <option value="partial">🟡 部分のみ</option>
      <option value="empty">⚪ 未取得のみ</option>
    </select>
    <select id="filter-entry" title="参入難易度 (Keepa top5 のレビュー数と価格から算出)">
      <option value="">難易度: 全て</option>
      <option value="viable">💎 OEM参入可のみ (¥1,500+ & medium以下)</option>
      <option value="easy">🟢 easy (top5最少レビュー<100)</option>
      <option value="medium">🟡 medium (<500)</option>
      <option value="hard">🟠 hard (<2000)</option>
      <option value="very_hard">🔴 very_hard (2000+)</option>
    </select>
    <select id="filter-sort" title="並び替え">
      <option value="default">並び: デフォルト</option>
      <option value="revenue-desc">月商 多い順</option>
      <option value="revenue-asc">月商 少ない順</option>
      <option value="bought-desc">月販 多い順</option>
      <option value="bought-asc">月販 少ない順</option>
      <option value="price-desc">価格 高い順</option>
      <option value="price-asc">価格 安い順</option>
      <option value="reviews-asc">レビュー 少ない順 (参入しやすい)</option>
      <option value="reviews-desc">レビュー 多い順</option>
      <option value="rating-asc">★ 低い順 (改善できる)</option>
      <option value="rating-desc">★ 高い順</option>
      <option value="score-desc">参入スコア 高い順 (ねらい目)</option>
      <option value="topshare-asc">1位シェア 低い順 (競合分散)</option>
      <option value="topshare-desc">1位シェア 高い順 (1社独占)</option>
      <option value="entry-asc">参入難易度 易しい順 (狙い目)</option>
      <option value="pricemed-desc">中央価格 高い順 (利益取りやすい)</option>
      <option value="pricemed-asc">中央価格 安い順</option>
    </select>
    <label style="font-size:11px">月商≧
      <input type="number" id="filter-rev-min" placeholder="円" style="width:90px">
    </label>
    <label style="font-size:11px">レビュー≦
      <input type="number" id="filter-rev-max" placeholder="件" style="width:70px">
    </label>
    <label style="font-size:11px">価格
      <input type="number" id="filter-price-min" placeholder="≧" style="width:60px">
      <input type="number" id="filter-price-max" placeholder="≦" style="width:60px">
    </label>
    <button id="filter-reset" style="background:#f97316;color:white;border:none;padding:4px 10px;font-size:11px;font-weight:600;border-radius:3px;cursor:pointer">リセット</button>
    <span style="margin-left:auto;color:#6b7280;font-size:11px">表示: <strong id="shown">${cats.length}</strong>件</span>
  </div>

${groupOrder.map(([groupName, items]) => {
  // 親カテゴリ集計：傘下サブカテゴリの1位月販・月商を合算
  let sumBought = 0, sumRevenue = 0, withData = 0;
  for (const c of items) {
    const ps = loadProducts(c.id) || [];
    const t1 = ps[0];
    if (!t1) continue;
    if (t1.monthlyBoughtFinal) { sumBought += t1.monthlyBoughtFinal; withData++; }
    if (t1.monthlyRevenue) sumRevenue += t1.monthlyRevenue;
  }
  const groupSumHtml = sumBought > 0
    ? `<span class="group-sum">月販合計 <strong>${sumBought.toLocaleString()}個</strong></span>` +
      (sumRevenue > 0 ? `<span class="group-sum">月商合計 <strong>${Math.round(sumRevenue).toLocaleString()}円</strong></span>` : '') +
      `<span class="group-sum-meta">(${withData}/${items.length}件にデータ)</span>`
    : '';
  return `
  <div class="group-section" data-group="${esc(groupName)}">
    <div class="group-head">
      📁 ${esc(groupName)}
      <span class="group-count">${items.length}件</span>
      ${groupSumHtml}
    </div>
    <table class="rows">
      <thead>
        <tr>
          <th style="width:50px">順</th>
          <th style="width:90px" title="ステータスマーク。⭐興味/🔍深掘/📦サンプル/✅発売/❌却下を自分でつける(ブラウザ保存)">マーク</th>
          <th style="width:50px" title="このカテゴリのBSR1位商品のサムネ">1位</th>
          <th style="width:90px" title="Jobsの市場魅力度判定 (スコア閾値)">判定</th>
          <th style="width:90px" title="競合構造タグ。1社独占/競合分散/etc">競合</th>
          <th style="text-align:left">カテゴリ名</th>
          <th>所属パス</th>
          <th class="sortable" data-sort-key="score" style="width:90px;cursor:pointer" title="市場魅力度スコア (0-100)。市場規模25%+レビュー20%+独占度20%+評価10%+価格15%+安定10%">スコア <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="revenue" style="width:110px;cursor:pointer" title="1位商品の月商 (販売数×価格)。Keepa monthlySold が無い時はBSR推定">1位月商 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="bought" style="width:70px;cursor:pointer" title="1位商品の月販個数。3桁=ニッチ、4桁=主要、5桁=巨大市場">1位月販 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="reviews" style="width:80px;cursor:pointer" title="top5レビュー数の中央値。少ない=食い込みやすい">レビュー中 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="topshare" style="width:60px;cursor:pointer" title="1位商品のtop5売上シェア。低い=分散、高い=1強">1位% <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="brandconc" style="width:70px;cursor:pointer" title="Top1ブランドのtop5中シェア。40%超=寡占、40%未満=参入余地あり">B1シェア <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="brands" style="width:50px;cursor:pointer" title="Top5に登場するユニークブランド数。5=分散、1-2=寡占">B数 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="rating" style="width:50px;cursor:pointer" title="top5平均★。4.0未満=改善余地、4.5以上=既存強い">★ <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="price" style="width:80px;cursor:pointer" title="top5平均価格。¥1,500未満は薄利なので参入難">平均価格 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="entry" style="width:90px;cursor:pointer" title="参入難易度。top5最少レビュー数+価格中央値から算出。easy=食い込み余地大 / 💎マーク=¥1,500+ & medium以下で利益取れる狙い目">参入難易度 <span class="sort-arrow"></span></th>
          <th class="sortable" data-sort-key="pricemed" style="width:80px;cursor:pointer" title="top5 Keepa価格の中央値。OEM単価設計の参考に">中央価格 <span class="sort-arrow"></span></th>
          <th style="width:70px" title="データ取得状況。✅完全=top5全部Keepa+レビュー揃ってる(判定信頼OK) / 🟡部分=どれか欠ける / 空欄=未取得(裏で進行中)">データ</th>
          <th style="width:80px" title="レビュー取得済みASIN数 / Top5。📝が並ぶカテゴリは不満レビュー読める">レビュー</th>
          <th class="sortable" data-sort-key="crosshits" style="width:60px;cursor:pointer" title="1位ASINが他カテゴリTop5に出現してる数。多い=その商品が複数カテゴリで強い / 1=独自">🎯横断 <span class="sort-arrow"></span></th>
          <th style="width:80px" title="🔬深掘りボタンで個別レポート生成。レビュー分析・利益試算・1688検索リンク等">操作</th>
        </tr>
      </thead>
      <tbody>
${items.map((c, i) => {
  const products = loadProducts(c.id) || [];
  const top1 = products[0];
  const thumb = top1?.image
    ? `<img class="thumb" src="${esc(top1.image)}" alt="${esc(top1.title || '')}" loading="lazy">`
    : '<span class="no-img">–</span>';
  const hasProducts = products.length > 0;
  const productsJson = hasProducts ? esc(JSON.stringify(products)) : '';
  const revStatus = reviewStatus(products.map(p => p.asin));
  const hasReviewsClass = revStatus.count > 0 ? ' has-reviews' : '';
  return `
        <tr class="${hasProducts ? 'has-products' : ''}${hasReviewsClass}" data-reco="${esc(c.recommendation || '')}" data-status="${esc(c.status || '')}" data-search="${esc((c.label + ' ' + c.parent).toLowerCase())}" data-id="${esc(c.id)}" data-label="${esc(c.label)}" data-revenue="${top1?.monthlyRevenue || c.totalRevenue || 0}" data-bought="${top1?.monthlyBoughtFinal || 0}" data-price="${top1?.priceNum || c.avgPrice || 0}" data-reviews="${c.reviewMedian || 0}" data-rating="${c.ratingMean || 0}" data-score="${c.score || 0}" data-topshare="${c.topShare || 0}" data-brandconc="${c.brandTop1Share || 0}" data-brands="${c.uniqueBrands || 0}" data-crosshits="${top1 ? crossHitCount(top1.asin) : 0}" data-completeness="${esc(c.dataCompleteness || 'empty')}" data-entry="${esc(c.entryDifficulty || 'unknown')}" data-pricemed="${c.priceMedian || 0}" data-oemviable="${c.oemViable ? '1' : '0'}" ${hasProducts ? `data-products="${productsJson}"` : ''}>
          <td class="center">${i + 1}</td>
          <td class="mark-cell center" onclick="event.stopPropagation()"><span class="mark-picker" data-cat-id="${esc(c.id)}"></span></td>
          <td class="thumb-cell">${thumb}</td>
          <td class="center">${recoBadge(c.recommendation || c.status)}</td>
          <td class="center">${tagBadge(c.marketTag || '')}</td>
          <td class="cat-name"><a href="https://www.amazon.co.jp/gp/bestsellers/-/${c.id}/" target="_blank" onclick="event.stopPropagation()">${esc(c.label)}</a></td>
          <td class="parent-tail" title="${esc(c.parent || '')}">${esc(c.parent || '')}</td>
          <td class="num">${scoreBar(c.score)}</td>
          <td class="num">${top1?.monthlyRevenue ? Math.round(top1.monthlyRevenue).toLocaleString() + '円' + (top1.monthlyBoughtSource === 'bsr-est' ? '<span style="color:#888;font-size:9px;margin-left:2px" title="BSR順位からの推定値">(推定)</span>' : '') : '-'}</td>
          <td class="num">${top1?.monthlyBoughtFinal ? top1.monthlyBoughtFinal.toLocaleString() + '個' + (top1.monthlyBoughtSource === 'bsr-est' ? '<span style="color:#888;font-size:9px;margin-left:2px" title="BSR順位からの推定値">(推定)</span>' : '') : '-'}</td>
          <td class="num">${fmt(c.reviewMedian)}</td>
          <td class="num">${fmtPct(c.topShare)}</td>
          <td class="num" title="${c.topBrand ? esc(c.topBrand) : ''}">${fmtPct(c.brandTop1Share)}</td>
          <td class="num">${c.uniqueBrands || '-'}</td>
          <td class="num">${c.ratingMean ? Number(c.ratingMean).toFixed(1) : '-'}</td>
          <td class="num">${fmt(c.avgPrice, '¥')}</td>
          <td class="center" onclick="event.stopPropagation()" title="${esc(c.entryReason || '')}">${(function(){
            const ed = c.entryDifficulty;
            const viable = c.oemViable;
            const badgeStyle = (bg, color, border) => 'background:'+bg+';color:'+color+';border:1px solid '+border+';padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap';
            const viableMark = viable ? ' 💎' : '';
            if (ed === 'easy') return '<span style="'+badgeStyle('#dcfce7','#166534','#22c55e')+'">🟢 easy'+viableMark+'</span>';
            if (ed === 'medium') return '<span style="'+badgeStyle('#fef9c3','#854d0e','#facc15')+'">🟡 mid'+viableMark+'</span>';
            if (ed === 'hard') return '<span style="'+badgeStyle('#fed7aa','#9a3412','#fb923c')+'">🟠 hard</span>';
            if (ed === 'very_hard') return '<span style="'+badgeStyle('#fecaca','#991b1b','#ef4444')+'">🔴 v.hard</span>';
            return '<span style="color:#cbd5e1;font-size:11px">—</span>';
          })()}</td>
          <td class="num" title="top5 価格中央値">${c.priceMedian ? '¥' + c.priceMedian.toLocaleString() : '-'}</td>
          <td class="center" onclick="event.stopPropagation()">${(function(){
            const dc = c.dataCompleteness;
            if (dc === 'verified') return '<span style="background:linear-gradient(180deg,#34d399,#10b981);color:white;padding:3px 6px;border-radius:3px;font-size:10px;font-weight:700">✅ 完全</span>';
            if (dc === 'partial') return '<span style="background:#fef3c7;color:#92400e;border:1px solid #fbbf24;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700">🟡 部分</span>';
            return '<span style="color:#cbd5e1;font-size:11px">—</span>';
          })()}</td>
          <td class="center review-cell" onclick="event.stopPropagation()">${(function(){
            const rs = reviewStatus(products.map(p => p.asin));
            if (rs.count === 0) return '<span style="color:#cbd5e1;font-size:11px">—</span>';
            const allDone = rs.count >= Math.min(5, products.length);
            const cls = allDone ? 'rev-done' : 'rev-partial';
            return `<span class="${cls}">📝 ${rs.count}/${Math.min(5,products.length)}<br><small>${rs.totalReviews}件</small></span>`;
          })()}</td>
          <td class="center" onclick="event.stopPropagation()">${(function(){
            const cnt = top1 ? crossHitCount(top1.asin) : 0;
            if (cnt <= 1) return '<span style="color:#cbd5e1;font-size:11px">—</span>';
            const cls = cnt >= 10 ? 'ch-high' : cnt >= 5 ? 'ch-mid' : 'ch-low';
            return `<a class="${cls}" href="cross-category-hits.html?q=${esc(top1.asin)}" target="_blank" title="1位商品が${cnt}カテゴリで上位5入り、クリックで詳細">🎯 ${cnt}</a>`;
          })()}</td>
          <td class="center" onclick="event.stopPropagation()">${reportLink(c)}</td>
        </tr>
`;
}).join('')}
      </tbody>
    </table>
  </div>
`;
}).join('')}

  ${buildPrevNextFooter(targetL1)}

  <div class="footer">
    ${targetL1}配下 ${cats.length}件サブカテゴリ / グループ別表示 / 行クリックで上位5商品詳細
  </div>
</div>

<script>
const q = document.getElementById('q');
const sel = document.getElementById('filter-status');
const sort = document.getElementById('filter-sort');
const mark = document.getElementById('filter-mark');
const filterReview = document.getElementById('filter-review');
const filterCrosshit = document.getElementById('filter-crosshit');
const filterCompleteness = document.getElementById('filter-completeness');
const filterEntry = document.getElementById('filter-entry');
const revMin = document.getElementById('filter-rev-min');
const revMax = document.getElementById('filter-rev-max');
const priceMin = document.getElementById('filter-price-min');
const priceMax = document.getElementById('filter-price-max');
const resetBtn = document.getElementById('filter-reset');
const shown = document.getElementById('shown');

// URL クエリパラメータから初期フィルタを適用
const urlParams = new URLSearchParams(window.location.search);
const initFilter = urlParams.get('filter');
// applyFilter は後で定義されてるので queueMicrotask で適用

// === ステータスマーク機能（localStorage 永続化） ===
const MARK_STORE_KEY = 'oem-marks-v1';
const MARK_DEFS = [
  { key: 'interest', icon: '⭐', label: '興味' },
  { key: 'research', icon: '🔍', label: '深掘' },
  { key: 'sample', icon: '📦', label: 'サンプル' },
  { key: 'shipped', icon: '✅', label: '発売' },
  { key: 'rejected', icon: '❌', label: '却下' },
];

function loadMarks() {
  try { return JSON.parse(localStorage.getItem(MARK_STORE_KEY) || '{}'); } catch { return {}; }
}
function saveMarks(m) { localStorage.setItem(MARK_STORE_KEY, JSON.stringify(m)); }
let MARKS = loadMarks();

function attachMarkButtonHandlers(picker) {
  picker.querySelectorAll('.mark-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const catId = picker.dataset.catId;
      const key = btn.dataset.markKey;
      if (MARKS[catId] === key) delete MARKS[catId];
      else MARKS[catId] = key;
      saveMarks(MARKS);
      renderMark(catId, picker);
      if (typeof applyFilter === 'function') applyFilter();
    };
  });
}

function renderMark(catId, picker) {
  const cur = MARKS[catId] || '';
  picker.innerHTML = MARK_DEFS.map(function(d){
    var active = cur === d.key ? 'active' : '';
    return '<button class="mark-btn ' + d.key + ' ' + active + '" data-mark-key="' + d.key + '" title="' + d.icon + ' ' + d.label + '">' + d.icon + '</button>';
  }).join('');
  attachMarkButtonHandlers(picker);
  var tr = picker.closest('tr');
  if (tr) {
    MARK_DEFS.forEach(function(d){ tr.classList.remove('row-' + d.key); });
    if (cur) tr.classList.add('row-' + cur);
    tr.dataset.markState = cur;
  }
}

function applyMarkRender() {
  document.querySelectorAll('.mark-picker').forEach((p) => renderMark(p.dataset.catId, p));
}
applyMarkRender();

// 深掘りビルドボタン（各ボタン直接）
async function handleDeepdiveBuild(btn) {
  const catId = btn.dataset.catId;
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const orig = btn.textContent;
  btn.textContent = '⏳ 生成中…(5-15秒)';
  btn.style.opacity = 0.7;
  try {
    const r = await fetch('/api/build-deepdive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: catId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '生成失敗');
    btn.textContent = '✅ 開く...';
    window.open(data.url, '_blank');
    setTimeout(() => {
      btn.outerHTML = '<a href="' + data.url + '" target="_blank" class="report-btn">🔬 深掘りを見る</a>';
    }, 300);
  } catch (err) {
    btn.textContent = '✗ ' + (err.message || '').slice(0, 30);
    setTimeout(() => { btn.textContent = orig; btn.style.opacity = 1; btn.dataset.busy = ''; }, 4000);
  }
}
document.querySelectorAll('.deepdive-build-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    handleDeepdiveBuild(btn);
  });
});

// KPI クイックフィルタ
document.querySelectorAll('.kpi-click').forEach((el) => {
  el.addEventListener('click', () => {
    const f = el.dataset.quickFilter;
    document.querySelectorAll('.kpi-click').forEach((k) => k.classList.remove('kpi-active'));
    el.classList.add('kpi-active');
    sel.value = f;
    if (typeof applyFilter === 'function') applyFilter();
    document.querySelector('table.rows')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

const SORT_FNS = {
  'default': null,
  'revenue-desc': (a, b) => +b.dataset.revenue - +a.dataset.revenue,
  'revenue-asc':  (a, b) => +a.dataset.revenue - +b.dataset.revenue,
  'bought-desc':  (a, b) => +b.dataset.bought  - +a.dataset.bought,
  'bought-asc':   (a, b) => +a.dataset.bought  - +b.dataset.bought,
  'price-desc':   (a, b) => +b.dataset.price   - +a.dataset.price,
  'price-asc':    (a, b) => +a.dataset.price   - +b.dataset.price,
  'reviews-asc':  (a, b) => (+a.dataset.reviews || 1e9) - (+b.dataset.reviews || 1e9),
  'reviews-desc': (a, b) => +b.dataset.reviews - +a.dataset.reviews,
  'rating-asc':   (a, b) => (+a.dataset.rating || 5) - (+b.dataset.rating || 5),
  'rating-desc':  (a, b) => +b.dataset.rating - +a.dataset.rating,
  'score-desc':   (a, b) => +b.dataset.score - +a.dataset.score,
  'topshare-asc': (a, b) => (+a.dataset.topshare || 1) - (+b.dataset.topshare || 1),
  'topshare-desc':(a, b) => +b.dataset.topshare - +a.dataset.topshare,
  'brandconc-asc':(a, b) => (+a.dataset.brandconc || 1) - (+b.dataset.brandconc || 1),
  'brandconc-desc':(a, b) => +b.dataset.brandconc - +a.dataset.brandconc,
  'brands-desc': (a, b) => +b.dataset.brands - +a.dataset.brands,
  'brands-asc': (a, b) => (+a.dataset.brands || 99) - (+b.dataset.brands || 99),
  'crosshits-desc': (a, b) => +b.dataset.crosshits - +a.dataset.crosshits,
  'crosshits-asc': (a, b) => (+a.dataset.crosshits || 999) - (+b.dataset.crosshits || 999),
  'entry-asc': (a, b) => {
    const w = { easy: 1, medium: 2, hard: 3, very_hard: 4, unknown: 5 };
    return (w[a.dataset.entry] || 5) - (w[b.dataset.entry] || 5);
  },
  'entry-desc': (a, b) => {
    const w = { easy: 1, medium: 2, hard: 3, very_hard: 4, unknown: 5 };
    return (w[b.dataset.entry] || 5) - (w[a.dataset.entry] || 5);
  },
  'pricemed-desc': (a, b) => +b.dataset.pricemed - +a.dataset.pricemed,
  'pricemed-asc': (a, b) => (+a.dataset.pricemed || 1e9) - (+b.dataset.pricemed || 1e9),
};

function applyFilter() {
  const term = q.value.toLowerCase();
  const stat = sel.value;
  const sortKey = sort.value;
  const rMin = +revMin.value || 0;
  const rMax = +revMax.value || Infinity;
  const pMin = +priceMin.value || 0;
  const pMax = +priceMax.value || Infinity;

  let visibleCount = 0;
  document.querySelectorAll('table.rows tbody tr').forEach((tr) => {
    if (tr.classList.contains('detail-row')) return;
    const matchSearch = !term || tr.dataset.search.includes(term);
    const reco = tr.dataset.reco;
    const status = tr.dataset.status;
    let matchStatus = true;
    if (stat === 'scanned') matchStatus = status.includes('scan済') || status.includes('分析済');
    if (stat === 'strong') matchStatus = reco.includes('強推奨') || reco.includes('おすすめ');
    if (stat === 'consider') matchStatus = reco.includes('検討') || reco.includes('ありかも');
    if (stat === 'recommended') matchStatus = reco.includes('強推奨') || reco.includes('検討') || reco.includes('おすすめ') || reco.includes('ありかも');
    const rev = +tr.dataset.revenue;
    const reviews = +tr.dataset.reviews;
    const price = +tr.dataset.price;
    const matchRev = rev >= rMin;
    const matchRevMax = !revMax.value || reviews <= rMax;
    const matchPrice = price >= pMin && price <= pMax;
    const markState = tr.dataset.markState || '';
    const markVal = mark.value;
    let matchMark = true;
    if (markVal === 'any') matchMark = !!markState;
    else if (markVal === 'none') matchMark = !markState;
    else if (markVal) matchMark = markState === markVal;
    const hasRev = tr.classList.contains('has-reviews');
    const revVal = filterReview.value;
    let matchReview = true;
    if (revVal === 'done') matchReview = hasRev;
    else if (revVal === 'none') matchReview = !hasRev;
    const chThr = +filterCrosshit.value || 0;
    const matchCh = !chThr || +tr.dataset.crosshits >= chThr;
    const compVal = filterCompleteness.value;
    const matchComp = !compVal || tr.dataset.completeness === compVal;
    const entryVal = filterEntry ? filterEntry.value : '';
    let matchEntry = true;
    if (entryVal === 'viable') matchEntry = tr.dataset.oemviable === '1';
    else if (entryVal) matchEntry = tr.dataset.entry === entryVal;
    const show = matchSearch && matchStatus && matchRev && matchRevMax && matchPrice && matchMark && matchReview && matchCh && matchComp && matchEntry;
    tr.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });
  shown.textContent = visibleCount;

  // ソート（グループ毎に並び替え）
  if (sortKey !== 'default' && SORT_FNS[sortKey]) {
    document.querySelectorAll('table.rows tbody').forEach((tbody) => {
      const rows = Array.from(tbody.querySelectorAll('tr')).filter((tr) => !tr.classList.contains('detail-row'));
      rows.sort(SORT_FNS[sortKey]);
      rows.forEach((r) => tbody.appendChild(r));
    });
  }

  document.querySelectorAll('.group-section').forEach((g) => {
    const anyVisible = Array.from(g.querySelectorAll('tbody tr')).some((tr) => tr.style.display !== 'none' && !tr.classList.contains('detail-row'));
    g.style.display = anyVisible ? '' : 'none';
  });
}

[q, sel, sort, mark, filterReview, filterCrosshit, filterCompleteness, filterEntry, revMin, revMax, priceMin, priceMax].forEach((el) => {
  el.addEventListener('input', applyFilter);
  el.addEventListener('change', applyFilter);
});
resetBtn.addEventListener('click', () => {
  q.value = ''; sel.value = ''; sort.value = 'default';
  revMin.value = ''; revMax.value = ''; priceMin.value = ''; priceMax.value = '';
  if (mark) mark.value = '';
  if (filterReview) filterReview.value = '';
  if (filterCrosshit) filterCrosshit.value = '';
  if (filterCompleteness) filterCompleteness.value = '';
  if (filterEntry) filterEntry.value = '';
  document.querySelectorAll('th.sortable').forEach((th) => th.classList.remove('sort-asc', 'sort-desc'));
  document.querySelectorAll('.kpi-click').forEach((k) => k.classList.remove('kpi-active'));
  applyFilter();
});

// 初期フィルタ適用 (URL ?filter=strong / ?entry=viable などから)
const initEntry = urlParams.get('entry');
if (initEntry && filterEntry) filterEntry.value = initEntry;
if (initFilter) {
  sel.value = initFilter;
  const kpi = document.querySelector('.kpi-click[data-quick-filter="' + initFilter + '"]');
  if (kpi) kpi.classList.add('kpi-active');
}
if (initFilter || initEntry) applyFilter();

// 列ヘッダクリックでソート
document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    const isDesc = th.classList.contains('sort-desc');
    document.querySelectorAll('th.sortable').forEach((t) => t.classList.remove('sort-asc', 'sort-desc'));
    const sortKey = isDesc ? key + '-asc' : key + '-desc';
    th.classList.add(isDesc ? 'sort-asc' : 'sort-desc');
    sort.value = sortKey;
    applyFilter();
  });
});

// 行クリックで上位5商品を展開
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function buildDetailRow(products, colspan, label) {
  const cards = products.map((p) => {
    const img = p.image ? '<img src="' + escHtml(p.image) + '" alt="" loading="lazy">' : '<span style="color:#bbb">画像なし</span>';
    const brandHtml = p.brand ? '<span class="brand">' + escHtml(p.brand) + '</span>' : '';
    const bsrHtml = (p.bsr && p.bsr[0])
      ? '<span class="bsr-tag">BSR #' + p.bsr[0].rank.toLocaleString() + ' / ' + escHtml(p.bsr[0].category) + '</span>'
      : '';
    const specs = p.overview ? Object.entries(p.overview).slice(0, 5)
      .map(([k, v]) => '<div class="spec-row"><div class="spec-key">' + escHtml(k) + '</div><div class="spec-val" title="' + escHtml(v) + '">' + escHtml(v) + '</div></div>').join('') : '';
    const specHtml = specs ? '<div class="spec-list">' + specs + '</div>' : '';
    const features = p.features && p.features.length ? '<ul class="features">' + p.features.slice(0, 3).map((f) => '<li title="' + escHtml(f) + '">' + escHtml(f) + '</li>').join('') + '</ul>' : '';
    const gallery = p.gallery && p.gallery.length > 1
      ? '<div class="gallery">' + p.gallery.slice(0, 5).map((g) => '<img src="' + escHtml(g) + '" loading="lazy">').join('') + '</div>'
      : '';
    return '<div class="product-card">' +
      '<div class="rank">#' + p.rank + ' BSR</div>' +
      '<div class="img-wrap">' + img + '</div>' +
      '<div class="info">' +
        '<div class="title" title="' + escHtml(p.title) + '">' + escHtml(p.title) + '</div>' +
        '<div class="meta">' +
          '<span class="price">' + escHtml(p.price || '-') + '</span>' +
          (p.rating ? '<span class="star">★ ' + p.rating + '</span>' : '') +
          (p.reviews ? '<span class="reviews">レビュー ' + p.reviews.toLocaleString() + '</span>' : '') +
        '</div>' +
        (p.monthlyBoughtFinal ? (function(){
          const tag = p.monthlyBoughtSource === 'keepa'
            ? '<span style="font-size:9px;color:#1565c0;font-weight:600" title="Keepa API取得">実測 (Keepa)</span>'
            : p.monthlyBoughtSource === 'badge'
              ? '<span style="font-size:9px;color:#16a34a;font-weight:600">実測 (Amazon)</span>'
              : '<span style="font-size:9px;color:#666" title="BSR順位からの推定">推定 (BSR)</span>';
          return '<div class="sales-row"><span class="sales-item"><span class="sales-key">月販 ' + tag + '</span><span class="sales-val">' + p.monthlyBoughtFinal.toLocaleString() + '個</span></span>' +
            (p.monthlyRevenue ? '<span class="sales-item"><span class="sales-key">月商 ' + tag + '</span><span class="sales-val">' + Math.round(p.monthlyRevenue).toLocaleString() + '円</span></span>' : '') +
            '</div>';
        })() : '') +
        brandHtml +
        bsrHtml +
        specHtml +
        features +
        gallery +
        '<div class="asin">ASIN: ' + p.asin + '</div>' +
      '</div>' +
      '<a class="link" href="' + p.productUrl + '" target="_blank">Amazonで見る →</a>' +
    '</div>';
  }).join('');
  return '<tr class="detail-row"><td colspan="' + colspan + '"><div style="padding:6px 10px;background:#fff7ed;font-weight:700;color:#ea580c;border-bottom:1px solid #fed7aa">📦 ' + escHtml(label) + ' BSR 上位' + products.length + '商品</div><div class="product-grid">' + cards + '</div></td></tr>';
}

document.querySelectorAll('tr.has-products').forEach((tr) => {
  tr.addEventListener('click', () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail-row')) {
      next.remove();
      tr.classList.remove('expanded');
      return;
    }
    // 他の展開を閉じる
    document.querySelectorAll('tr.detail-row').forEach((dr) => dr.remove());
    document.querySelectorAll('tr.expanded').forEach((er) => er.classList.remove('expanded'));
    const products = JSON.parse(tr.dataset.products);
    const cols = tr.children.length;
    tr.classList.add('expanded');
    tr.insertAdjacentHTML('afterend', buildDetailRow(products, cols, tr.dataset.label));
  });
});
</script>
</body>
</html>
`;

  fs.writeFileSync(outPath, html);
  console.log(`✅ 生成: ${outPath}`);
  return { targetL1, count: cats.length, path: outPath, scanned, strong, consider };
}

function buildIndexPage(allL1, summaries) {
  const indexPath = path.join(__dirname, '..', 'index-l1.html');
  const totalCats = summaries.reduce((sum, s) => sum + s.count, 0);
  const totalScanned = summaries.reduce((sum, s) => sum + s.scanned, 0);
  const totalStrong = summaries.reduce((sum, s) => sum + s.strong, 0);
  const totalConsider = summaries.reduce((sum, s) => sum + s.consider, 0);
  // verified / OEM参入可 カウント (categories.json 直読み)
  let totalVerified = 0;
  let totalOemViable = 0;
  try {
    const allCats = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).categories || [];
    totalVerified = allCats.filter((c) => c.dataCompleteness === 'verified').length;
    totalOemViable = allCats.filter((c) => c.oemViable).length;
  } catch {}
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>OEMリサーチ ポータル</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif; background: #f5f6f8; color: #212121; font-size: 13px; line-height: 1.5; }

.topnav {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: stretch;
  background: #1e293b; color: white;
  border-bottom: 2px solid #f97316;
  font-size: 11px;
}
.topnav .nav-home, .topnav .nav-dashboard {
  background: #f97316; color: white;
  padding: 8px 14px; text-decoration: none;
  font-weight: 700; font-size: 12px;
  white-space: nowrap;
  display: flex; align-items: center;
}
.topnav .nav-home:hover { background: #ea580c; }
.topnav .nav-dashboard { background: #1565c0; }
.topnav .nav-dashboard:hover { background: #0d47a1; }
.topnav .nav-tabs {
  flex: 1; display: flex; overflow-x: auto;
  scrollbar-width: thin;
}
.topnav .nav-tab {
  padding: 6px 10px; color: #cbd5e1;
  text-decoration: none; font-size: 11px;
  border-right: 1px solid #334155;
  white-space: nowrap;
  display: flex; align-items: center;
}
.topnav .nav-tab:hover { background: #334155; color: white; }
.topnav .nav-tab.active { background: #f97316; color: white; font-weight: 700; }

.container { max-width: 1200px; margin: 16px auto; background: white; border: 1px solid #e5e7eb; }
.report-head { background: linear-gradient(180deg, #f97316 0%, #ea580c 100%); color: white; padding: 18px 24px; }
.report-head .label { font-size: 11px; opacity: 0.85; letter-spacing: 0.15em; }
.report-head h1 { font-size: 22px; margin: 4px 0 8px; }
.report-head .meta { font-size: 11px; opacity: 0.9; }

.kpi-bar {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px; padding: 12px 24px; background: #fff7ed; border-bottom: 2px solid #fed7aa;
}
.kpi { background: white; border: 1px solid #e5e7eb; padding: 10px 14px; border-radius: 4px; }
.kpi.kpi-link { cursor: pointer; text-decoration: none; color: inherit; display: block; transition: all 0.12s; }
.kpi.kpi-link:hover { background: linear-gradient(180deg, #fff7ed, #fed7aa); border-color: #f97316; transform: translateY(-2px); box-shadow: 0 3px 8px rgba(249,115,22,0.2); }
.kpi.kpi-link .kpi-label::after { content: ' →'; opacity: 0.4; }
.kpi.kpi-link:hover .kpi-label::after { opacity: 1; color: #f97316; }
.kpi-label { font-size: 11px; color: #6b7280; font-weight: 600; }
.kpi-value { font-size: 24px; font-weight: 700; color: #ea580c; line-height: 1.1; margin-top: 2px; }
.kpi-value.green { color: #16a34a; }
.kpi-value.yellow { color: #f59e0b; }
.kpi-sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }

.section { padding: 16px 24px; }
.section h2 { font-size: 15px; color: #ea580c; border-left: 4px solid #f97316; padding-left: 8px; margin-bottom: 14px; }

.l1-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.l1-card {
  border: 1px solid #e5e7eb; background: white; padding: 14px;
  transition: all 0.15s; position: relative; border-radius: 4px;
}
.l1-card:hover { border-color: #f97316; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
.l1-title-link { text-decoration: none; color: inherit; display: block; }
.l1-title-link h3 { font-size: 16px; color: #ea580c; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
.l1-title-link:hover h3 { color: #c2410c; text-decoration: underline; }
.l1-card .arrow { margin-left: auto; color: #cbd5e1; font-size: 16px; }
.l1-card:hover .arrow { color: #f97316; }
.l1-card .nums { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; }
.l1-card .num-block { background: #f5f6f8; border: 1px solid #e5e7eb; padding: 3px 8px; border-radius: 2px; text-decoration: none; color: inherit; }
.l1-card .num-link:hover { background: #fff7ed; border-color: #f97316; }
.l1-card .num-block strong { font-size: 13px; display: block; font-weight: 700; }
.l1-card .num-block.strong { background: #f0fdf4; border-color: #86efac; }
.l1-card .num-block.strong strong { color: #16a34a; }
.l1-card .num-block.strong:hover { background: #dcfce7; }
.l1-card .num-block.consider { background: #fef3c7; border-color: #fcd34d; }
.l1-card .num-block.consider strong { color: #f59e0b; }
.l1-card .num-block.consider:hover { background: #fde68a; }
.l1-card-wrap { position: relative; }

.subnav { padding: 12px 24px; background: #fafbfc; border-bottom: 1px solid #e5e7eb; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.subnav strong { font-size: 11px; color: #6b7280; }
.subnav a { color: #1565c0; text-decoration: none; font-weight: 700; font-size: 12px; }
.subnav a:hover { text-decoration: underline; }

.footer { padding: 12px 24px; background: #fafafa; font-size: 10px; color: #757575; text-align: center; border-top: 1px solid #e5e7eb; }
</style>
</head>
<body>
${buildNavbar(null)}
<div class="container">
  <div class="report-head">
    <div class="label">OEMリサーチ ポータル / Stage 1</div>
    <h1>📋 大カテゴリ(L1)別 サブカテゴリ一覧</h1>
    <div class="meta">生成日: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / 全L1: ${summaries.length}件</div>
  </div>

  <div class="kpi-bar">
    <div class="kpi"><div class="kpi-label">L1カテゴリ</div><div class="kpi-value">${summaries.length}</div></div>
    <div class="kpi"><div class="kpi-label">サブカテゴリ総数</div><div class="kpi-value">${totalCats.toLocaleString()}</div></div>
    <a class="kpi kpi-link" href="highlights.html?filter=scanned"><div class="kpi-label">📊 分析済</div><div class="kpi-value">${totalScanned}</div><div class="kpi-sub">クリック→一覧</div></a>
    <a class="kpi kpi-link" href="highlights.html?filter=strong"><div class="kpi-label">🟢 おすすめ</div><div class="kpi-value green">${totalStrong}</div><div class="kpi-sub">クリック→一覧</div></a>
    <a class="kpi kpi-link" href="highlights.html?filter=consider"><div class="kpi-label">🟡 ありかも</div><div class="kpi-value yellow">${totalConsider}</div><div class="kpi-sub">クリック→一覧</div></a>
    <a class="kpi kpi-link" href="highlights.html"><div class="kpi-label">✅ データ完全</div><div class="kpi-value green">${totalVerified}</div><div class="kpi-sub">信頼できる候補</div></a>
    <a class="kpi kpi-link" href="highlights.html?entry=viable" title="参入候補一覧へ。¥1,500+ かつ top5最少レビュー&lt;500のカテゴリ"><div class="kpi-label">💎 OEM参入可</div><div class="kpi-value green">${totalOemViable}</div><div class="kpi-sub">¥1,500+ & 既存弱め</div></a>
  </div>

  <details class="usage-guide" style="margin:0 24px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:10px 14px">
    <summary style="cursor:pointer;font-weight:700;color:#92400e;font-size:13px;outline:none">💡 ポータルの使い方ガイド（クリックで開く）</summary>
    <div style="margin-top:12px;font-size:12px;line-height:1.7;color:#451a03">
      <p style="margin-bottom:8px;font-weight:700">🎯 OEM候補をサクッと見つける流れ</p>
      <ol style="margin:0 0 10px 22px">
        <li>上の「💎 OEM参入可」KPIをクリック → 1,400件の参入候補リスト</li>
        <li>そのページで「並び替え: 参入難易度 易しい順」または「データ: ✅完全のみ」で絞る</li>
        <li>気になるカテゴリを開いて Top5商品+レビューを確認</li>
        <li>⭐興味 / 🔍深掘 / 📦サンプル のマークで管理</li>
      </ol>
      <p style="margin-bottom:6px;font-weight:700">📋 KPIの意味</p>
      <ul style="margin:0 0 10px 22px">
        <li><strong>📊 分析済:</strong> Keepa取得+スコア算出済みカテゴリ数</li>
        <li><strong>🟢 おすすめ / 🟡 ありかも:</strong> 市場魅力度判定 (スコア70+/50-70)</li>
        <li><strong>✅ データ完全:</strong> top5の Keepa+レビュー揃ってる=判定が信頼できる範囲</li>
        <li><strong>💎 OEM参入可:</strong> ¥1,500+ かつ top5最少レビュー&lt;500 = 利益取れて参入余地あり</li>
      </ul>
      <p style="margin-bottom:6px;font-weight:700">🔬 各カテゴリ詳細</p>
      <ul style="margin:0 0 0 22px">
        <li>L1カードから入る → サブカテゴリ表でフィルタ/ソート → 各行クリックでTop5商品展開</li>
        <li>「🔬深掘り」ボタンで個別レポート(レビュー分析・利益試算・1688リンク等)生成</li>
        <li>各カラム/フィルタ/バッジは <strong>カーソル合わせるとツールチップ</strong> で説明出ます</li>
      </ul>
    </div>
  </details>

  <div class="subnav">
    <strong>関連ページ:</strong>
    <a href="highlights.html?entry=viable" style="color:#7c3aed;font-weight:700">💎 OEM参入可リスト</a>
    <a href="pair-suggestions.html" style="color:#7c3aed;font-weight:700">💜 市場×市場ペア提案</a>
    <a href="cross-category-hits.html">🎯 横断ヒット</a>
    <a href="dashboard.html">📊 全カテゴリダッシュボード</a>
  </div>

  <div class="section">
    <h2>🗂 大カテゴリから入る (件数の多い順)</h2>
    <div class="l1-grid">
${[...summaries].sort((a, b) => (b.strong + b.consider) - (a.strong + a.consider) || b.count - a.count).map((s) => {
  const slug = L1_SLUG[s.targetL1] || s.targetL1;
  return `
      <div class="l1-card">
        <a href="subcategory-list-${slug}.html" class="l1-title-link">
          <h3>${esc(s.targetL1)}<span class="arrow">→</span></h3>
        </a>
        <div class="nums">
          <a class="num-block num-link" href="subcategory-list-${slug}.html"><strong>${s.count.toLocaleString()}</strong>件</a>
          <a class="num-block num-link" href="subcategory-list-${slug}.html?filter=scanned"><strong>${s.scanned}</strong>分析済</a>
          ${s.strong > 0 ? `<a class="num-block num-link strong" href="subcategory-list-${slug}.html?filter=strong"><strong>${s.strong}</strong>🟢おすすめ</a>` : ''}
          ${s.consider > 0 ? `<a class="num-block num-link consider" href="subcategory-list-${slug}.html?filter=consider"><strong>${s.consider}</strong>🟡ありかも</a>` : ''}
        </div>
      </div>
`;
}).join('')}
    </div>
  </div>

  <div class="footer">
    各L1カードまたは上部タブをクリック → サブカテゴリ一覧 → 行クリックで上位5商品の詳細
  </div>
</div>
</body>
</html>
`;
  fs.writeFileSync(indexPath, html);
  console.log(`✅ index-l1.html 生成`);
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const allL1 = ARG_L1 ? [ARG_L1] : Object.keys(L1_SLUG);
  const summaries = [];
  for (const l1 of allL1) {
    const r = buildOne(l1, data);
    if (!r) continue;
    const summary = buildHTML(r.targetL1, r.outPath, r.cats);
    if (summary) summaries.push(summary);
  }
  if (!ARG_L1 && summaries.length > 1) {
    buildIndexPage(allL1, summaries);
  }
  console.log(`\n合計 ${summaries.length} ページ生成`);
}

main();
