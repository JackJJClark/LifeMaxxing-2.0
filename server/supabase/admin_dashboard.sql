-- Admin dashboard tables and policies.
-- Assumes JWT includes is_admin claim (boolean).

create table if not exists public.lifemaxing_user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.lifemaxing_backup_summary (
  user_id uuid primary key references auth.users (id) on delete cascade,
  updated_at timestamptz not null,
  identity_level integer,
  total_effort integer,
  habits integer,
  efforts integer,
  chests integer,
  items integer,
  last_active_at timestamptz,
  payload_bytes integer,
  device_id text,
  app_version text
);

create table if not exists public.lifemaxing_system_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null,
  message text,
  context jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lifemaxing_admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users (id) on delete cascade,
  action text not null,
  target_user_id uuid,
  context jsonb,
  created_at timestamptz not null default now()
);

alter table public.lifemaxing_user_profiles enable row level security;
alter table public.lifemaxing_backup_summary enable row level security;
alter table public.lifemaxing_system_events enable row level security;
alter table public.lifemaxing_admin_audit enable row level security;

create policy "Users can upsert their profile"
  on public.lifemaxing_user_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their profile"
  on public.lifemaxing_user_profiles
  for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Admins can view profiles"
  on public.lifemaxing_user_profiles
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

create policy "Users can upsert their summary"
  on public.lifemaxing_backup_summary
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their summary"
  on public.lifemaxing_backup_summary
  for update
  to authenticated
  using (auth.uid() = user_id);

create policy "Admins can view summaries"
  on public.lifemaxing_backup_summary
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

create policy "Users can insert system events"
  on public.lifemaxing_system_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Admins can view system events"
  on public.lifemaxing_system_events
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');

create policy "Admins can insert audit events"
  on public.lifemaxing_admin_audit
  for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true' and auth.uid() = admin_user_id);

create policy "Admins can view audit events"
  on public.lifemaxing_admin_audit
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true');
