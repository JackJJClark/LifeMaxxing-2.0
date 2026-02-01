-- Admin access enforcement for backup/admin tables.
-- Requires JWT claim `is_admin` (boolean) to be set by the server.

alter table public.lifemaxing_backups enable row level security;

create policy "Users can insert their backup"
  on public.lifemaxing_backups
  for insert
  to authenticated
  with check (auth.uid() = user_id); -- Allow users to save their own backup.

create policy "Users can update their backup"
  on public.lifemaxing_backups
  for update
  to authenticated
  using (auth.uid() = user_id); -- Allow users to update their own backup.

create policy "Users can view their backup"
  on public.lifemaxing_backups
  for select
  to authenticated
  using (auth.uid() = user_id); -- Allow users to fetch their own backup.

create policy "Admins can view all backups"
  on public.lifemaxing_backups
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admins can list backups.

create policy "Admins can delete any backup"
  on public.lifemaxing_backups
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin deletes for support tools.

alter table public.lifemaxing_backup_history enable row level security;

create policy "Admins can view all backup history"
  on public.lifemaxing_backup_history
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin history review.

create policy "Admins can delete backup history"
  on public.lifemaxing_backup_history
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin cleanup support.

create policy "Admins can delete summaries"
  on public.lifemaxing_backup_summary
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin cleanup support.

create policy "Admins can delete profiles"
  on public.lifemaxing_user_profiles
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin cleanup support.

create policy "Admins can delete system events"
  on public.lifemaxing_system_events
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true'); -- Admin cleanup support.
