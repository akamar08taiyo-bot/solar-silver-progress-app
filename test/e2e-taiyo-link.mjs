// 申請書・見積書作成（住宅改修・特定福祉用具）から届いた案件を「受注残に入れる」を、ブラウザで確かめる（本番の Firebase にはつながない：にせの Firestore）。
//   sh test/harness/setup.sh /tmp/progress-harness
//   node test/e2e-taiyo-link.mjs /tmp/progress-harness <画像を置くフォルダ>
// 架空の値だけ（見本 花子 など）。Playwright は PLAYWRIGHT（index.mjs の場所）か /opt/node-tools の既定の場所
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {openProgress} from './harness/open.mjs';

const {chromium} = await import(process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.mjs');
const [harness = '/tmp/progress-harness', out = '/tmp/progress-e2e'] = process.argv.slice(2);
mkdirSync(out, {recursive: true});
const lib = path.join(harness, 'lib');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const log = (s) => console.log(`• ${s}`);

const APP = 'artifacts/solar-silver-yukuhashi-test/public/data';
const branch = JSON.stringify({id: 'yukuhashi', name: '行橋営業所', accessKey: 'test'});
const manual = {customerName: '見本 一郎', careHomeName: '見本居宅', category: '住宅改修', source: '居宅', amount: 50000, status: '未売上', isCarryOver: false, isMoveToPrevious: false, isApplying: false, completionDocumentSubmittedDate: '', billingType: 'full', targetMonth: '2026-10', salespersonId: 1, createdAt: '2026-10-01T00:00:00.000Z'};
const seedFS = {
  [`${APP}/staff/1`]: {id: 1, name: '見本 太郎', orderIndex: 0},
  [`${APP}/staff/2`]: {id: 2, name: '見本 次郎', orderIndex: 1},
  [`${APP}/orders/order_manual`]: manual,
};
const summary = (rows) => JSON.stringify({v: 1, updatedAt: Date.now(), rows});
const jutakuRows = [
  {id: 'j1', customer: '見本 花子', staff: '見本 太郎', careOffice: '見本居宅介護支援事業所', month: '2026-10', amount: 120000, tax: 12000, total: 132000, office: '行橋営業所'},
  {id: 'j9', customer: '見本 九郎', staff: '見本 太郎', careOffice: '', month: '2026-10', amount: 9000, office: '小倉営業所'}, // ほかの営業所は出さない
];
const tokuteiRows = [
  {id: 't1', customer: '見本 花子', staff: '見本　次郎', careOffice: '見本地域包括支援センター', month: '2026-10', amount: 28000, tax: 2800, total: 30800, office: '行橋営業所'},
  {id: 't2', customer: '', staff: '', careOffice: '', month: '2026-10', amount: 5000, office: '行橋営業所'}, // お客様名のない作りかけは出さない
];

const browser = await chromium.launch({env: {...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'}});
const {ctx, page, errors, blocked} = await openProgress(browser, {
  lib,
  html,
  seedFS,
  local: {solar_silver_branch_setting: branch, 'taiyo-jutaku-sales-v1': summary(jutakuRows), 'taiyo-tokutei-sales-v1': summary(tokuteiRows)},
});
const notice = page.getByRole('region', {name: '申請書・見積書作成から届いた案件'});
await notice.waitFor({timeout: 20000});
const rows = notice.locator('tbody tr');
assert.equal(await rows.count(), 2);
assert.match(await notice.innerText(), /新しい案件 2件/);
assert.ok(!(await notice.innerText()).includes('見本 九郎'));
// 担当は名前で（すき間のちがいは同じ人）
assert.equal(await notice.getByLabel('見本 花子の担当').first().inputValue(), '1');
assert.equal(await notice.getByLabel('見本 花子の担当').nth(1).inputValue(), '2');
await page.screenshot({path: path.join(out, 'link-notice.png')});
log('届いた案件のお知らせ（新しい2件・ほかの営業所と作りかけは出さない・担当は名前で）OK');

// 受注残に入れる → 2行が増える（もとの行はそのまま）
await notice.getByRole('button', {name: /^受注残に入れる/}).click();
await notice.waitFor({state: 'detached'});
const fs = await page.evaluate(() => window.__fakeFS);
const linked = Object.entries(fs).filter(([k, v]) => k.startsWith('artifacts/solar-silver-yukuhashi-test/public/data/orders/') && v.taiyoLink);
assert.equal(linked.length, 2);
const j1 = linked.find(([, v]) => v.taiyoLink === 'jutaku:j1')[1];
const t1 = linked.find(([, v]) => v.taiyoLink === 'tokutei:t1')[1];
assert.deepEqual([j1.category, j1.customerName, j1.careHomeName, j1.source, j1.amount, j1.status, j1.targetMonth, j1.salespersonId], ['住宅改修', '見本 花子', '見本居宅介護支援事業所', '居宅', 120000, '未売上', '2026-10', 1]);
assert.deepEqual([t1.category, t1.source, t1.amount, t1.salespersonId], ['特定福祉用具販売', '包括', 28000, 2]);
assert.deepEqual(fs[`${APP}/orders/order_manual`], manual);
const writesBefore = await page.evaluate(() => window.__fakeWrites.filter((w) => w.path.includes('/orders/')).length);
assert.equal(writesBefore, 2); // 足した2行だけ（ほかの行は書きかえない）
log('受注残に入れる：2行を足す（区分は事業所名から・状態は未売上）。もとの行は書きかえない OK');

// 受注残一覧にも出る
await page.getByRole('button', {name: '受注残一覧'}).click();
await page.waitForFunction(() => [...document.querySelectorAll('input')].filter((el) => el.value === '見本 花子').length >= 2); // 受注残一覧の行は打てる欄
await page.screenshot({path: path.join(out, 'link-list.png')});

// 見積書の金額・居宅が変わった → 「変わった案件」。入れると、その行の金額・事業所名だけ直す
await page.evaluate((rows) => {
  localStorage.setItem('taiyo-jutaku-sales-v1', JSON.stringify({v: 1, updatedAt: Date.now(), rows}));
  window.dispatchEvent(new Event('focus'));
}, [{...jutakuRows[0], amount: 130000, careOffice: '見本地域包括支援センター'}, jutakuRows[1]]);
await notice.waitFor();
assert.match(await notice.innerText(), /金額などが変わった案件 1件/);
assert.match(await notice.innerText(), /金額 120,000円 → 130,000円/);
await page.screenshot({path: path.join(out, 'link-update.png')});
await notice.getByRole('button', {name: /^受注残に入れる/}).click();
await notice.waitFor({state: 'detached'});
const j1b = Object.values(await page.evaluate(() => window.__fakeFS)).find((v) => v.taiyoLink === 'jutaku:j1');
assert.deepEqual([j1b.amount, j1b.careHomeName, j1b.source, j1b.salespersonId, j1b.targetMonth, j1b.taiyoSynced.amount], [130000, '見本地域包括支援センター', '包括', 1, '2026-10', 130000]);
log('変わった案件：金額・事業所名（区分も）だけ直す OK');

// 「今は入れない」で、この画面を開いているあいだは出さない。「出さない」はこれからも出さない
await page.evaluate((rows) => {
  localStorage.setItem('taiyo-jutaku-sales-v1', JSON.stringify({v: 1, updatedAt: Date.now(), rows}));
  window.dispatchEvent(new Event('focus'));
}, [{...jutakuRows[0], amount: 130000, careOffice: '見本地域包括支援センター'}, {id: 'j3', customer: '見本 三郎', staff: '', careOffice: '', month: '2026-11', amount: 7000, office: '行橋営業所'}, {id: 'j4', customer: '見本 四郎', staff: '', careOffice: '', month: '2026-11', amount: 8000, office: '行橋営業所'}]);
await notice.waitFor();
assert.equal(await notice.locator('tbody tr').count(), 2);
await notice.locator('tbody tr', {hasText: '見本 四郎'}).getByRole('button', {name: '出さない'}).click();
await notice.locator('tbody tr', {hasText: '見本 四郎'}).waitFor({state: 'detached'});
assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('solar_silver_taiyo_link_ignored'))), ['jutaku:j4']);
await notice.getByRole('button', {name: '今は入れない'}).click();
await notice.waitFor({state: 'detached'});
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(300);
assert.equal(await notice.count(), 0);
log('今は入れない・出さない OK');

assert.deepEqual(errors, []);
assert.deepEqual(blocked, []);
await ctx.close();

// スマホの幅・何も届いていないときは出ない
const phone = await openProgress(browser, {lib, html, seedFS, viewport: {width: 390, height: 844}, local: {solar_silver_branch_setting: branch, 'taiyo-tokutei-sales-v1': summary(tokuteiRows)}});
await phone.page.getByRole('region', {name: '申請書・見積書作成から届いた案件'}).waitFor({timeout: 20000});
await phone.page.screenshot({path: path.join(out, 'link-phone.png')});
assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
await phone.ctx.close();
const none = await openProgress(browser, {lib, html, seedFS, local: {solar_silver_branch_setting: branch}});
await none.page.getByText('受注残・進捗管理表').first().waitFor({timeout: 20000});
await none.page.waitForTimeout(1500);
assert.equal(await none.page.getByRole('region', {name: '申請書・見積書作成から届いた案件'}).count(), 0);
assert.deepEqual(none.errors, []);
await none.ctx.close();
log('スマホの幅（横にはみ出さない）・届いていなければ出ない OK');
await browser.close();
console.log('e2e-taiyo-link: all OK');
