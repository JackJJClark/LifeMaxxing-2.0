const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  const target = process.argv[2];
  if (!url || !key) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL in env.');
    process.exit(1);
  }
  if (!target) {
    console.error('Usage: node scripts/set-admin.js <user_email_or_id>');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const { data: userByEmail } = await supabase.auth.admin.getUserByEmail(target);
  const userId = userByEmail?.user?.id;
  if (!userId) {
    console.error('User not found for email:', target);
    process.exit(1);
  }
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { ...userByEmail.user.app_metadata, is_admin: true },
  });
  if (error) {
    console.error('Failed to set admin:', error.message);
    process.exit(1);
  }
  console.log(`Set is_admin=true for user ${userId}`);
}

main().catch((err) => {
  console.error('Unhandled error', err);
  process.exit(1);
});
