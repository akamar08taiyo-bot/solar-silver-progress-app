// 申請書・見積書作成（住宅改修・特定福祉用具）から受注残に入れる案件の決まり（index.html の taiyo-link-begin〜end をそのまま読んで確かめる）。
//   node --test test/
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.slice(html.indexOf('// taiyo-link-begin'), html.indexOf('// taiyo-link-end'));
assert.ok(block.length > 100, 'taiyo-link の印が見つからない');
// index.html のほかの所にある、ブロックが使う関数（同じ中身を index.html から読む）
const pick = (name) => {
  const line = new RegExp(`^const ${name} = .*$`, 'm').exec(html);
  assert.ok(line, `${name} が見つからない`);
  const balanced = (t) => ['{}', '()', '[]'].every(([o, c]) => t.split(o).length === t.split(c).length);
  if (balanced(line[0])) return line[0]; // 1行で終わる
  const end = html.indexOf('\n};', line.index); // 複数行（「};」の行まで）
  return html.slice(line.index, end + 3);
};
const helpers = ['STATUS_RENTAL', 'STATUS_SALES', 'STATUS_HOSPITAL_PLAN', 'RENTAL_CATEGORIES', 'HOSPITAL_PLAN_CATEGORY', 'HOSPITAL_PLAN_LEGACY_CATEGORY', 'isHospitalPlanCategoryName', 'getStatusesByCategory', 'isCompletedStatus', 'inferSourceFromCareHomeName'].map(pick).join('\n');
const lib = new Function(`${helpers}\n${block}\nreturn {readTaiyoLinkRows, planTaiyoLink, taiyoOrderDoc, taiyoOrderPatch, TAIYO_LINK_SOURCES};`)();

const storage = (data) => ({getItem: (k) => (k in data ? data[k] : null)});
const jutaku = (rows) => JSON.stringify({v: 1, updatedAt: 1, rows});
const STAFF = [
  {id: 1, name: '見本 太郎'},
  {id: 2, name: '見本　次郎'},
];

test('読む：住宅改修・特定福祉用具のまとめ。金額のない・月のない・ほかの営業所の案件は入れない。こわれたまとめは空', () => {
  const s = storage({
    'taiyo-jutaku-sales-v1': jutaku([
      {id: 'j1', customer: '見本 花子', staff: '見本 太郎', careOffice: '見本居宅介護支援事業所', month: '2026-10', amount: 120000, total: 132000, office: '行橋営業所'},
      {id: 'j2', customer: '見本 一郎', staff: '', careOffice: '', month: '2026-10', amount: 0, office: '行橋営業所'}, // 金額なし
      {id: 'j3', customer: '見本 三郎', staff: '', careOffice: '', month: '', amount: 5000, office: '行橋営業所'}, // 月なし
      {id: 'j4', customer: '見本 四郎', staff: '', careOffice: '', month: '2026-10', amount: 5000, office: '小倉営業所'}, // ほかの営業所
    ]),
    'taiyo-tokutei-sales-v1': jutaku([{id: 't1', customer: '見本 花子', staff: '見本 次郎', careOffice: '見本地域包括支援センター', month: '2026-11', amount: 28000}]), // 営業所のない古い形
  });
  const rows = lib.readTaiyoLinkRows(s, '行橋営業所');
  assert.deepEqual(
    rows.map((r) => [r.linkKey, r.category, r.customerName, r.careHomeName, r.staffName, r.amount, r.targetMonth]),
    [
      ['jutaku:j1', '住宅改修', '見本 花子', '見本居宅介護支援事業所', '見本 太郎', 120000, '2026-10'],
      ['tokutei:t1', '特定福祉用具販売', '見本 花子', '見本地域包括支援センター', '見本 次郎', 28000, '2026-11'],
    ],
  );
  assert.deepEqual(lib.readTaiyoLinkRows(storage({'taiyo-jutaku-sales-v1': '{こわれた'}), '行橋営業所'), []);
  assert.deepEqual(lib.readTaiyoLinkRows(storage({}), '行橋営業所'), []);
});

test('見くらべる：受注残にない案件は「新しい」（担当は名前で探す。すき間の違いは同じ人）。お客様名のない案件・出さないにした案件は出さない', () => {
  const rows = [
    {linkKey: 'jutaku:j1', category: '住宅改修', customerName: '見本 花子', careHomeName: '', staffName: '見本太郎', amount: 1000, targetMonth: '2026-10'},
    {linkKey: 'tokutei:t1', category: '特定福祉用具販売', customerName: '見本 花子', careHomeName: '', staffName: '見本 次郎', amount: 2000, targetMonth: '2026-10'},
    {linkKey: 'tokutei:t2', category: '特定福祉用具販売', customerName: '見本 花子', careHomeName: '', staffName: 'いない人', amount: 3000, targetMonth: '2026-10'},
    {linkKey: 'jutaku:j2', category: '住宅改修', customerName: '', careHomeName: '', staffName: '', amount: 4000, targetMonth: '2026-10'},
    {linkKey: 'jutaku:j3', category: '住宅改修', customerName: '見本 三郎', careHomeName: '', staffName: '', amount: 5000, targetMonth: '2026-10'},
  ];
  const plan = lib.planTaiyoLink(rows, [], STAFF, ['jutaku:j3']);
  assert.deepEqual(plan.adds.map((x) => [x.linkKey, x.salespersonId]), [['jutaku:j1', 1], ['tokutei:t1', 2], ['tokutei:t2', null]]);
  assert.deepEqual(plan.updates, []);
});

test('見くらべる：入れた行は、変わった項目だけ直す。受注残で手で直した項目・売上済の行はそのまま', () => {
  const synced = {customerName: '見本 花子', careHomeName: '見本居宅介護支援事業所', amount: 120000};
  const order = {id: 'order_1', taiyoLink: 'jutaku:j1', status: '未売上', customerName: '見本 花子', careHomeName: '見本居宅介護支援事業所', amount: 120000, source: '居宅', salespersonId: 1, targetMonth: '2026-10', taiyoSynced: synced};
  const row = {linkKey: 'jutaku:j1', category: '住宅改修', customerName: '見本 花子', careHomeName: '見本地域包括支援センター', staffName: '見本 次郎', amount: 130000, targetMonth: '2026-11'};
  // 金額・事業所名が変わった（担当・月は直さない）
  let plan = lib.planTaiyoLink([row], [order], STAFF);
  assert.equal(plan.adds.length, 0);
  assert.deepEqual(plan.updates.map((x) => x.patch), [{careHomeName: '見本地域包括支援センター', amount: 130000}]);
  // 直す中身：区分は前の事業所名から決めたまま（居宅）なので包括に。入れたときの値も新しく
  assert.deepEqual(lib.taiyoOrderPatch(plan.updates[0]), {careHomeName: '見本地域包括支援センター', amount: 130000, source: '包括', taiyoSynced: {customerName: '見本 花子', careHomeName: '見本地域包括支援センター', amount: 130000}});
  // 受注残で金額を手で直した（文字で入っていても同じに見る）→ 金額はそのまま、事業所名だけ
  plan = lib.planTaiyoLink([row], [{...order, amount: '125000'}], STAFF);
  assert.deepEqual(plan.updates.map((x) => x.patch), [{careHomeName: '見本地域包括支援センター'}]);
  // 区分を手で直していれば区分はそのまま
  assert.equal('source' in lib.taiyoOrderPatch({...plan.updates[0], order: {...order, source: '退院/連携室'}}), false);
  // 売上済の行は直さない
  assert.deepEqual(lib.planTaiyoLink([row], [{...order, status: '売上済'}], STAFF).updates, []);
  // 変わっていなければ何もしない（金額が文字でも）
  assert.deepEqual(lib.planTaiyoLink([{...row, careHomeName: synced.careHomeName, amount: 120000}], [{...order, amount: '120000'}], STAFF), {adds: [], updates: []});
});

test('新しく足す行：受注残一覧の「行を追加」と同じ初めの値（状態は未売上・区分は事業所名から）・どの案件か（taiyoLink）と入れたときの値', () => {
  const row = {linkKey: 'tokutei:t1', category: '特定福祉用具販売', customerName: '見本 花子', careHomeName: '見本地域包括支援センター', staffName: '', amount: 28000, targetMonth: '2026-11'};
  const d = lib.taiyoOrderDoc(row, 2, '2026-10-26T00:00:00.000Z');
  assert.deepEqual(d, {
    customerName: '見本 花子',
    careHomeName: '見本地域包括支援センター',
    category: '特定福祉用具販売',
    source: '包括',
    amount: 28000,
    status: '未売上',
    isCarryOver: false,
    isMoveToPrevious: false,
    isApplying: false,
    completionDocumentSubmittedDate: '',
    billingType: 'full',
    hospitalPlanDayType: null,
    hospitalPlanAmountMode: null,
    hospitalPlanDate: null,
    isHospitalPlanReflected: null,
    targetMonth: '2026-11',
    salespersonId: 2,
    createdAt: '2026-10-26T00:00:00.000Z',
    taiyoLink: 'tokutei:t1',
    taiyoSynced: {customerName: '見本 花子', careHomeName: '見本地域包括支援センター', amount: 28000},
  });
});
