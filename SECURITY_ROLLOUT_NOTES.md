# Security Rollout Notes

## Turnstile server verification
- Deploy a POST endpoint that verifies tokens via Cloudflare:
  - Use `server/turnstile/verify-turnstile-handler.js` with your backend router.
- Set `EXPO_PUBLIC_TURNSTILE_VERIFY_URL` in `.env` to the deployed endpoint.
- Keep `TURNSTILE_SECRET_KEY` server-side only.
- Rollout: enable for sign-up first; if stable, keep for sign-in too.

## Admin authorization (server-issued claim)
- Ensure JWT includes `is_admin: true` for admin users.
- Apply `server/supabase/admin_access_policies.sql` to enable RLS for admin tables.
- Verify non-admin users cannot call admin operations.

## Backup safe import
- No migration required.
- Behavior change: encrypted or malformed backups now abort without wiping local data.

## Admin claim bootstrap + verification
- Use `node scripts/set-admin.js <email>` with `SUPABASE_SERVICE_ROLE_KEY` (set in `.env.local` or env) to set `is_admin=true` for a given account, then resync with `npm run web` and observe the admin tab.
- Run `node scripts/non-admin-check.js <other-user-id>` with an anon key; the attempt to delete another user's backup should return a 403/permission denied, confirming RLS enforcement.
- Policies and `requireAdminSession` now read `auth.jwt() -> 'app_metadata' ->> 'is_admin'` so the claim path is consistent between SQL and JS.
