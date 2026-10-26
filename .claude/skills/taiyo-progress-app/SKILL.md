---
name: taiyo-progress-app
description: 太陽シルバーサービスの業務アプリ「受注残・進捗管理」（受注残・進捗管理表。リポジトリ akamar08taiyo-bot/solar-silver-progress-app、公開は https://akamar08taiyo-bot.github.io/solar-silver-progress-app/ 、太陽ポータルのタイル「受注残・進捗管理」）を直す・機能を足す・公開するときに必ず使う。受注残・受注残一覧・営業所合計・目標進捗・推移グラフ・マスタ設定（担当者）・次月へ移行、とくに「申請書・見積書作成」（住宅改修・特定福祉用具）から届いた案件を「受注残に入れる」（taiyo-link：担当・売上月・重ねて入れない・変わった案件）の話が出たら、アプリ名を言われなくても使う。1ファイルの index.html の作り、本番の Firebase につながないブラウザのテスト（にせの Firestore）、公開のしかた、落とし穴がまとまっている。
---

# 受注残・進捗管理（太陽シルバーサービス）

レンタル・販売の受注残（案件ごとの状態・金額）と、営業所・担当者ごとの進捗（目標・実績・見込み）を管理するアプリ。営業所ごとに Firebase（Firestore）にデータを持つ。
使うのは営業所の担当者（プログラマーではない）。このスキルは 2026-10-25〜26 のセッションで「申請書・見積書作成」との連動（taiyo-link）を作ったときの知識をまとめたもの。
ポータル全体に共通のこと（公開の流れ・ユーザーの好み・報告のしかた）は `taiyo-portal` スキル、申請書・見積書作成の側は `taiyo-jutaku-mitsumori-app`・`taiyo-tokutei-app` スキル（あれば一緒に読む）。

## まず全体をつかむ

| もの | 場所 |
|---|---|
| コード | `index.html` の1ファイル（約3800行）。React 18・lucide-react・Firebase を CDN（esm.sh・gstatic）から import map で読み、`<script type="text/babel">` を Babel standalone（版を固定）でその場で変換して動かす。ビルドはない。Tailwind は CDN |
| 説明書 | `manual.html`（印刷用の説明書。アプリの「使い方」の `Usage` からも開く）。機能を変えたら、`Usage` の文・`manual.html`・ポータルのタイルの使い方の文の3つを直す |
| 本番 | **main ＝ 本番**（push すると GitHub Pages の「pages build and deployment」がすぐ配信）。作業は別のブランチ（2026-10 は `claude/taiyo-link-dedupe`）で、ユーザーの「公開して」で main に fast-forward して push |
| テスト | `test/taiyoLink.test.mjs`（taiyo-link の決まり）・`test/analytics.test.mjs`、ブラウザは `test/e2e-taiyo-link.mjs`（`test/harness/`） |

## 申請書・見積書作成から入れる（taiyo-link。`index.html` の `// taiyo-link-begin`〜`// taiyo-link-end`）

- 同じサイト（akamar08taiyo-bot.github.io）なので、申請書・見積書作成が**この端末の localStorage** に書いた案件ごとのまとめを読む：
  住宅改修 `taiyo-jutaku-sales-v1`（`{v, updatedAt, rows, tokuteiMonths}`。住宅改修の `src/sasaoka/salesPlan.ts` の `jutakuSalesSummary`）・
  特定福祉用具 `taiyo-tokutei-sales-v1`（`{v, updatedAt, rows, linked}`。特定福祉用具の `src/tokutei/salesSummary.ts`）。`rows` の1件は id・customer・staff・careOffice・month・amount（税抜）・office など。
  形を変えるときは3つのアプリを一緒に直す（読むのは `readTaiyoLinkRows`）。
- 読むのは画面に来たとき・別のタブで書かれたとき（`storage`）・画面に戻ったとき（`focus`）。受注残に書くのは、お知らせ（`TaiyoLinkNotice`）の「受注残に入れる」を押したときだけ。
  金額のない・月のない・ほかの営業所（`office` がこの画面の営業所とちがう）・お客様名のない（作りかけ）案件は出さない。本社管理（`isHeadOffice`）の画面では出さない。
- `planTaiyoLink(rows, orders, salespersons, ignored, staffMemory)` → `{adds, updates}`：
  - **重ねて入れない**（ユーザーの指示「受注残のアプリに転記する場合は、保存する場合に重複しないようにする」2026-10-26）：同じ案件は `order.taiyoLink`（`jutaku:<様邸 id>`・`tokutei:<案件 id>`）で見つける。
    ほかに、同じお客様（すき間を除いた名前）・同じ区分・同じ月で売上済でない行が受注残にあれば足さない（手で入れた行）。届いた中の同じお客様・区分・月・金額も1つだけ。
  - **担当**（ユーザーの指示「受注残の中でも担当の受注残に入るように紐づける」2026-10-26）：`taiyoStaffOf(name, salespersons, memory)` で見積書の担当の名前から担当者（マスタ設定）を探す。
    同じ名前（NFKC・すき間を除く）→ この端末で前に選んだ担当（localStorage `solar_silver_taiyo_link_staff`＝名前 → 担当者 id）→ 姓だけが同じ人が1人（「久保 匠史」と担当者「久保」、逆も）→
    すき間のない名前は担当者の姓（2字以上）で始まる人が1人。**行橋営業所の担当者は姓だけで登録してある**（ユーザーの話「久保・土居・宮村で苗字は全く同じで同一人物です」2026-10-26）。
    見つからなければお知らせの担当の欄は「担当を選ぶ」で、選ぶまで「受注残に入れる」は押せない（前は画面で選んでいる担当・先頭の担当に入り、ほかの人の受注残に入った）。選んだ担当は覚える。
  - **月**：住宅改修のまとめの `month`（申請書・見積書作成の一覧の「売上月」）。特定福祉用具は住宅改修のまとめの `tokuteiMonths[案件 id]` があればそちら（一覧・売上見込みで変えた月）。
  - **変わった案件**（updates）：入れたときの値 `order.taiyoSynced`（customerName・careHomeName・amount・salespersonId・targetMonth）から変わった項目を、受注残で手で直していない
    （`order[f] === taiyoSynced[f]`）ときだけ直す。担当は見つからない名前・空では変えない。担当・月は `taiyoSynced` にその項目がない行（前の版で入れた行）は変えない。売上済の行・行を消すことはしない。
    月を移すときは `isCarryOver`・`isMoveToPrevious` も外す（受注残一覧の「次月へ移行」と同じ）。受注残で「次月へ移行」した行は月を手で直した扱い（`targetMonth` が変わる）。
  - `taiyoSynced.salespersonId` は**見積書の担当から探した担当**（お知らせで選び直した担当ではない）。選び直した行を、見積書の担当に戻そうとして毎回「変わった案件」に出さないため。
- `taiyoOrderDoc`：新しい行（受注残一覧の「行を追加」と同じ初めの値。状態は区分の最初＝未売上、区分（包括・居宅）は事業所名から `inferSourceFromCareHomeName`）。`taiyoOrderPatch`：直す中身（事業所名が変わり、区分が前の事業所名から決めたままなら区分も）。
- 「今は入れない」はこのタブのあいだ（sessionStorage `solar_silver_taiyo_link_later`）、「出さない」はこれからも（localStorage `solar_silver_taiyo_link_ignored`）。

## テスト

```sh
cd /home/user/solar-silver-progress-app
node --test "test/*.test.mjs"                     # 単体テスト（Node 22 では `node --test test/` の形は動かない。必ずこの形）
sh test/harness/setup.sh <準備のフォルダ>          # 初めの1回：React・lucide-react・Babel を npm から入れて ESM にまとめ、Tailwind の CSS を作る
node test/e2e-taiyo-link.mjs <準備のフォルダ> <画像を置くフォルダ>   # ブラウザのテスト（Playwright は PLAYWRIGHT か /opt/node-tools の既定の場所）
```

- `taiyoLink.test.mjs` は `index.html` の taiyo-link の間をそのまま切り出して `new Function` で動かす（ブロックが使うほかの関数は `pick` で index.html から読む）。ブロックの外の関数を使うようにしたら `helpers` に足す。
- ブラウザのテストは**本番の Firebase につながない**：`test/harness/open.mjs` が CDN と Firebase の URL を手元のもの・にせの Firestore（`fake-firebase-*.js`。`window.__fakeFS`・`window.__fakeWrites` にだけ書く）に差しかえ、localhost 以外の通信は止める（止めた URL は `blocked`）。
  初めの中身は `seedFS`（`artifacts/<appId>/public/data/staff/1` など）、localStorage は `local`（営業所 `solar_silver_branch_setting`・2つのまとめ）。
- テストのお客様・担当者は架空の名前（見本 花子・見本 太郎・例題・試験）。本物の担当者名・お客様名はテストに入れない。

## 公開

1. 作業のブランチで commit・push。`git fetch` で main とほかのセッションの push を見る。
2. ユーザーが「公開して」と言ったら、main に fast-forward（`git checkout main && git merge --ff-only <ブランチ> && git push origin main`）。
3. デプロイの確かめ：`gh run list --repo akamar08taiyo-bot/solar-silver-progress-app --limit 3 --json headSha,status,conclusion,name` で自分の head の「pages build and deployment」が completed／success。
4. ポータルのタイルの使い方の文（`taiyo-portal/index.html` の `APPS` の `name:'受注残・進捗管理'`）を直すときはポータルも push（`taiyo-portal` スキル）。
5. 申請書・見積書作成のまとめの形を変える版は、**読む側（このアプリ）を先に公開**してから書く側を公開する（知らない形を読んでも壊れないように、読む側は足された項目を無視する作り）。

公開の状態（2026-10-26）：main 3ba7cdf（重ねて入れない・担当の名前でつなぐ・売上月）と、49efb60（すき間のない名前を姓でつなぐ）・このスキルまで公開（ユーザーの「公開して」）。いまの状態は `git log origin/main` で確かめる。

## 落とし穴

- **この clone は main だけを取ってくる設定**（`remote.origin.fetch` が `+refs/heads/main:refs/remotes/origin/main`）。作業のブランチを push しても `origin/<ブランチ>` ができず、
  終わりの確かめ（stop hook）が「push していない・リモートのブランチがない」と言う → `git fetch origin <ブランチ>:refs/remotes/origin/<ブランチ>` で作る（push 済みかは `git ls-remote origin <ブランチ>`）。
- お知らせのボタン・欄の名前（aria-label）には、お客様名を入れてよい（行ごとの欄。`${x.customerName}の担当`）。テストはそれで探す。
- `taiyoNormName` は NFKC＋すき間（全角も）を除く。お客様名の見くらべ（重ねて入れない）にも使う。
- index.html の JSX は Babel がその場で変換する。構文の誤りは画面が真っ白になるだけで分かりにくい → 直したらブラウザのテストを必ず動かす。
- 担当者の id は数字（`Date.now()`）。お知らせの select の値は文字なので `Number()` でそろえる。
