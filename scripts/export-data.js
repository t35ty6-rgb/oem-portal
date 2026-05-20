#!/usr/bin/env node
/**
 * Sheets「全カテゴリ一覧」タブ → portal/data/categories.json にエクスポート
 * ポータルが読み込む静的JSONを生成。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TAB = '全カテゴリ一覧';

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const s = google.sheets({ version: 'v4', auth });
  const sheetId = process.env.SHEET_ID;

  const r = await s.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A1:AN20000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = r.data.values || [];
  if (rows.length < 2) {
    console.log('No data, exporting empty');
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'categories.json'),
      JSON.stringify({ categories: [], generatedAt: new Date().toISOString() }, null, 2));
    return;
  }

  const headers = rows[0];
  const idx = (label) => headers.indexOf(label);
  const get = (row, label) => row[idx(label)];

  const categories = rows.slice(1)
    .filter((r) => r[idx('カテゴリ名')] || r[idx('ID')])
    .map((r, i) => ({
      idx: i + 1,
      rowNum: get(r, '#'),
      status: get(r, '状態') || '⏳ 待機',
      recommendation: get(r, '判定') || '',
      marketTag: get(r, '競合パターン') || '',
      l1Root: get(r, '大カテゴリ') || '',
      id: String(get(r, 'ID') || ''),
      label: get(r, 'カテゴリ名') || '',
      parent: get(r, '所属パス') || '',
      tier: get(r, '階層') || '',
      score: get(r, '参入しやすさ'),
      totalRevenue: get(r, '市場月商合計'),
      reviewMedian: get(r, '競合レビュー中央'),
      topShare: get(r, '1位シェア'),
      ratingMean: get(r, '★平均評価'),
      avgPrice: get(r, '平均販売価格'),
      stabilityMean: get(r, '売上安定度'),
      productsScored: get(r, '分析商品数'),
      marketDetail: get(r, '競合詳細') || '',
      amazonBsrUrl: `https://www.amazon.co.jp/gp/bestsellers/-/${get(r, 'ID')}/`,
      top: [1, 2, 3, 4, 5].map((n) => ({
        rank: n,
        title: get(r, `${n}位 商品名`) || '',
        price: get(r, `${n}位 価格`),
        rating: get(r, `${n}位 ★`),
        reviews: get(r, `${n}位 レビュー数`),
      })).filter((t) => t.title || t.price),
      updatedAt: get(r, '更新日時') || '',
    }));

  const out = {
    generatedAt: new Date().toISOString(),
    totalCount: categories.length,
    scannedCount: categories.filter((c) => c.status?.includes('scan済')).length,
    categories,
  };

  const outPath = path.join(__dirname, '..', 'data', 'categories.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Exported ${categories.length} categories (${out.scannedCount} scanned) → ${outPath}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
