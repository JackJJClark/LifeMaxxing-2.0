-- Backup history table for non-authoritative sync previews.
-- RLS is enabled; users can only see their own rows.

create table if not exists public.lifemaxing_backup_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  device_id text,
  app_version text,
  payload_meta jsonb
);

create index if not exists lifemaxing_backup_history_user_idx
  on public.lifemaxing_backup_history (user_id);

create index if not exists lifemaxing_backup_history_updated_idx
  on public.lifemaxing_backup_history (user_id, updated_at desc);

alter table public.lifemaxing_backup_history enable row level security;

create policy "Users can insert their backup history"
  on public.lifemaxing_backup_history
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view their backup history"
  on public.lifemaxing_backup_history
  for select
  to authenticated
  using (auth.uid() = user_id);
