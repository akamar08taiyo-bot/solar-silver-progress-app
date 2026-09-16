// 分析タブの集計ロジック検証。index.html の analyticsData useMemo の中身をそのまま写している。
// src側を変えたらこちらも必ず同時に更新すること。
import assert from 'node:assert';

// ---- index.html から写した定数・ヘルパー ----
const RENTAL_CATEGORIES = ['レンタル新規', '既存追加', '特価ベッド'];
const HOSPITAL_PLAN_CATEGORY = '入退院（予定）';
const HOSPITAL_PLAN_LEGACY_CATEGORY = '入退院予定者';
const SALES_CATEGORIES = ['住宅改修', '特定福祉用具販売', HOSPITAL_PLAN_CATEGORY, '一般販売', '紙おむつ', '消耗品'];
const OTHER_SALES_CATS = ['一般販売', '紙おむつ', '消耗品'];
const SALES_ANALYSIS_CATEGORIES = ['住宅改修', '特定福祉用具販売'];
const allCategories = [...RENTAL_CATEGORIES, ...SALES_CATEGORIES];
const SOURCE_ANALYSIS_GROUPS = [
  { key: 'rental', label: '介護保険レンタル', cats: ['レンタル新規', '既存追加'] },
  { key: 'specialBed', label: '特価ベッド', cats: ['特価ベッド'] },
  { key: 'equipment', label: '特定福祉用具', cats: ['特定福祉用具販売'] },
  { key: 'renovation', label: '住宅改修', cats: ['住宅改修'] }
];

const isCompletedStatus = (status) => status === '確定済' || status === '売上済';
const isHospitalPlanCategoryName = (category) => category === HOSPITAL_PLAN_CATEGORY || category === HOSPITAL_PLAN_LEGACY_CATEGORY;
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
  // 入退院（予定）は実際の依頼ではなく在庫調整の性質が強く、一般販売・紙おむつ・消耗品は
  // 任意項目の付随的な売上なので、分析の対象からは外す（ユーザー指示）。
  const isAnalyticsCategory = (cat) => !isHospitalPlanCategoryName(cat) && !OTHER_SALES_CATS.includes(cat);
  const periodOrders = orders.filter((o) => matchStaff(o) && isAnalyticsCategory(o.category) && monthSet.has(getOrderAccountingMonth(o)));
  const previousOrders = orders.filter((o) => matchStaff(o) && isAnalyticsCategory(o.category) && previousMonthSet.has(getOrderAccountingMonth(o)));
  // 担当者別の傾向・個人分析は「担当者を比較するための表」なので、上の担当者フィルタとは
  // 独立に常に全担当者分を計算する（フィルタをかけると比較相手が消えてしまうため）。
  const periodOrdersAllStaff = orders.filter((o) => isAnalyticsCategory(o.category) && monthSet.has(getOrderAccountingMonth(o)));
  const previousOrdersAllStaff = orders.filter((o) => isAnalyticsCategory(o.category) && previousMonthSet.has(getOrderAccountingMonth(o)));
  const elapsedMonths = periodMonths.filter((m) => m <= currentMonth).length;
  const avgDivisor = Math.max(1, elapsedMonths);
  // 入退院（予定）は上のisAnalyticsCategoryで除外済みなので、新旧カテゴリ名(入退院予定者)を
  // 吸収する必要がなく素通しでよい。
  const normalizeCat = (cat) => cat;
  const staffName = (id) => salespersons.find((s) => Number(s.id) === Number(id))?.name || '未設定';
  const orderAmount = (o) => Number(o.amount || 0);

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
      // 前年0件のときに比率を出すと無意味な数字になるためnullにして「—」表示にする
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

  const staffRows = salespersons.filter((s) => s?.id).map((staff) => {
    const staffOrders = periodOrdersAllStaff.filter((o) => Number(o.salespersonId) === Number(staff.id));
    const prevCount = previousOrdersAllStaff.filter((o) => Number(o.salespersonId) === Number(staff.id)).length;
    const doneCnt = staffOrders.filter((o) => isCompletedStatus(o.status)).length;
    // 個人分析（カテゴリ構成比・取引事業所トップ5）用の内訳。ここも常に本人の全期間データで計算する。
    const categoryBreakdown = {};
    const categoryAmountBreakdown = {};
    const facilityCountMap = {};
    // 営業員ごとの依頼元区分（包括・居宅の割合）用の内訳。項目ごとに分けて集計する。
    const sourceCountByCategory = {};
    SOURCE_ANALYSIS_GROUPS.forEach((group) => { sourceCountByCategory[group.key] = { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 }; });
    for (const o of staffOrders) {
      const label = normalizeCat(o.category);
      categoryBreakdown[label] = (categoryBreakdown[label] || 0) + 1;
      categoryAmountBreakdown[label] = (categoryAmountBreakdown[label] || 0) + orderAmount(o);
      const name = String(o.careHomeName || '').trim();
      if (name) facilityCountMap[name] = (facilityCountMap[name] || 0) + 1;
      const sourceGroup = SOURCE_ANALYSIS_GROUPS.find((group) => group.cats.includes(label));
      if (sourceGroup && o.source && sourceCountByCategory[sourceGroup.key][o.source] !== undefined) sourceCountByCategory[sourceGroup.key][o.source] += 1;
    }
    const topFacilities = Object.entries(facilityCountMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
    return {
      id: staff.id,
      name: staff.name,
      count: staffOrders.length,
      monthlyAvg: staffOrders.length / avgDivisor,
      prevCount,
      yoy: prevCount > 0 ? (staffOrders.length / prevCount) * 100 : null,
      amount: staffOrders.reduce((sum, o) => sum + orderAmount(o), 0),
      doneRate: staffOrders.length > 0 ? (doneCnt / staffOrders.length) * 100 : null,
      facilityCount: Object.keys(facilityCountMap).length,
      categoryBreakdown,
      categoryAmountBreakdown,
      topFacilities,
      sourceCountByCategory
    };
  }).sort((a, b) => b.count - a.count);
  const staffTotalCount = staffRows.reduce((sum, r) => sum + r.count, 0);

  const sourceCount = { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 };
  for (const o of periodOrders) {
    if (o.source && sourceCount[o.source] !== undefined) sourceCount[o.source] += 1;
  }
  const sourceTotal = Object.values(sourceCount).reduce((sum, v) => sum + v, 0);

  const sourceCountByCategory = {};
  SOURCE_ANALYSIS_GROUPS.forEach((group) => {
    const groupOrders = periodOrders.filter((o) => group.cats.includes(normalizeCat(o.category)));
    const counts = { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 };
    for (const o of groupOrders) {
      if (o.source && counts[o.source] !== undefined) counts[o.source] += 1;
    }
    sourceCountByCategory[group.key] = { label: group.label, count: groupOrders.length, sourceCount: counts };
  });

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
    staffTotalCount,
    sourceCount,
    sourceTotal,
    sourceCountByCategory
  };
}

// ---- テストデータ ----
// o6は一般販売(分析対象外カテゴリ)。totalCount等の期待値はo6を含まない点に注意。
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

// --- 全体サマリー（o6=一般販売は分析対象外なので4件・36万円になる） ---
const a = buildAnalytics(base);
check('経過月数(4〜9月)', a.elapsedMonths, 6);
check('期間内件数', a.totalCount, 4);
check('月平均', Math.round(a.monthlyAvg * 100) / 100, 0.67);
check('前年同期件数', a.previousTotal, 1);
check('前年比', a.yoy, 400);
check('金額合計', a.totalAmount, 360000);

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
check('事業所名 未入力件数(一般販売は分析対象外)', a.unnamedCount, 0);
check('1位は金額の多いB包括', a.facilityRows[0].name, 'B包括');
check('B包括 件数', a.facilityRows[0].count, 2);
check('B包括 金額', a.facilityRows[0].amount, 330000);
check('B包括 最終依頼月', a.facilityRows[0].lastMonth, '2026-09');
check('B包括 区分', a.facilityRows[0].mainSource, '包括');
check('B包括 担当', a.facilityRows[0].staffLabel, '佐藤');
check('A居宅 最終依頼月', a.facilityRows[1].lastMonth, '2026-05');
check('A居宅 内訳', a.facilityRows[1].topCategories, 'レンタル新規2');

// --- 担当者別（一般販売のo6は対象外なので田中はo1+o2の2件） ---
const tanaka = a.staffRows.find((r) => r.id === 1);
check('田中 件数', tanaka.count, 2);
check('田中 前年件数', tanaka.prevCount, 1);
check('田中 確定率(o1確定/o2未=1/2)', tanaka.doneRate, 50);
check('田中 事業所数', tanaka.facilityCount, 1);
check('田中 カテゴリ内訳', tanaka.categoryBreakdown, { 'レンタル新規': 2 });
check('田中 事業所トップ5', tanaka.topFacilities, [{ name: 'A居宅', count: 2 }]);
// 田中はレンタル新規2件のみ(o1+o2)。介護保険レンタル区分にだけ居宅2件が入り、他の項目は混ざらず0のまま。
check('田中 介護保険レンタルの依頼元区分(居宅2件)', tanaka.sourceCountByCategory.rental, { 包括: 0, 居宅: 2, '退院/連携室': 0, その他: 0 });
check('田中 住宅改修の依頼元区分は0', tanaka.sourceCountByCategory.renovation, { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 });
const sato = a.staffRows.find((r) => r.id === 2);
// 佐藤は住宅改修(o3)とレンタル新規(o4)が1件ずつ。両方とも依頼元は包括だが、項目を混ぜずそれぞれ1件で数える。
check('佐藤 介護保険レンタルの依頼元区分(包括1件)', sato.sourceCountByCategory.rental, { 包括: 1, 居宅: 0, '退院/連携室': 0, その他: 0 });
check('佐藤 住宅改修の依頼元区分(包括1件)', sato.sourceCountByCategory.renovation, { 包括: 1, 居宅: 0, '退院/連携室': 0, その他: 0 });
check('佐藤 特価ベッド・特定福祉用具の依頼元区分は0', [sato.sourceCountByCategory.specialBed, sato.sourceCountByCategory.equipment], [{ 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 }, { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 }]);
check('担当者件数の合計', a.staffTotalCount, a.staffRows.reduce((s, r) => s + r.count, 0));

// --- 区分構成（一般販売のo6は対象外） ---
check('区分 居宅', a.sourceCount['居宅'], 2);
check('区分 包括', a.sourceCount['包括'], 2);
check('区分 その他', a.sourceCount['その他'], 0);
check('区分 合計', a.sourceTotal, 4);

// --- 項目ごとの依頼元区分（介護保険レンタル・特価ベッド・特定福祉用具・住宅改修を混ぜない） ---
check('介護保険レンタル 件数', a.sourceCountByCategory.rental.count, 3);
check('介護保険レンタル 居宅', a.sourceCountByCategory.rental.sourceCount['居宅'], 2);
check('介護保険レンタル 包括', a.sourceCountByCategory.rental.sourceCount['包括'], 1);
check('住宅改修 件数', a.sourceCountByCategory.renovation.count, 1);
check('住宅改修 包括', a.sourceCountByCategory.renovation.sourceCount['包括'], 1);
check('特価ベッド 件数(登録なし)', a.sourceCountByCategory.specialBed.count, 0);
check('特定福祉用具 件数(登録なし)', a.sourceCountByCategory.equipment.count, 0);

// --- 担当者フィルタは概要・レンタル・販売の集計だけに効く。staffRowsは常に全員 ---
const solo = buildAnalytics({ ...base, analyticsStaffId: 1 });
check('田中のみ絞込 期間内件数', solo.totalCount, 2);
check('田中のみ絞込 前年件数', solo.previousTotal, 1);
check('田中のみ絞込 事業所数', solo.facilityTotal, 1);
check('担当者を絞り込んでもstaffRowsは全員分残る', solo.staffRows.length, 2);
check('絞り込みの有無でstaffRowsの中身は変わらない', solo.staffRows, buildAnalytics(base).staffRows);

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
check('0件 担当者依頼元区分は項目ごとに全て0', empty.staffRows[0].sourceCountByCategory.rental, { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 });

// === ユーザー指示「分析に入院や消耗品などは不要」（2026-09-08）の回帰防止 ===
// 入退院（予定）・一般販売・紙おむつ・消耗品は、登録があっても分析には一切出てこないこと。
const excluded = buildAnalytics({
  ...base,
  orders: [
    { id: 'e1', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', hospitalPlanAmountMode: 'adjusted', amount: 8000, careHomeName: 'D居宅', source: '居宅', salespersonId: 1 },
    { id: 'e2', targetMonth: '2026-09', category: '入退院予定者', status: '退院（予定）', amount: 3000, careHomeName: 'D居宅', source: '居宅', salespersonId: 1 },
    { id: 'e3', targetMonth: '2026-09', category: '一般販売', status: '売上済', amount: 4000, careHomeName: 'Eスーパー', source: 'その他', salespersonId: 1 },
    { id: 'e4', targetMonth: '2026-09', category: '紙おむつ', status: '売上済', amount: 2000, careHomeName: 'Fホーム', source: 'その他', salespersonId: 2 },
    { id: 'e5', targetMonth: '2026-09', category: '消耗品', status: '売上済', amount: 1000, careHomeName: 'Gホーム', source: 'その他', salespersonId: 2 }
  ],
  analyticsPeriod: 'month'
});
check('除外カテゴリだけなら件数0', excluded.totalCount, 0);
check('除外カテゴリだけなら金額0', excluded.totalAmount, 0);
check('入退院はカテゴリ別に出ない(新名称)', excluded.categoryRows.find((r) => r.cat === '入退院（予定）'), undefined);
check('一般販売はカテゴリ別に出ない', excluded.categoryRows.find((r) => r.cat === '一般販売'), undefined);
check('除外カテゴリの事業所は事業所別ランキングに出ない', excluded.facilityTotal, 0);
check('除外カテゴリの担当者件数は0', excluded.staffRows.find((r) => r.id === 1).count, 0);
check('除外カテゴリの担当者カテゴリ内訳は空', excluded.staffRows.find((r) => r.id === 1).categoryBreakdown, {});
check('除外カテゴリの担当者トップ事業所は空', excluded.staffRows.find((r) => r.id === 1).topFacilities, []);
check('除外カテゴリの担当者依頼元区分も項目ごとに全て0', excluded.staffRows.find((r) => r.id === 1).sourceCountByCategory.rental, { 包括: 0, 居宅: 0, '退院/連携室': 0, その他: 0 });
check('除外カテゴリの区分構成にも入らない', excluded.sourceTotal, 0);

// レンタル・住改・特定福祉用具は引き続き分析対象
const mixedExclusion = buildAnalytics({
  ...base,
  orders: [
    { id: 'x1', targetMonth: '2026-09', category: 'レンタル新規', status: '確定済', amount: 12000, careHomeName: 'H居宅', source: '居宅', salespersonId: 1 },
    { id: 'x2', targetMonth: '2026-09', category: '入退院（予定）', status: '入院（予定）', hospitalPlanAmountMode: 'adjusted', amount: 8000, careHomeName: 'H居宅', source: '居宅', salespersonId: 1 }
  ],
  analyticsPeriod: 'month'
});
check('対象カテゴリだけが集計される', mixedExclusion.totalCount, 1);
check('対象カテゴリの金額だけが合計される', mixedExclusion.totalAmount, 12000);

console.log(`OK: ${pass}件すべて通過`);
