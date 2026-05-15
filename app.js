/* OEMリサーチビューアー — プライスター風 2-pane (左:一覧 右:詳細) */

let DATA = null;
let MY = JSON.parse(localStorage.getItem('oem-my-data') || '{}');
let REVIEWS = JSON.parse(localStorage.getItem('oem-reviews') || '{}'); // { asin: [{rating, title, body, date}, ...] }
let sortKey = 'totalRevenue';
let sortDir = 'desc';
let selectedId = null;

const STATUSES = [
  { key: '',          label: '—' },
  { key: 'interest',  label: '⭐ 興味' },
  { key: 'research',  label: '🔍 深掘' },
  { key: 'sample',    label: '📦 サンプル' },
  { key: 'shipped',   label: '✅ 発売済' },
  { key: 'rejected',  label: '❌ 却下' },
];

const COLUMNS = [
  { key: 'myStatus',     label: 'マイ',      cls: '',         sortable: true,  width: 90,  align: 'center' },
  { key: 'label',        label: 'カテゴリ',   cls: 'label-cell', sortable: true,  width: 200, align: 'left' },
  { key: 'l1Root',       label: 'L1',        cls: '',         sortable: true,  width: 100, align: 'center' },
  { key: 'recommendation', label: '判定',    cls: '',         sortable: true,  width: 85,  align: 'center' },
  { key: 'marketTag',    label: '競合',      cls: '',         sortable: true,  width: 85,  align: 'center' },
  { key: 'score',        label: 'スコア',    cls: 'num',      sortable: true,  width: 80,  align: 'right' },
  { key: 'totalRevenue', label: '月商',      cls: 'num',      sortable: true,  width: 100, align: 'right' },
  { key: 'reviewMedian', label: 'レビュー中', cls: 'num',     sortable: true,  width: 70,  align: 'right' },
  { key: 'topShare',     label: '1位%',     cls: 'num',      sortable: true,  width: 50,  align: 'right' },
  { key: 'ratingMean',   label: '★',       cls: 'num',      sortable: true,  width: 40,  align: 'right' },
  { key: 'avgPrice',     label: '価格',     cls: 'num',      sortable: true,  width: 80,  align: 'right' },
];

function saveMy() { localStorage.setItem('oem-my-data', JSON.stringify(MY)); }
function saveReviews() { localStorage.setItem('oem-reviews', JSON.stringify(REVIEWS)); }

function setMyStatus(catId, status) {
  if (!MY[catId]) MY[catId] = {};
  if (status) MY[catId].status = status; else delete MY[catId].status;
  MY[catId].updatedAt = new Date().toISOString();
  if (!MY[catId].status && !MY[catId].note) delete MY[catId];
  saveMy();
  renderMyPills();
  applyFilters();
  if (selectedId === catId) renderDetail(getCat(catId));
}
function setMyNote(catId, note) {
  if (!MY[catId]) MY[catId] = {};
  MY[catId].note = note;
  MY[catId].updatedAt = new Date().toISOString();
  if (!MY[catId].status && !MY[catId].note) delete MY[catId];
  saveMy();
}

function getCat(id) { return DATA.categories.find((c) => c.id === id); }

async function loadData() {
  const r = await fetch('data/categories.json?t=' + Date.now());
  DATA = await r.json();
  renderTopStats();
  renderMyPills();
  populateL1Filter();
  renderHead();
  applyFilters();
}

function renderTopStats() {
  document.getElementById('stat-total').textContent = DATA.totalCount.toLocaleString();
  document.getElementById('stat-scanned').textContent = DATA.scannedCount.toLocaleString();
  if (DATA.generatedAt) {
    const d = new Date(DATA.generatedAt);
    document.getElementById('stat-updated').textContent = d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  }
}

function renderMyPills() {
  const counts = { interest: 0, research: 0, sample: 0, shipped: 0, rejected: 0 };
  for (const id in MY) {
    const st = MY[id]?.status;
    if (st && counts[st] !== undefined) counts[st]++;
  }
  const el = document.getElementById('my-pills');
  const items = [
    { key: 'interest',  label: '⭐興味' },
    { key: 'research',  label: '🔍深掘' },
    { key: 'sample',    label: '📦サンプル' },
    { key: 'shipped',   label: '✅発売' },
    { key: 'rejected',  label: '❌却下' },
  ];
  const cur = document.getElementById('filter-my')?.value;
  el.innerHTML = items.map((s) =>
    `<span class="my-pill ${cur === s.key ? 'active' : ''}" data-status="${s.key}">${s.label} <strong>${counts[s.key]}</strong></span>`
  ).join('');
  el.querySelectorAll('.my-pill').forEach((p) => {
    p.onclick = () => {
      document.getElementById('filter-my').value = p.dataset.status;
      applyFilters();
      renderMyPills();
    };
  });
}

function populateL1Filter() {
  const sel = document.getElementById('filter-l1');
  if (sel.options.length > 1) return;
  const counts = {};
  for (const c of DATA.categories) {
    const k = c.l1Root || '不明';
    counts[k] = (counts[k] || 0) + 1;
  }
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([l1, n]) => {
    const o = document.createElement('option');
    o.value = l1; o.textContent = `${l1} (${n})`;
    sel.appendChild(o);
  });
}

function renderHead() {
  const tr = document.getElementById('thead-row');
  tr.innerHTML = COLUMNS.map((c) => {
    const sorted = sortKey === c.key;
    return `<th data-sort="${c.key}" class="${sorted ? 'sorted' : ''}" style="min-width:${c.width}px">
      ${c.label}${sorted ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>`;
  }).join('');
  tr.querySelectorAll('th').forEach((th) => {
    th.onclick = () => {
      if (sortKey === th.dataset.sort) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortKey = th.dataset.sort; sortDir = 'desc'; }
      renderHead();
      applyFilters();
    };
  });
}

function compareCat(a, b) {
  const key = sortKey;
  const dir = sortDir === 'desc' ? -1 : 1;
  if (key === 'myStatus') {
    const order = { interest: 1, research: 2, sample: 3, shipped: 4, rejected: 5 };
    return ((order[MY[a.id]?.status] || 99) - (order[MY[b.id]?.status] || 99)) * dir;
  }
  const va = a[key], vb = b[key];
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
  const na = Number(va), nb = Number(vb);
  if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
  return String(va || '').localeCompare(String(vb || ''), 'ja') * dir;
}

function applyFilters() {
  const l1 = document.getElementById('filter-l1').value;
  const reco = document.getElementById('filter-reco').value;
  const tag = document.getElementById('filter-tag').value;
  const my = document.getElementById('filter-my').value;
  const q = document.getElementById('search').value.toLowerCase();

  let list = DATA.categories.slice();
  if (l1) list = list.filter((c) => c.l1Root === l1);
  if (reco) list = list.filter((c) => c.recommendation === reco);
  if (tag) list = list.filter((c) => c.marketTag === tag);
  if (q) list = list.filter((c) => (c.label + ' ' + c.parent).toLowerCase().includes(q));
  if (my) {
    if (my === '__set') list = list.filter((c) => MY[c.id]?.status);
    else if (my === '__none') list = list.filter((c) => !MY[c.id]?.status);
    else list = list.filter((c) => MY[c.id]?.status === my);
  }
  list.sort(compareCat);
  renderTable(list);
  document.getElementById('stat-shown').textContent = list.length.toLocaleString();
}

function recoClass(r) {
  if (!r) return 'reco-hold';
  if (r.includes('強推奨')) return 'reco-strong';
  if (r.includes('検討')) return 'reco-consider';
  if (r.includes('保留')) return 'reco-hold';
  if (r.includes('待機')) return 'status-waiting';
  return 'reco-skip';
}
function tagClass(t) {
  if (!t) return 'tag-neutral';
  if (t.includes('群雄') || t.includes('5社拮抗')) return 'tag-opp';
  if (t.includes('中間')) return 'tag-neutral';
  if (t.includes('二強') || t.includes('寡占')) return 'tag-med';
  if (t.includes('一強')) return 'tag-hard';
  return 'tag-neutral';
}
function scoreColor(s) {
  if (s >= 70) return '#66bb6a';
  if (s >= 50) return '#fdd835';
  if (s >= 30) return '#fb8c00';
  return '#e57373';
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
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTable(list) {
  const tb = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  if (!list.length) { tb.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const max = 500;
  const slice = list.slice(0, max);
  tb.innerHTML = slice.map((c) => renderRow(c)).join('');
  if (list.length > max) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${COLUMNS.length}" style="text-align:center;color:var(--text-dim);padding:10px">…他 ${list.length - max} 件（絞り込んでください）</td>`;
    tb.appendChild(tr);
  }
  bindRowEvents(tb);
}

function renderRow(c) {
  const my = MY[c.id]?.status || '';
  const scoreNum = Number(c.score);
  const scoreShown = isNaN(scoreNum) ? '' : scoreNum;
  const isSelected = selectedId === c.id;
  return `
    <tr class="${my ? 'is-' + my : ''} ${isSelected ? 'selected' : ''}" data-id="${c.id}">
      <td class="center">
        <select class="status-select ${my ? 'set-' + my : ''}" data-cat="${c.id}">
          ${STATUSES.map((s) => `<option value="${s.key}" ${s.key === my ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </td>
      <td class="label-cell">${esc(c.label)}</td>
      <td class="center"><span class="cell-badge l1">${esc(c.l1Root || '')}</span></td>
      <td class="center"><span class="cell-badge ${recoClass(c.recommendation || c.status)}">${esc((c.recommendation || c.status || '').replace(/^[🟢🟡⚪❌🔴⏳]\s*/, ''))}</span></td>
      <td class="center">${c.marketTag ? `<span class="cell-badge ${tagClass(c.marketTag)}">${esc(c.marketTag.replace(/^[🟢🟡⚪🟠🔴]\s*/, ''))}</span>` : '-'}</td>
      <td class="num">${scoreShown !== '' ? `
        <div class="score-cell">
          <div class="score-bar"><div class="score-bar-fill" style="width:${Math.max(0, Math.min(100, scoreNum))}%;background:${scoreColor(scoreNum)}"></div></div>
          <span class="score-num">${scoreShown}</span>
        </div>` : '-'}
      </td>
      <td class="num">${fmt(c.totalRevenue, '¥')}</td>
      <td class="num">${fmt(c.reviewMedian)}</td>
      <td class="num">${fmtPct(c.topShare)}</td>
      <td class="num">${c.ratingMean ? Number(c.ratingMean).toFixed(1) : '-'}</td>
      <td class="num">${fmt(c.avgPrice, '¥')}</td>
    </tr>
  `;
}

function bindRowEvents(tb) {
  tb.querySelectorAll('.status-select').forEach((s) => {
    s.onclick = (e) => e.stopPropagation();
    s.onchange = (e) => { e.stopPropagation(); setMyStatus(s.dataset.cat, s.value); };
  });
  tb.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('.status-select')) return;
      selectCategory(tr.dataset.id);
    };
  });
}

function selectCategory(id) {
  selectedId = id;
  const cat = getCat(id);
  if (!cat) return;
  document.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
  renderDetail(cat);
}

function renderDetail(c) {
  const pane = document.getElementById('detail-pane');
  const my = MY[c.id]?.status || '';
  const myNote = MY[c.id]?.note || '';
  const tops = (c.top || []).filter((t) => t.title || t.price);
  const scoreNum = Number(c.score);

  pane.innerHTML = `
    <div class="detail-head">
      <div class="crumb">${esc(c.l1Root || '')} / ${esc(c.parent || '')}</div>
      <div class="title-row">
        <h2>${esc(c.label)}</h2>
        <span class="cell-badge ${recoClass(c.recommendation || c.status)}">${esc(c.recommendation || c.status)}</span>
        ${c.marketTag ? `<span class="cell-badge ${tagClass(c.marketTag)}">${esc(c.marketTag)}</span>` : ''}
        <select class="status-select" id="d-status" style="width:120px">
          ${STATUSES.map((s) => `<option value="${s.key}" ${s.key === my ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="ext-links">
        <a href="${c.amazonBsrUrl}" target="_blank">📊 Amazon BSR</a>
        <a href="https://www.amazon.co.jp/s?k=${encodeURIComponent(c.label)}" target="_blank">🔍 Amazon検索</a>
        <a href="https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(c.label)}" target="_blank">🌏 Alibaba</a>
        <a href="https://www.1688.com/zw/search.htm?keywords=${encodeURIComponent(c.label)}" target="_blank">🏭 1688</a>
      </div>
    </div>

    <div class="detail-body">
      <div class="section">
        <div class="section-head">📈 市場サマリー</div>
        <div class="section-body">
          <div class="kv-grid">
            <div class="kv"><span class="kv-label">参入しやすさ</span><span class="kv-value">${isNaN(scoreNum) ? '-' : scoreNum + '/100'}</span></div>
            <div class="kv"><span class="kv-label">市場月商</span><span class="kv-value">${fmt(c.totalRevenue, '¥')}</span></div>
            <div class="kv"><span class="kv-label">レビュー中央</span><span class="kv-value">${fmt(c.reviewMedian)}</span></div>
            <div class="kv"><span class="kv-label">1位シェア</span><span class="kv-value">${fmtPct(c.topShare)}</span></div>
            <div class="kv"><span class="kv-label">★平均</span><span class="kv-value">${c.ratingMean ? Number(c.ratingMean).toFixed(1) : '-'}</span></div>
            <div class="kv"><span class="kv-label">平均価格</span><span class="kv-value">${fmt(c.avgPrice, '¥')}</span></div>
            <div class="kv"><span class="kv-label">分析商品数</span><span class="kv-value">${fmt(c.productsScored)}</span></div>
            <div class="kv"><span class="kv-label">競合詳細</span><span class="kv-value" style="font-size:10px">${esc(c.marketDetail || '-')}</span></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">🥇 上位5社 競合</div>
        <div class="section-body" style="padding:0">
          ${tops.length ? `
          <table class="top5">
            <thead><tr>
              <th style="width:30px">順</th>
              <th>商品名</th>
              <th style="width:80px">価格</th>
              <th style="width:50px">★</th>
              <th style="width:80px">レビュー</th>
              <th style="width:60px">操作</th>
            </tr></thead>
            <tbody>
              ${tops.map((t) => renderTop5Row(t)).join('')}
            </tbody>
          </table>` : '<div style="padding:14px;color:var(--text-dim);text-align:center">未scanまたはデータなし</div>'}
        </div>
      </div>

      <div class="section">
        <div class="section-head">💬 レビュー（5社まとめ）</div>
        <div class="section-body">
          ${renderReviewsSection(c, tops)}
        </div>
      </div>

      <div class="section">
        <div class="section-head">📝 マイメモ <span class="note-saved" id="note-saved">✓ 保存</span></div>
        <div class="section-body" style="padding:6px">
          <textarea class="note-area" id="my-note" placeholder="原価メモ / 工場URL / サンプル発注日 / 差別化アイデア など自由記述">${esc(myNote)}</textarea>
        </div>
      </div>
    </div>
  `;

  // bind
  document.getElementById('d-status').onchange = (e) => {
    setMyStatus(c.id, e.target.value);
    e.target.className = 'status-select ' + (e.target.value ? 'set-' + e.target.value : '');
  };
  document.getElementById('d-status').className = 'status-select ' + (my ? 'set-' + my : '');

  const ta = document.getElementById('my-note');
  const ind = document.getElementById('note-saved');
  let timer;
  ta.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setMyNote(c.id, ta.value);
      ind.classList.add('visible');
      setTimeout(() => ind.classList.remove('visible'), 1500);
    }, 400);
  };
}

function renderTop5Row(t) {
  const asin = extractAsin(t.title);
  return `
    <tr class="rank-${t.rank}">
      <td class="rank-cell">${t.rank}</td>
      <td class="title-cell">${asin ? `<a href="https://www.amazon.co.jp/dp/${asin}" target="_blank" title="${esc(t.title)}">${esc(t.title).slice(0, 70)}</a>` : esc(t.title || '?')}</td>
      <td class="num">${fmt(t.price, '¥')}</td>
      <td class="num">${t.rating ? Number(t.rating).toFixed(1) : '-'}</td>
      <td class="num">${fmt(t.reviews)}</td>
      <td class="center">${asin ? `<a href="https://www.amazon.co.jp/product-reviews/${asin}/?reviewerType=all_reviews&sortBy=recent" target="_blank" style="font-size:10px">レビュー</a>` : '-'}</td>
    </tr>
  `;
}

function extractAsin(title) {
  if (!title) return null;
  // titleが HYPERLINK formula text の場合、extractできる
  const m = title.match(/dp\/(\w+)/);
  return m ? m[1] : null;
}

function renderReviewsSection(c, tops) {
  // 各 ASIN の保存済レビューを表示
  const asins = tops.map((t) => extractAsin(t.title)).filter(Boolean);
  const cached = asins.flatMap((a) => (REVIEWS[a] || []).map((r) => ({ ...r, asin: a })));
  if (!cached.length) {
    return `
      <div class="review-empty">
        まだレビューを取得していません。<br>
        各商品の右側「レビュー」リンクからAmazonページを開いて確認するか、<br>
        Stage 2 で一括スクレイプ（Playwright + Amazon scrape）して取得します。<br>
        <button class="btn-scrape" onclick="alert('Playwright スクレイプは次フェーズで実装します')">📥 5社レビュー一括取得（次フェーズ）</button>
      </div>
    `;
  }
  return `<div class="review-list">${cached.slice(0, 50).map((r) => `
    <div class="review-item">
      <div class="review-meta">
        <span class="review-stars">${'★'.repeat(Math.round(r.rating || 0))}</span>
        <span>${esc(r.date || '')}</span>
        <span>ASIN: ${r.asin}</span>
      </div>
      <div class="review-text">${esc(r.body || r.title || '').slice(0, 200)}</div>
    </div>
  `).join('')}</div>`;
}

function exportMyData() {
  const out = {
    exportedAt: new Date().toISOString(),
    items: Object.entries(MY).map(([id, v]) => {
      const cat = DATA.categories.find((c) => c.id === id);
      return { id, label: cat?.label || '', l1Root: cat?.l1Root || '', ...v };
    }),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `oem-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Events
['filter-l1', 'filter-reco', 'filter-tag', 'filter-my'].forEach((id) => {
  document.getElementById(id).onchange = () => { applyFilters(); renderMyPills(); };
});
document.getElementById('search').oninput = () => {
  clearTimeout(window._t);
  window._t = setTimeout(applyFilters, 200);
};
document.getElementById('btn-clear').onclick = () => {
  ['filter-l1', 'filter-reco', 'filter-tag', 'filter-my'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('search').value = '';
  applyFilters(); renderMyPills();
};
document.getElementById('btn-reload').onclick = () => loadData();
document.getElementById('btn-export').onclick = exportMyData;

loadData().catch((e) => {
  document.getElementById('tbody').innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-state">データロード失敗: ${e.message}</td></tr>`;
});
