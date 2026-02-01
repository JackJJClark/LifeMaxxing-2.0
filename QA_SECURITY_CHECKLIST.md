# Security & Data Integrity QA Checklist

## Backup safe import (encrypted + empty)
- Create local data A (1 habit + 1 effort).
- Attempt to load an encrypted backup without passphrase.
- Expected: import aborts, local data A remains intact.
- Attempt to load a valid decrypted backup.
- Expected: local data replaced with backup contents.
- Attempt to load a malformed/empty backup payload.
- Expected: import aborts with error, local data remains intact.

## Turnstile server verification
- Configure `EXPO_PUBLIC_TURNSTILE_VERIFY_URL` to a working endpoint.
- Sign up with a valid token.
- Expected: sign-up succeeds.
- Sign up with an invalid/expired token.
- Expected: sign-up is blocked, error shown.
- Temporarily set verify URL to a non-existent endpoint.
- Expected: sign-up is blocked, error shown (no fallback).

## Admin authorization (server-side claim)
- Sign in as non-admin user (no `is_admin` claim).
- Attempt admin actions: list backups, delete backup, list system events.
- Expected: all actions fail with "Admin access only."
- Sign in as admin user (JWT `is_admin: true`).
- Expected: admin actions succeed.

