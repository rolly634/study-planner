# Claude からアプリへ進捗を記録する方法

Claude アプリで「数学52〜58終わった、55と57が×」のように報告されたら、Supabase コネクタでデータベースに直接書き込む。
書き込んだ内容はアプリ（https://rolly634.github.io/study-planner/）に自動で反映される。

- Supabase プロジェクト ID：`yxqsdfskxwjimgypdudk`
- ツール：`execute_sql`
- 日付は日本時間（Asia/Tokyo）。「今日」「昨日」は日本時間で解釈する
- 計画の週：W1 = 2026/10/24（土）〜10/30（金）、以降7日ごと（土曜はじまり）

## 手順
1. 報告の内容を、下の「項目の探し方」で項目ID に変換する
2. 何を記録するか（完了・○△×・時間）を短く確認してから SQL を実行する。内容がはっきりしていれば確認は省いてよい
3. 実行後、記録した内容を一言で返す（例：「基礎問IIB 52〜58を完了、55・57を×で記録しました」）

## ユーザーID
利用者は1人。最初に取得して使う。
```sql
select id from auth.users order by created_at limit 1;
```
以下の SQL では `(select id from auth.users order by created_at limit 1)` をそのまま埋め込んでもよい。

## 項目の探し方（items テーブル）
| 本 | book | 例 |
|---|---|---|
| 基礎問題精講 I・A / II・B / III・C | `KIA` / `KIIB` / `KIIIC` | 基礎問IIB 55 → `KIIB-55` |
| 合格る計算 I・A・II・B / III・C | `GO1` / `GO3` | 合格る 48 → `GO1-48` |
| 物理のエッセンス 力学・波動 / 熱・電磁気・原子 | `ESS1` / `ESS2` | 節名で検索 |
| 良問の風 | `RYO` | 「力学3」などで検索 |
| 速読英単語 | `SOK` | 速単 3 → `SOK-3` |
| 電験 理論／機械／法規 問題集（問題番号） | `DKR` / `DKK` / `DKH` | 理論 12 → `DKR-12`、機械 85 → `DKK-85`、法規 3 → `DKH-3` |
| 電験 電力（章。問題番号は追って反映）・理論の解き直し・過去問 | `DKN`（101〜） | 「電力01」などで検索。`DKN-1`〜`46` は廃止 |

```sql
-- 番号の範囲
select id, label, weeks from public.items where book = 'KIIB' and no between 52 and 58 order by no;
-- 名前で検索
select id, label, weeks from public.items where label like '%運動方程式%' or chapter like '%運動の法則%';
```
`weeks` は計画の週。`"1,11"` のように2つあるものは「1周目 W1／2周目 W11」。

## 完了（task_done）
`task_key` は `項目ID#周回`。通常は `#1`、2周目の週に解いたものは `#2`。
```sql
insert into public.task_done (user_id, task_key, done_on)
select (select id from auth.users order by created_at limit 1), k, date '2026-10-24'
from unnest(array['KIIB-52#1','KIIB-53#1']) k
on conflict (user_id, task_key) do nothing;
```
教材以外の課題（Santa、通読など）は `custom:科目:課題名@日付`。課題名はアプリの表示と完全に一致させる。
例：`custom:english:Santa TOEFL（1h）@2026-10-24`、`custom:review:×△の解き直し・進捗の記入@2026-10-24`

## ○△×（marks）
`mark`：`o`＝○自力で正解、`t`＝△迷った・遅い、`x`＝×解けない。同じ問題を解き直したら行を追加する（履歴として残す）。
```sql
insert into public.marks (user_id, item_id, mark, marked_on)
select (select id from auth.users order by created_at limit 1), item, m, date '2026-10-24'
from (values ('KIIB-55','x'), ('KIIB-57','x'), ('KIIB-52','o')) v(item, m);
```
○△×を記録した問題は、完了（task_done）にも入れる。

## 学習時間（sessions）
`subject`：`math` / `physics` / `english` / `denken` / `review`。時刻が分からなければその日の正午を終了時刻にする。
```sql
insert into public.sessions (id, user_id, subject, started_at, ended_at, manual, source)
values ('claude-' || gen_random_uuid(), (select id from auth.users order by created_at limit 1), 'math',
        timestamptz '2026-10-24 10:00+09', timestamptz '2026-10-24 12:00+09', true, 'claude');
```

## 目標達成（achieved）
```sql
insert into public.achieved (user_id, day, subject)
values ((select id from auth.users order by created_at limit 1), date '2026-10-24', 'math')
on conflict do nothing;
```

## 進捗を聞かれたとき
```sql
-- 今週の科目別学習時間（日本時間）
select subject, round(sum(extract(epoch from ended_at - started_at)) / 3600, 1) as hours
from public.sessions
where (started_at at time zone 'Asia/Tokyo')::date between date '2026-10-24' and date '2026-10-30'
group by subject;
-- △×が残っている問題（最後の記録が○以外）
select label, mark, marked_on from (
  select distinct on (m.item_id) i.label, m.mark, m.marked_on
  from public.marks m join public.items i on i.id = m.item_id
  order by m.item_id, m.created_at desc
) last where mark <> 'o';
```
計画の時間配分（週51h）：平日 数学2h・物理1.5h・電験2h・復習0.5h／土 数学4.5h・物理4h・英語2h・電験1h・復習0.5h／日 数学3.5h・物理3h・英語2h・復習0.5h。


## 誤答アプリとの連携（参考）
- `marks` には `source` 列がある（app／mistakes／claude）。Claude が書くときは `source = 'claude'` を付けてよい
- 写真待ち：`select label, marked_on from public.photo_waiting order by marked_on;`
- 項目ごとの誤答の状況：`select * from public.item_mistake_status;`（problems・teichaku・caution）
- 誤答・調べもの問題を登録したら、study-mistakes の `scripts/links_sql.py` の出力で `mistake_links` に対応を入れる
