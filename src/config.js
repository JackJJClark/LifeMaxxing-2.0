const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const ADMIN_EMAILS_RAW = process.env.EXPO_PUBLIC_ADMIN_EMAILS || '';
const ADMIN_EMAILS = ADMIN_EMAILS_RAW
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const ADMIN_LOGIN_EMAIL = process.env.EXPO_PUBLIC_ADMIN_LOGIN_EMAIL || '';
const ADMIN_LOGIN_PASSWORD = process.env.EXPO_PUBLIC_ADMIN_LOGIN_PASSWORD || '';

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  ADMIN_EMAILS,
  ADMIN_LOGIN_EMAIL,
  ADMIN_LOGIN_PASSWORD,
  isAdminEmail,
};
