const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const targetUser = process.argv[2];
  if (!targetUser) {
    console.error('Usage: node scripts/non-admin-check.js <target_user_id>');
    process.exit(1);
  }
  const { error } = await supabase
    .from('lifemaxing_backups')
    .delete()
    .eq('user_id', targetUser);
  if (error) {
    console.log('Expected rejection:', error.message);
    process.exit(0);
  }
  console.warn('Unexpected success—operation should have been blocked.');
}

main().catch((err) => {
  console.error('Unhandled error', err);
  process.exit(1);
});
