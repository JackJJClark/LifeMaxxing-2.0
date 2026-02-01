const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const ADMIN_EMAILS_RAW = process.env.EXPO_PUBLIC_ADMIN_EMAILS || '';
const ADMIN_EMAILS = ADMIN_EMAILS_RAW
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.includes('@'));

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
const SENTRY_TRACES_SAMPLE_RATE_RAW =
  process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '';
const SENTRY_TRACES_SAMPLE_RATE = Number.parseFloat(SENTRY_TRACES_SAMPLE_RATE_RAW || '0');

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || '';

const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '';
const TURNSTILE_VERIFY_URL = process.env.EXPO_PUBLIC_TURNSTILE_VERIFY_URL || '';


function isAdminEmail(email) {
  if (!email || ADMIN_EMAILS.length === 0) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  ADMIN_EMAILS,
  SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE,
  POSTHOG_API_KEY,
  POSTHOG_HOST,
  TURNSTILE_SITE_KEY,
  TURNSTILE_VERIFY_URL,
  isAdminEmail,
};
