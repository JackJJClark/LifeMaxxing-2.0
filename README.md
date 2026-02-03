# Lifemaxxing

## Quick start
- Install deps: `npm install`
- Run web: `npm run web`
- Run mobile: `npm run start`

## Notes
- App is local-first. Web uses localStorage for persistence.
- Email auth is enabled in the UI; it requires Supabase SMTP/domain configuration.
- Backups (Supabase) are optional; auto-backup runs when signed in and logging effort.
- Backup encryption (optional) is available on web via a passphrase field in Help > Account.

## Phase 2 enablement (staging/production)
Phase 2 is controlled by the environment variable:
- `EXPO_PUBLIC_PHASE2_ENABLED=true`

### Provider checklist (set `EXPO_PUBLIC_PHASE2_ENABLED=true`)
- Expo/EAS Build profiles
- Vercel (web deployments)
- Netlify (web deployments)
- Render/Fly/other hosting platforms
- Local `.env`

### Notes
- Expo reads `EXPO_PUBLIC_*` at build time; ensure the variable is present in the build environment.
- Add provider-specific instructions here once deployment targets are finalized.

## Security notes
- Never store secrets in `EXPO_PUBLIC_*` env vars; those are shipped to clients.
- Admin email allowlists only gate UI visibility. Real access control must be enforced by Supabase RLS.

## Integrations (optional)
### Sentry (errors + performance)
- Install: `npx @sentry/wizard@latest -i reactNative`
- Env:
  - `EXPO_PUBLIC_SENTRY_DSN`
  - `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (e.g., `0.1`)
Note: The wizard configures source maps and native builds.

### PostHog (analytics + feature flags)
- Install: `npx expo install posthog-react-native`
- Env:
  - `EXPO_PUBLIC_POSTHOG_API_KEY`
  - `EXPO_PUBLIC_POSTHOG_HOST` (default is `https://us.i.posthog.com`)

### Cloudflare Turnstile (web forms)
- Env:
  - `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (public site key)
  - `TURNSTILE_SECRET_KEY` (server-only)
- Server verification example: `server/turnstile/verify-turnstile.js`

### Resend (transactional email)
- Env (server-only):
  - `RESEND_API_KEY`
  - `RESEND_FROM`
- Server example: `server/resend/send-email.js`

## Habit prevalence refresh (annual)
Effort difficulty is auto-derived from US prevalence data. Refresh these numbers yearly:
- Update `HABIT_PREVALENCE` in `src/db/db.js` with the latest CDC/NCHS/NHANES figures.
- Keep the `source` field accurate (year + dataset).
- If a prevalence changes categories, recheck effort mapping thresholds.

## QA checklist (manual)
- App loads and onboarding appears on first web visit
- "Skip for now" continues to app
- Effort log creates chest and updates identity
- Local reset clears data
- Export creates JSON file
- Import restores data
- Quiet mode shows after inactivity

## Known limitations
- No server-side sync unless backups are enabled
- Web persistence is localStorage (clears if browser storage is cleared)
- Email auth requires SMTP to be configured
