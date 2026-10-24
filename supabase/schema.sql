-- 学習プランナー：テーブル定義（Supabase に適用済み）
create table public.task_done (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_key text not null,
  done_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_key)
);
create table public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id text not null,
  mark text not null check (mark in ('o', 't', 'x')),
  marked_on date not null,
  created_at timestamptz not null default now()
);
create index marks_user_item_idx on public.marks (user_id, item_id, created_at);
create table public.achieved (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  subject text not null check (subject in ('math', 'physics', 'english', 'denken', 'review')),
  created_at timestamptz not null default now(),
  primary key (user_id, day, subject)
);
create table public.sessions (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null check (subject in ('math', 'physics', 'english', 'denken', 'review')),
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at >= started_at),
  manual boolean not null default false,
  source text not null default 'app',
  created_at timestamptz not null default now()
);
create index sessions_user_start_idx on public.sessions (user_id, started_at);
create table public.active_timer (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  subject text not null check (subject in ('math', 'physics', 'english', 'denken', 'review')),
  started_at timestamptz not null
);
create table public.items (
  id text primary key, subject text not null, book text not null, book_name text not null,
  no int not null, title text not null default '', chapter text not null, label text not null, weeks text not null
);
alter table public.task_done enable row level security;
alter table public.marks enable row level security;
alter table public.achieved enable row level security;
alter table public.sessions enable row level security;
alter table public.active_timer enable row level security;
alter table public.items enable row level security;
create policy "own rows" on public.task_done for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.marks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.achieved for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.sessions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.active_timer for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "read items" on public.items for select to authenticated using (true);
alter publication supabase_realtime add table public.task_done, public.marks, public.achieved, public.sessions, public.active_timer;
