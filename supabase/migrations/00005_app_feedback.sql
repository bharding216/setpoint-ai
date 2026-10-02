-- App feedback submitted by users from Settings
create table if not exists public.app_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.app_feedback enable row level security;

create policy "Users can insert their own feedback"
  on public.app_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can read their own feedback"
  on public.app_feedback for select
  using (auth.uid() = user_id);
