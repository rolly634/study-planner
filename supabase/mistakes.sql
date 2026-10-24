-- 誤答アプリ（study-mistakes-app）との連携（Supabase に適用済み）
-- 仕様：プロジェクト文書「アプリ連携の仕様」

-- 進捗の ○△× に記録元を足す（app＝このアプリ、mistakes＝誤答アプリの定着、claude＝Claude）
alter table public.marks add column if not exists source text not null default 'app';

-- 誤答・調べもの問題と教材項目の対応（Claude が登録時に書く）
create table public.mistake_links (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id text not null,
  item_id text references public.items(id),
  kind text not null check (kind in ('mistake', 'inquiry')),
  subject text not null check (subject in ('math', 'physics', 'english', 'denken')),
  registered_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, problem_id)
);
create index mistake_links_item_idx on public.mistake_links (user_id, item_id);

-- 誤答アプリで解いた記録（解けた／解けなかった）
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem_id text not null,
  solved boolean not null,
  chosen int,
  parts jsonb,  -- 小問つき問題：小問ごとに選んだ番号の配列（わからない＝null）。solved は全小問正解。v0.5.0 で追加
  at timestamptz not null,
  device text,
  created_at timestamptz not null default now()
);
create index attempts_user_problem_idx on public.attempts (user_id, problem_id, at);

-- 写真待ちを「確認した」（× の marks 1行ごと）
create table public.photo_dismissed (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mark_id uuid not null references public.marks(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, mark_id)
);

-- 疑問ノートの仕分け（定着／復習中）
create table public.note_status (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id text not null,
  status text not null check (status in ('teichaku', 'fukushu')),
  updated_at timestamptz not null default now(),
  primary key (user_id, note_id)
);

-- ブックマーク（問題・疑問ノート）
create table public.bookmarks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('problem', 'note')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

alter table public.mistake_links enable row level security;
alter table public.attempts enable row level security;
alter table public.photo_dismissed enable row level security;
alter table public.note_status enable row level security;
alter table public.bookmarks enable row level security;
create policy "own rows" on public.mistake_links for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.attempts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.photo_dismissed for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.note_status for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.bookmarks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 問題ごとの状態：直近2回で判定（定着＝2回続けて解けた、要注意＝2回続けて解けなかった）
create view public.problem_status with (security_invoker = true) as
select l.user_id, l.problem_id, l.item_id, l.kind, l.subject, l.registered_on,
       a1.solved as last_solved, a2.solved as prev_solved, a1.at as last_at,
       case when a1.solved and a2.solved then 'teichaku'
            when a1.solved is false and a2.solved is false then 'caution'
            when a1.solved is null then 'new'
            else 'learning' end as status
from public.mistake_links l
left join lateral (select a.solved, a.at from public.attempts a
                   where a.user_id = l.user_id and a.problem_id = l.problem_id
                   order by a.at desc limit 1) a1 on true
left join lateral (select a.solved from public.attempts a
                   where a.user_id = l.user_id and a.problem_id = l.problem_id
                   order by a.at desc offset 1 limit 1) a2 on true;

-- 項目ごとの誤答の状況（例：2問中1問定着、要注意あり）
create view public.item_mistake_status with (security_invoker = true) as
select user_id, item_id,
       count(*)::int as problems,
       (count(*) filter (where status = 'teichaku'))::int as teichaku,
       bool_or(status = 'caution') as caution
from public.problem_status
where item_id is not null
group by user_id, item_id;

-- 写真待ち：× をつけた日以降にその項目の誤答が1件もなく、確認もしていないもの
create view public.photo_waiting with (security_invoker = true) as
select m.user_id, m.id as mark_id, m.item_id, i.label, i.subject, m.marked_on, m.created_at
from public.marks m
join public.items i on i.id = m.item_id
where m.mark = 'x'
  and not exists (select 1 from public.mistake_links l
                  where l.user_id = m.user_id and l.item_id = m.item_id and l.registered_on >= m.marked_on)
  and not exists (select 1 from public.photo_dismissed d
                  where d.user_id = m.user_id and d.mark_id = m.id);

-- 項目につながる誤答が全部定着したら、進捗に ○ を1行（source = mistakes）
create function public.on_attempt_teichaku() returns trigger
language plpgsql set search_path = '' as $$
declare v_item text; v_total int; v_ok int; v_last text;
begin
  if not new.solved then return new; end if;
  select item_id into v_item from public.mistake_links
   where user_id = new.user_id and problem_id = new.problem_id;
  if v_item is null then return new; end if;
  select problems, teichaku into v_total, v_ok from public.item_mistake_status
   where user_id = new.user_id and item_id = v_item;
  if v_total is null or v_ok < v_total then return new; end if;
  select mark into v_last from public.marks
   where user_id = new.user_id and item_id = v_item order by created_at desc limit 1;
  if v_last = 'o' then return new; end if;
  insert into public.marks (user_id, item_id, mark, marked_on, source)
  values (new.user_id, v_item, 'o', (new.at at time zone 'Asia/Tokyo')::date, 'mistakes');
  return new;
end $$;
create trigger attempts_teichaku after insert on public.attempts
for each row execute function public.on_attempt_teichaku();

-- 復習（review）の学習時間がその日30分に届いたら目標達成
create function public.on_review_session() returns trigger
language plpgsql set search_path = '' as $$
declare v_day date; v_min numeric;
begin
  if new.subject <> 'review' then return new; end if;
  v_day := (new.started_at at time zone 'Asia/Tokyo')::date;
  select coalesce(sum(extract(epoch from ended_at - started_at)), 0) / 60 into v_min
    from public.sessions
   where user_id = new.user_id and subject = 'review'
     and (started_at at time zone 'Asia/Tokyo')::date = v_day;
  if v_min >= 30 then
    insert into public.achieved (user_id, day, subject) values (new.user_id, v_day, 'review')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger sessions_review_achieved after insert or update on public.sessions
for each row execute function public.on_review_session();

alter publication supabase_realtime add table public.mistake_links, public.attempts, public.photo_dismissed, public.note_status, public.bookmarks;


-- v0.5.0（2026-10-24）：小問つき問題
-- alter table public.attempts add column if not exists parts jsonb;

-- v0.6.0（2026-10-25）：誤答アプリの「Claude に送る」（受信箱）。アプリが書き、Claude が毎晩 status・reply を書く
-- create table public.inbox (
--   id uuid primary key,
--   user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
--   kind text not null default 'unsorted' check (kind in ('unsorted','fix','question','memo')),
--   body text not null check (length(body) between 1 and 4000),
--   target_type text check (target_type in ('problem','note')), target_id text, part text,
--   status text not null default 'new' check (status in ('new','done','skipped')), reply text,
--   sent_at timestamptz not null default now(), done_at timestamptz, created_at timestamptz not null default now()
-- );
-- RLS：本人だけ select・insert、未対応（status='new'）だけ delete
