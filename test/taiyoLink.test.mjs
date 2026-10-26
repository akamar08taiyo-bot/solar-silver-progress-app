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
const lib = new Function(`${helpers}\n${block}\nreturn {readTaiyoLinkRows, planTaiyoLink, taiyoOrderDoc, taiyoOrderPatch, taiyoStaffOf, TAIYO_LINK_SOURCES};`)();

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

test('重ねて入れない：同じお客様・区分・月の行が受注残にあれば足さない（手で入れた行・別に作った同じ案件）。届いた中の同じ案件も1つだけ', () => {
  const row = {linkKey: 'tokutei:t9', category: '特定福祉用具販売', customerName: '見本 花子', careHomeName: '', staffName: '', amount: 28000, targetMonth: '2026-10'};
  const hand = {id: 'order_9', status: '未売上', customerName: '見本　花子', category: '特定福祉用具販売', targetMonth: '2026-10', amount: 28000};
  assert.deepEqual(lib.planTaiyoLink([row], [hand], STAFF), {adds: [], updates: []});
  // 売上済の行・ほかの区分・ほかの月なら、新しい案件として出す
  assert.equal(lib.planTaiyoLink([row], [{...hand, status: '売上済'}], STAFF).adds.length, 1);
  assert.equal(lib.planTaiyoLink([row], [{...hand, category: '住宅改修'}], STAFF).adds.length, 1);
  assert.equal(lib.planTaiyoLink([row], [{...hand, targetMonth: '2026-11'}], STAFF).adds.length, 1);
  // 届いた中で同じお客様・区分・月・金額の案件（同じ案件を2つ作っていた）は1つだけ。金額がちがえば別の案件
  assert.deepEqual(lib.planTaiyoLink([row, {...row, linkKey: 'tokutei:t10'}], [], STAFF).adds.map((x) => x.linkKey), ['tokutei:t9']);
  assert.equal(lib.planTaiyoLink([row, {...row, linkKey: 'tokutei:t10', amount: 9000}], [], STAFF).adds.length, 2);
  // 入れたあと保存しなおしても（同じ taiyoLink）足さない
  const linked = {...hand, taiyoLink: 'tokutei:t9', taiyoSynced: {customerName: '見本 花子', careHomeName: '', amount: 28000}, customerName: '見本 花子', careHomeName: ''};
  assert.deepEqual(lib.planTaiyoLink([row], [linked], STAFF), {adds: [], updates: []});
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
    taiyoSynced: {customerName: '見本 花子', careHomeName: '見本地域包括支援センター', amount: 28000, salespersonId: null},
  });
  // 入れたときの担当は、見積書の担当から探した担当（お知らせで選び直した担当ではない）
  assert.deepEqual([lib.taiyoOrderDoc({...row, salespersonId: 1}, 2, '').salespersonId, lib.taiyoOrderDoc({...row, salespersonId: 1}, 2, '').taiyoSynced.salespersonId], [2, 1]);
});

test('担当を探す（ユーザーの指示「受注残の中でも担当の受注残に入るように紐づける」）：同じ名前（すき間・全角半角）→ 前に選んだ担当 → 姓だけ同じ人が1人', () => {
  const staff = [
    {id: 1, name: '見本 太郎'},
    {id: 2, name: '例題'},
    {id: 3, name: '試験 花子'},
    {id: 4, name: '試験 一郎'},
  ];
  const id = (name, memory) => lib.taiyoStaffOf(name, staff, memory)?.id ?? null;
  assert.equal(id('見本太郎'), 1);
  assert.equal(id('見本　太郎'), 1);
  assert.equal(id('ﾐﾎﾝ'), null);
  assert.equal(id('見本'), 1); // 姓だけ（担当者は姓と名）
  assert.equal(id('例題 二郎'), 2); // 担当者は姓だけ
  assert.equal(id('例題二郎'), null); // すき間がなければ、どこまでが姓か分からない
  assert.equal(id('試験'), null); // 姓が同じ人が2人
  assert.equal(id('試験 次郎'), null);
  assert.equal(id(''), null);
  assert.equal(id('いない人'), null);
  // この端末で前に選んだ担当（同じ名前の担当者がいればそちら。いなくなった担当者は使わない）
  assert.equal(id('例題二郎', {例題二郎: 2}), 2);
  assert.equal(id('試験次郎', {試験次郎: 4}), 4);
  assert.equal(id('見本太郎', {見本太郎: 3}), 1);
  assert.equal(id('いない人', {いない人: 99}), null);
  // 見くらべるときも使う
  const row = {linkKey: 'jutaku:j7', category: '住宅改修', customerName: '見本 七子', careHomeName: '', staffName: '例題二郎', amount: 1000, targetMonth: '2026-10'};
  assert.equal(lib.planTaiyoLink([row], [], staff, [], {例題二郎: 2}).adds[0].salespersonId, 2);
  assert.equal(lib.planTaiyoLink([row], [], staff).adds[0].salespersonId, null);
});

test('担当が変わった：見積書で担当を変えたら、受注残で担当を手で直していない行は新しい担当へ。見つからない担当・前の版で入れた行はそのまま', () => {
  const synced = {customerName: '見本 花子', careHomeName: '', amount: 1000, salespersonId: 1};
  const order = {id: 'order_5', taiyoLink: 'tokutei:t5', status: '未売上', customerName: '見本 花子', careHomeName: '', amount: 1000, salespersonId: 1, targetMonth: '2026-10', taiyoSynced: synced};
  const row = {linkKey: 'tokutei:t5', category: '特定福祉用具販売', customerName: '見本 花子', careHomeName: '', staffName: '見本 次郎', amount: 1000, targetMonth: '2026-10'};
  const plan = lib.planTaiyoLink([row], [order], STAFF);
  assert.deepEqual(plan.updates.map((x) => x.patch), [{salespersonId: 2}]);
  assert.deepEqual(lib.taiyoOrderPatch(plan.updates[0]), {salespersonId: 2, taiyoSynced: {...synced, salespersonId: 2}});
  // 同じ担当のまま・受注残で担当を手で直した・見つからない担当・空の担当・入れたときの担当がない（前の版）は直さない
  assert.deepEqual(lib.planTaiyoLink([{...row, staffName: '見本 太郎'}], [order], STAFF).updates, []);
  assert.deepEqual(lib.planTaiyoLink([row], [{...order, salespersonId: 3}], STAFF).updates, []);
  assert.deepEqual(lib.planTaiyoLink([{...row, staffName: 'いない人'}], [order], STAFF).updates, []);
  assert.deepEqual(lib.planTaiyoLink([{...row, staffName: ''}], [order], STAFF).updates, []);
  const {salespersonId: _old, ...oldSynced} = synced;
  assert.deepEqual(lib.planTaiyoLink([row], [{...order, taiyoSynced: oldSynced}], STAFF).updates, []);
});
