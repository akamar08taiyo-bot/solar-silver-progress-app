// 受注残・進捗管理（index.html）を、本番の Firebase・CDN につながずにブラウザで開く。
// CDN の React・lucide-react・Babel・Tailwind は setup.sh で作った手元のもの、Firebase はにせもの（fake-firebase-*.js。window.__fakeFS にだけ書く）。
// localhost 以外への通信は止める（止めた URL は blocked に入る）
import {readFileSync} from 'node:fs';
import path from 'node:path';

const FILES = [
  [/^https:\/\/esm\.sh\/react@[^/]+\/jsx(-dev)?-runtime/, 'jsx-runtime.js'],
  [/^https:\/\/esm\.sh\/react-dom@[^/]+\/client/, 'react-dom-client.js'],
  [/^https:\/\/esm\.sh\/react@[\d.]+$/, 'react.js'],
  [/^https:\/\/esm\.sh\/lucide-react/, 'lucide-react.js'],
  [/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-app\.js$/, 'fake-firebase-app.js'],
  [/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-auth\.js$/, 'fake-firebase-auth.js'],
  [/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-firestore\.js$/, 'fake-firebase-firestore.js'],
  [/^https:\/\/unpkg\.com\/@babel\/standalone@/, 'babel.min.js'],
  [/^http:\/\/progress\.test\/lib\/react-all\.js$/, 'react-all.js'],
];

/**
 * lib：setup.sh の出力のフォルダの lib。seedFS：にせの Firestore の初めの中身（'artifacts/…/orders/id' → データ）。local：localStorage の初めの中身。
 * pageUrl と ctx を渡すと、ほかのアプリと同じサイト（localhost）に置いた index.html をその context で開く（同じ localStorage を使う。localhost への通信は通す）
 */
export async function openProgress(browser, {lib, html, seedFS = {}, local = {}, viewport = {width: 1366, height: 900}, pageUrl = 'http://progress.test/index.html', ctx: given = null}) {
  const ctx = given ?? (await browser.newContext({viewport, locale: 'ja-JP'}));
  const blocked = [];
  const tw = readFileSync(path.join(lib, 'tw.css'), 'utf8');
  await ctx.route('**/*', async (route) => {
    const req = route.request().url();
    if (req === 'http://progress.test/index.html') return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html});
    if (/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(req)) return route.continue();
    if (/^https:\/\/cdn\.tailwindcss\.com/.test(req))
      return route.fulfill({status: 200, contentType: 'text/javascript', body: `window.tailwind = {config: {}}; (() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(tw)}; document.head.appendChild(s); })();`});
    const hit = FILES.find(([re]) => re.test(req));
    if (hit) return route.fulfill({status: 200, contentType: 'text/javascript', body: readFileSync(path.join(lib, hit[1]), 'utf8')});
    blocked.push(req);
    return route.abort();
  });
  await ctx.addInitScript(
    ({seedFS, local}) => {
      window.__fakeFS = seedFS;
      try {
        if (!sessionStorage.getItem('__seeded')) {
          for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
          sessionStorage.setItem('__seeded', '1');
        }
      } catch {}
    },
    {seedFS, local},
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(pageUrl);
  return {ctx, page, errors, blocked};
}
