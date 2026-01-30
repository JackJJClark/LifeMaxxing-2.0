# Lifemaxxing

## Quick start
- Install deps: `npm install`
- Run web: `npm run web`
- Run mobile: `npm run start`

## Notes
- App is local-first. Web uses localStorage for persistence.
- Email auth is currently disabled in UI until SMTP/domain is configured.
- Backups (Supabase) are optional; auto-backup runs when signed in and logging effort.

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
- Email auth disabled until SMTP is configured
