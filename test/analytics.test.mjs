// 分析タブの集計ロジック検証。index.html の analyticsData useMemo の中身をそのまま写している。
// src側を変えたらこちらも必ず同時に更新すること。
import assert from 'node:assert';

// ---- index.html から写した定数・ヘルパー ----
const RENTAL_CATEGORIES = ['レンタル新規', '既存追加', '特価ベッド'];
const HOSPITAL_PLAN_CATEGORY = '入退院（予定）';
const HOSPITAL_PLAN_LEGACY_CATEGORY = '入退院予定者';
const SALES_CATEGORIES = ['住宅改修', '特定福祉用具販売', HOSPITAL_PLAN_CATEGORY, '一般販売', '紙おむつ', '消耗品'];
const OTHER_SALES_CATS = ['一般販売', '紙おむつ', '消耗品'];
const allCategories = [...RENTAL_CATEGORIES, ...SALES_CATEGORIES];

const isCompletedStatus = (status) => status === '確定済' || status === '売上済';
const isHospitalPlanCategoryName = (category) => category === HOSPITAL_PLAN_CATEGORY || category === HOSPITAL_PLAN_LEGACY_CATEGORY;
const getHospitalPlanSignedAmount = (order) => {
  if (!isHospitalPlanCategoryName(order?.category)) return 0;
  const amount = Number(order.amount || 0);
  if (order.hospitalPlanAmountMode === 'adjusted') {
    if (order.status === '入院予定' || order.status === '入院（予定）') return -amount;
    if (order.status === '退院予定' || order.status === '退院（予定）') return amount;
    return 0;
  }
  return amount;
};
const getOffsetMonth = (monthStr, offset) => {
  const [y, m] = monthStr.split('-');
  const d = new Date(Number(y), Number(m) - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const getOrderAccountingMonth = (order) => (order?.isCarryOver ? getOffsetMonth(order.targetMonth, 1) : order?.targetMonth);
const getFiscalYearMonths = (monthStr) => {
  const [y, m] = monthStr.split('-');
  let year = Number(y);
  if (Number(m) < 4) year -= 1;
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, 3 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};
const getRankingPeriodMonths = (monthStr, period) => {
  const fiscalMonths = getFiscalYearMonths(monthStr);
  if (period === 'month') return [monthStr];
  if (period === 'q1') return fiscalMonths.slice(0, 3);
  if (period === 'q2') return fiscalMonths.slice(3, 6);
  if (period === 'q3') return fiscalMonths.slice(6, 9);
  if (period === 'q4') return fiscalMonths.slice(9, 12);
  if (period === 'firstHalf') return fiscalMonths.slice(0, 6);
  if (period === 'secondHalf') return fiscalMonths.slice(6, 12);
  return fiscalMonths;
};
const getRankingPeriodLabel = () => 'ラベル';

// ---- analyticsData 本体（index.html から写し） ----
function buildAnalytics({ orders, salespersons, currentMonth, analyticsPeriod, analyticsStaffId, BRANCH_NAME }) {
  const periodMonths = getRankingPeriodMonths(currentMonth, analyticsPeriod);
  const monthSet = new Set(periodMonths);
  const previousMonthSet = new Set(periodMonths.map((m) => getOffsetMonth(m, -12)));
  const matchStaff = (o) => analyticsStaffId === 'all' || Number(o.salespersonId) === Number(analyticsStaffId);
  const periodOrders = orders.filter((o) => matchStaff(o) && monthSet.has(getOrderAccountingMonth(o)));
  const previousOrders = orders.filter((o) => matchStaff(o) && previousMonthSet.has(getOrderAccountingMonth(o)));
  const elapsedMonths = periodMonths.filter((m) => m <= currentMonth).length;
  const avgDivisor = Math.max(1, elapsedMonths);
  const normalizeCat = (cat) => (isHospitalPlanCategoryName(cat) ? HOSPITAL_PLAN_CATEGORY : cat);
  const staffName = (id) => salespersons.find((s) => Number(s.id) === Number(id))?.name || '未設定';
  const orderAmount = (o) => (isHospitalPlanCategoryName(o.category) ? getHospitalPlanSignedAmount(o) : Number(o.amount || 0));

  const categoryRows = allCategories.map((cat) => {
    const catOrders = periodOrders.filter((o) => normalizeCat(o.category) === cat);
    const prevCount = previousOrders.filter((o) => normalizeCat(o.category) === cat).length;
    const amount = catOrders.reduce((sum, o) => sum + orderAmount(o), 0);
    const doneCnt = catOrders.filter((o) => isCompletedStatus(o.status)).length;
    const isHospital = isHospitalPlanCategoryName(cat);
    return {
      cat,
      label: cat === '特定福祉用具販売' ? '特定福祉用具' : cat,
      count: catOrders.length,
      monthlyAvg: catOrders.length / avgDivisor,
      prevCount,
      yoy: prevCount > 0 ? (catOrders.length / prevCount) * 100 : null,
      amount,
      avgUnitPrice: catOrders.length > 0 ? amount / catOrders.length : 0,
      doneRate: isHospital || catOrders.length === 0 ? null : (doneCnt / catOrders.length) * 100,
      doneCnt,
      isHospital
    };
  }).filter((row) => row.count > 0 || row.prevCount > 0);

  const facilityMap = new Map();
  let unnamedCount = 0;
  for (const o of periodOrders) {
    if (OTHER_SALES_CATS.includes(o.category)) continue;
    const name = String(o.careHomeName || '').trim();
    if (!name) { unnamedCount += 1; continue; }
    if (!facilityMap.has(name)) facilityMap.set(name, { name, count: 0, amount: 0, sourceCount: {}, categoryCount: {}, staffIds: new Set(), lastMonth: '' });
    const entry = facilityMap.get(name);
    const month = getOrderAccountingMonth(o);
    entry.count += 1;
    entry.amount += orderAmount(o);
    if (o.source) entry.sourceCount[o.source] = (entry.sourceCount[o.source] || 0) + 1;
    const catLabel = normalizeCat(o.category);
    entry.categoryCount[catLabel] = (entry.categoryCount[catLabel] || 0) + 1;
    if (o.salespersonId) entry.staffIds.add(Number(o.salespersonId));
    if (month && month > entry.lastMonth) entry.lastMonth = month;
  }
  const facilityRows = Array.from(facilityMap.values()).map((entry) => ({
    ...entry,
    mainSource: Object.entries(entry.sourceCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    staffLabel: Array.from(entry.staffIds).map(staffName).join('・') || '—',
    topCategories: Object.entries(entry.categoryCount).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c === '特定福祉用具販売' ? '特定福祉用具' : c}${n}`).join(' / ')
  })).sort((a, b) => b.count - a.count || b.amount - a.amount);

  const staffRows = salespersons.filter((s) => s?.id && (analyticsStaffId === 'all' || Number(s.id) === Number(analyticsStaffId))).map((staff) => {
    const staffOrders = periodOrders.filter((o) => Number(o.salespersonId) === Number(staff.id));
    const prevCount = previousOrders.filter((o) => Number(o.salespersonId) === Number(staff.id)).length;
    const rateTarget = staffOrders.filter((o) => !isHospitalPlanCategoryName(o.category));
    const doneCnt = rateTarget.filter((o) => isCompletedStatus(o.status)).length;
    const facilities = new Set(staffOrders.filter((o) => !OTHER_SALES_CATS.includes(o.category)).map((o) => String(o.careHomeName || '').trim()).filter(Boolean));
    return {
      id: staff.id,
      name: staff.name,
      count: staffOrders.length,
      monthlyAvg: staffOrders.length / avgDivisor,
      prevCount,
      yoy: prevCount > 0 ? (staffOrders.length / prevCount) * 100 : null,
      amount: staffOrders.reduce((sum, o) => sum + orderAmount(o), 0),
      doneRate: rateTarget.length > 0 ? (doneCnt / rateTarget.length) * 100 : null,
      facilityCount: facilities.size
    };
  }).sort((a, b) => b.count - a.count);

  const sourceCount = { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 };
  for (const o of periodOrders) {
    if (o.source && sourceCount[o.source] !== undefined) sourceCount[o.source] += 1;
  }
  const sourceTotal = Object.values(sourceCount).reduce((sum, v) => sum + v, 0);

  const totalCount = periodOrders.length;
  const previousTotal = previousOrders.length;
  return {
    periodLabel: getRankingPeriodLabel(analyticsPeriod),
    staffLabel: analyticsStaffId === 'all' ? `${BRANCH_NAME} 全体` : staffName(analyticsStaffId),
    elapsedMonths,
    avgDivisor,
    totalCount,
    monthlyAvg: totalCount / avgDivisor,
    previousTotal,
    yoy: previousTotal > 0 ? (totalCount / previousTotal) * 100 : null,
    totalAmount: periodOrders.reduce((sum, o) => sum + orderAmount(o), 0),
    categoryRows,
    facilityRows,
    unnamedCount,
    facilityTotal: facilityMap.size,
    staffRows,
    sourceCount,
    sourceTotal
  };
}

// ---- テストデータ ----
const salespersons = [{ id: 1, name: '田中' }, { id: 2, name: '佐藤' }];
const orders = [
  { id: 'o1', targetMonth: '2026-04', category: 'レンタル新規', status: '確定済', amount: 10000, careHomeName: 'A居宅', source: '居宅', salespersonId: 1 },
  { id: 'o2', targetMonth: '2026-05', category: 'レンタル新規', status: '未確定', amount: 20000, careHomeName: 'A居宅', source: '居宅', salespersonId: 1 },
  { id: 'o3', targetMonth: '2026-06', category: '住宅改修', status: '売上済', amount: 300000, careHomeName: 'B包括', source: '包括', salespersonId: 2 },
  { id: 'o4', targetMonth: '2026-09', category: 'レンタル新規', status: '確定済', amount: 30000, careHomeName: 'B包括', source: '包括', salespersonId: 2 },
  { id: 'o5', targetMonth: '2025-09', category: 'レンタル新規', status: '確定済', amount: 5000, careHomeName: 'A居宅', source: '居宅', salespersonId: 1 },
  { id: 'o6', targetMonth: '2026-08', category: '一般販売', status: '売上済', amount: 50000, careHomeName: '', source: 'その他', salespersonId: 1 }
];
const base = { orders, salespersons, currentMonth: '2026-09', analyticsPeriod: 'fiscalYear', analyticsStaffId: 'all', BRANCH_NAME: 'テスト営業所' };

let pass = 0;
const check = (name, actual, expected) => {
  assert.deepStrictEqual(actual, expected, `${name}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  pass += 1;
};

// --- 全体サマリー ---
const a = buildAnalytics(base);
check('経過月数(4〜9月)', a.elapsedMonths, 6);
check('期間内件数', a.totalCount, 5);
check('月平均', Math.round(a.monthlyAvg * 100) / 100, 0.83);
check('前年同期件数', a.previousTotal, 1);
check('前年比', a.yoy, 500);
check('金額合計', a.totalAmount, 410000);

// --- カテゴリ別 ---
const rental = a.categoryRows.find((r) => r.cat === 'レンタル新規');
check('レンタル新規 件数', rental.count, 3);
check('レンタル新規 月平均', Math.round(rental.monthlyAvg * 100) / 100, 0.5);
check('レンタル新規 前年件数', rental.prevCount, 1);
check('レンタル新規 前年比', rental.yoy, 300);
check('レンタル新規 金額', rental.amount, 60000);
check('レンタル新規 1件平均', rental.avgUnitPrice, 20000);
check('レンタル新規 確定率(2/3)', Math.round(rental.doneRate), 67);

const reform = a.categoryRows.find((r) => r.cat === '住宅改修');
check('住宅改修 件数', reform.count, 1);
check('住宅改修 前年比は前年0件なのでnull', reform.yoy, null);
check('住宅改修 確定率', reform.doneRate, 100);

check('登録0件のカテゴリは行に出さない', a.categoryRows.find((r) => r.cat === '特価ベッド'), undefined);

// --- 事業所別（一般販売は対象外・金額順で同数を並べ替え） ---
check('事業所数', a.facilityTotal, 2);
check('事業所名 未入力件数(一般販売は除外済み)', a.unnamedCount, 0);
check('1位は金額の多いB包括', a.facilityRows[0].name, 'B包括');
check('B包括 件数', a.facilityRows[0].count, 2);
check('B包括 金額', a.facilityRows[0].amount, 330000);
check('B包括 最終依頼月', a.facilityRows[0].lastMonth, '2026-09');
check('B包括 区分', a.facilityRows[0].mainSource, '包括');
check('B包括 担当', a.facilityRows[0].staffLabel, '佐藤');
check('A居宅 最終依頼月', a.facilityRows[1].lastMonth, '2026-05');
check('A居宅 内訳', a.facilityRows[1].topCategories, 'レンタル新規2');

// --- 担当者別 ---
const tanaka = a.staffRows.find((r) => r.id === 1);
check('田中 件数', tanaka.count, 3);
check('田中 前年件数', tanaka.prevCount, 1);
check('田中 確定率(o1確定/o2未/o6売上済=2/3)', Math.round(tanaka.doneRate), 67);
check('田中 事業所数(空文字は数えない)', tanaka.facilityCount, 1);

// --- 区分構成 ---
check('区分 居宅', a.sourceCount['居宅'], 2);
check('区分 包括', a.sourceCount['包括'], 2);
check('区分 その他', a.sourceCount['その他'], 1);
check('区分 合計', a.sourceTotal, 5);

// --- 担当者で絞り込み ---
const solo = buildAnalytics({ ...base, analyticsStaffId: 1 });
check('田中のみ 件数', solo.totalCount, 3);
check('田中のみ 前年件数', solo.previousTotal, 1);
check('田中のみ 事業所数', solo.facilityTotal, 1);

// --- 期間: 単月 ---
const single = buildAnalytics({ ...base, analyticsPeriod: 'month' });
check('単月(2026-09) 件数', single.totalCount, 1);
check('単月 経過月数', single.elapsedMonths, 1);
check('単月 月平均は件数と一致', single.monthlyAvg, 1);
check('単月 前年同月(2025-09)', single.previousTotal, 1);
check('単月 前年比', single.yoy, 100);

// --- 期間: 第1四半期(4-6月、全て経過済み) ---
const q1 = buildAnalytics({ ...base, analyticsPeriod: 'q1' });
check('Q1 件数', q1.totalCount, 3);
check('Q1 経過月数', q1.elapsedMonths, 3);
check('Q1 月平均', q1.totalCount / q1.avgDivisor, 1);

// --- 期間: 未到来のQ4（0除算しないこと） ---
const q4 = buildAnalytics({ ...base, analyticsPeriod: 'q4' });
check('Q4 経過月数は0', q4.elapsedMonths, 0);
check('Q4 分母は1に丸める(0除算回避)', q4.avgDivisor, 1);
check('Q4 月平均はNaNにならない', Number.isFinite(q4.monthlyAvg), true);

// --- 翌月繰越は翌月の件数として数える ---
const carry = buildAnalytics({
  ...base,
  orders: [{ id: 'c1', targetMonth: '2026-09', isCarryOver: true, category: 'レンタル新規', status: '未確定', amount: 1000, careHomeName: 'C居宅', source: '居宅', salespersonId: 1 }],
  analyticsPeriod: 'month'
});
check('繰越案件は当月に数えない', carry.totalCount, 0);
const carryNext = buildAnalytics({
  ...base,
  orders: [{ id: 'c1', targetMonth: '2026-09', isCarryOver: true, category: 'レンタル新規', status: '未確定', amount: 1000, careHomeName: 'C居宅', source: '居宅', salespersonId: 1 }],
  currentMonth: '2026-10',
  analyticsPeriod: 'month'
});
check('繰越案件は翌月に数える', carryNext.totalCount, 1);

// --- 入退院（予定）は確定率の対象外 ---
const hosp = buildAnalytics({
  ...base,
  orders: [{ id: 'h1', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', amount: 5000, careHomeName: 'D居宅', source: '居宅', salespersonId: 1 }],
  analyticsPeriod: 'month'
});
check('入退院 確定率はnull', hosp.categoryRows.find((r) => r.cat === '入退院（予定）').doneRate, null);
check('入退院は担当者確定率の母数にも入れない', hosp.staffRows.find((r) => r.id === 1).doneRate, null);

// --- 旧カテゴリ名（入退院予定者）も同じ行にまとめる ---
const legacy = buildAnalytics({
  ...base,
  orders: [
    { id: 'l1', targetMonth: '2026-09', category: '入退院予定者', status: '入院（予定）', amount: 1000, careHomeName: 'E居宅', source: '居宅', salespersonId: 1 },
    { id: 'l2', targetMonth: '2026-09', category: '入退院（予定）', status: '退院（予定）', amount: 2000, careHomeName: 'E居宅', source: '居宅', salespersonId: 1 }
  ],
  analyticsPeriod: 'month'
});
check('旧名称と新名称が1行にまとまる', legacy.categoryRows.find((r) => r.cat === '入退院（予定）').count, 2);

// --- 事業所名の未入力を数える ---
const unnamed = buildAnalytics({
  ...base,
  orders: [{ id: 'u1', targetMonth: '2026-09', category: 'レンタル新規', status: '未確定', amount: 1000, careHomeName: '   ', source: '居宅', salespersonId: 1 }],
  analyticsPeriod: 'month'
});
check('空白のみの事業所名は未入力として数える', unnamed.unnamedCount, 1);
check('空白のみは事業所ランキングに出さない', unnamed.facilityTotal, 0);

// --- データ0件でも壊れない ---
const empty = buildAnalytics({ ...base, orders: [] });
check('0件 合計', empty.totalCount, 0);
check('0件 月平均', empty.monthlyAvg, 0);
check('0件 前年比はnull', empty.yoy, null);
check('0件 カテゴリ行は空', empty.categoryRows.length, 0);
check('0件 区分合計', empty.sourceTotal, 0);
check('0件 担当者行は残る', empty.staffRows.length, 2);
check('0件 担当者確定率はnull', empty.staffRows[0].doneRate, null);

// === デバッグで見つかった不具合の再発防止 ===

// [不具合1] 入退院の金額を符号なしで足していたため総額が過大になっていた。
// 入院(-)と退院(+)が同額なら相殺されて0になるはず。
const signed = buildAnalytics({
  ...base,
  orders: [
    { id: 's1', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', hospitalPlanAmountMode: 'adjusted', amount: 5000, careHomeName: 'F居宅', source: '居宅', salespersonId: 1 },
    { id: 's2', targetMonth: '2026-09', category: '入退院（予定）', status: '退院（予定）', hospitalPlanAmountMode: 'adjusted', amount: 5000, careHomeName: 'F居宅', source: '居宅', salespersonId: 1 }
  ],
  analyticsPeriod: 'month'
});
check('入院と退院が同額なら金額合計は0', signed.totalAmount, 0);
check('入院と退院が同額ならカテゴリ金額も0', signed.categoryRows.find((r) => r.cat === '入退院（予定）').amount, 0);
check('事業所の金額も相殺される', signed.facilityRows[0].amount, 0);
check('担当者の金額も相殺される', signed.staffRows[0].amount, 0);
check('件数は2件のまま', signed.totalCount, 2);

// 入院のみならマイナス
const inpatient = buildAnalytics({
  ...base,
  orders: [{ id: 'i1', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', hospitalPlanAmountMode: 'adjusted', amount: 8000, careHomeName: 'G居宅', source: '居宅', salespersonId: 1 }],
  analyticsPeriod: 'month'
});
check('入院のみは金額がマイナス', inpatient.totalAmount, -8000);

// 旧データ(mode未設定)は手入力の符号をそのまま使う＝解釈を変えない
const legacyAmount = buildAnalytics({
  ...base,
  orders: [{ id: 'la1', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', amount: -3000, careHomeName: 'H居宅', source: '居宅', salespersonId: 1 }],
  analyticsPeriod: 'month'
});
check('旧データは手入力の符号をそのまま使う', legacyAmount.totalAmount, -3000);

// レンタル等は符号変換の影響を受けない
const rentalAmt = buildAnalytics({ ...base, analyticsPeriod: 'q1' });
check('レンタル/住改の金額は従来どおり', rentalAmt.totalAmount, 10000 + 20000 + 300000);

// [不具合2] 担当者を絞ると他の担当者が0件で並んでいた
const filtered = buildAnalytics({ ...base, analyticsStaffId: 1 });
check('絞り込み時は本人の行だけ', filtered.staffRows.length, 1);
check('絞り込み時の行は本人', filtered.staffRows[0].id, 1);
check('全員表示なら全員分の行が出る', buildAnalytics(base).staffRows.length, 2);

// [不具合3] 事業所数が一般販売を含んでいて事業所ランキングと母集団が違った
const mixed = buildAnalytics({
  ...base,
  orders: [
    { id: 'm1', targetMonth: '2026-09', category: 'レンタル新規', status: '未確定', amount: 1000, careHomeName: 'I居宅', source: '居宅', salespersonId: 1 },
    { id: 'm2', targetMonth: '2026-09', category: '一般販売', status: '売上済', amount: 2000, careHomeName: 'Jスーパー', source: 'その他', salespersonId: 1 }
  ],
  analyticsPeriod: 'month'
});
check('事業所数は一般販売を除く', mixed.staffRows[0].facilityCount, 1);
check('事業所ランキングと母集団が一致', mixed.facilityTotal, 1);

console.log(`OK: ${pass}件すべて通過`);
