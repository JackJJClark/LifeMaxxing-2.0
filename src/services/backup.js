import { supabase } from './supabase';
import { isAdminEmail } from '../config';
import { exportAllData, importAllData, clearAllData, touchLastActive } from '../db/db';

const BACKUP_TABLE = 'lifemaxing_backups';
const BACKUP_HISTORY_TABLE = 'lifemaxing_backup_history';
const USER_PROFILE_TABLE = 'lifemaxing_user_profiles';
const BACKUP_SUMMARY_TABLE = 'lifemaxing_backup_summary';
const SYSTEM_EVENTS_TABLE = 'lifemaxing_system_events';
const ADMIN_AUDIT_TABLE = 'lifemaxing_admin_audit';

async function requireSession() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('Not signed in.');
  }
  return data.session;
}

async function requireAdminSession() {
  const session = await requireSession();
  const email = session.user?.email || '';
  if (!isAdminEmail(email)) {
    throw new Error('Admin access only.');
  }
  return session;
}

export async function signInWithPassword(email, password) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

export async function signUpWithPassword(email, password) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
}

export async function signOut() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function saveBackupPayload(payload, summary = null) {
  const session = await requireSession();
  const record = {
    user_id: session.user.id,
    payload,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(BACKUP_TABLE).upsert(record, {
    onConflict: 'user_id',
  });
  if (error) {
    throw error;
  }
  try {
    const meta = payload && typeof payload === 'object' ? payload.meta || {} : {};
    await supabase.from(BACKUP_HISTORY_TABLE).insert({
      user_id: session.user.id,
      payload_meta: meta,
      updated_at: record.updated_at,
      device_id: meta.deviceId || null,
      app_version: meta.appVersion || null,
      payload,
    });
  } catch (historyError) {
    // Ignore history insert errors (table may not exist yet).
  }
  if (summary) {
    try {
      await supabase.from(BACKUP_SUMMARY_TABLE).upsert(
        {
          user_id: session.user.id,
          updated_at: record.updated_at,
          identity_level: summary.identityLevel || 0,
          total_effort: summary.totalEffort || 0,
          habits: summary.habits || 0,
          efforts: summary.efforts || 0,
          chests: summary.chests || 0,
          items: summary.items || 0,
          last_active_at: summary.lastActiveAt || null,
          payload_bytes: summary.payloadBytes || null,
          device_id: summary.deviceId || null,
          app_version: summary.appVersion || null,
        },
        { onConflict: 'user_id' }
      );
    } catch (summaryError) {
      // Ignore summary errors (table may not exist yet).
    }
  }
  return record;
}

export async function saveBackup() {
  const payload = await exportAllData();
  return saveBackupPayload(payload);
}

export async function fetchBackupPayload() {
  const session = await requireSession();
  const { data, error } = await supabase
    .from(BACKUP_TABLE)
    .select('payload, updated_at')
    .eq('user_id', session.user.id)
    .single();
  if (error) {
    throw error;
  }
  if (!data || !data.payload) {
    throw new Error('No backup found.');
  }
  return data;
}

export async function loadBackup() {
  const data = await fetchBackupPayload();
  await clearAllData();
  await importAllData(data.payload);
  await touchLastActive();
  return data;
}

export async function listBackups({ limit = 50, userId = null } = {}) {
  await requireAdminSession();
  let query = supabase
    .from(BACKUP_TABLE)
    .select('user_id, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

export async function listBackupHistory({ limit = 5, userId = null, includePayload = false } = {}) {
  if (userId) {
    await requireAdminSession();
  } else {
    await requireSession();
  }
  const fields = includePayload
    ? 'id, updated_at, device_id, app_version, payload_meta, payload, user_id'
    : 'id, updated_at, device_id, app_version, payload_meta, user_id';
  let query = supabase
    .from(BACKUP_HISTORY_TABLE)
    .select(fields)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    const session = await supabase.auth.getSession();
    const currentUserId = session?.data?.session?.user?.id;
    if (currentUserId) {
      query = query.eq('user_id', currentUserId);
    }
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

export async function deleteUserBackup({ userId }) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { error } = await supabase.from(BACKUP_TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export async function deleteUserBackupHistory({ userId }) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { error } = await supabase.from(BACKUP_HISTORY_TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export async function deleteUserSummary({ userId }) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { error } = await supabase.from(BACKUP_SUMMARY_TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export async function deleteUserProfile({ userId }) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { error } = await supabase.from(USER_PROFILE_TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export async function deleteUserSystemEvents({ userId }) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { error } = await supabase.from(SYSTEM_EVENTS_TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export async function upsertUserProfile({ email }) {
  const session = await requireSession();
  const record = {
    user_id: session.user.id,
    email: email || session.user?.email || null,
    last_seen_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(USER_PROFILE_TABLE).upsert(record, {
    onConflict: 'user_id',
  });
  if (error) {
    throw error;
  }
  return record;
}

export async function listUserProfiles({ limit = 50, offset = 0, search = '', userId = '' } = {}) {
  await requireAdminSession();
  let query = supabase
    .from(USER_PROFILE_TABLE)
    .select('user_id, email, created_at, last_seen_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) {
    query = query.ilike('email', `%${search}%`);
  }
  if (userId) {
    query = query.eq('user_id', userId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listBackupSummaries({
  limit = 50,
  offset = 0,
  userId = '',
  from = '',
  to = '',
} = {}) {
  await requireAdminSession();
  let query = supabase
    .from(BACKUP_SUMMARY_TABLE)
    .select(
      'user_id, updated_at, identity_level, total_effort, habits, efforts, chests, items, last_active_at, device_id, app_version'
    )
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (userId) query = query.eq('user_id', userId);
  if (from) query = query.gte('updated_at', from);
  if (to) query = query.lte('updated_at', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listSystemEvents({
  limit = 50,
  offset = 0,
  userId = '',
  from = '',
  to = '',
} = {}) {
  await requireAdminSession();
  let query = supabase
    .from(SYSTEM_EVENTS_TABLE)
    .select('id, user_id, type, message, context, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (userId) query = query.eq('user_id', userId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function logSystemEvent({ type, message, context }) {
  const session = await requireSession();
  const record = {
    user_id: session.user.id,
    type,
    message: message || null,
    context: context || null,
  };
  const { error } = await supabase.from(SYSTEM_EVENTS_TABLE).insert(record);
  if (error) {
    throw error;
  }
  return record;
}

export async function logAdminAction({ action, targetUserId, context }) {
  const session = await requireAdminSession();
  const record = {
    admin_user_id: session.user.id,
    action,
    target_user_id: targetUserId || null,
    context: context || null,
  };
  const { error } = await supabase.from(ADMIN_AUDIT_TABLE).insert(record);
  if (error) {
    throw error;
  }
  return record;
}

export async function listAdminAudit({
  limit = 50,
  offset = 0,
  targetUserId = '',
  from = '',
  to = '',
} = {}) {
  await requireAdminSession();
  let query = supabase
    .from(ADMIN_AUDIT_TABLE)
    .select('id, admin_user_id, action, target_user_id, context, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (targetUserId) query = query.eq('target_user_id', targetUserId);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchBackupForUserId(userId) {
  if (!userId) throw new Error('User id required.');
  await requireAdminSession();
  const { data, error } = await supabase
    .from(BACKUP_TABLE)
    .select('payload, updated_at')
    .eq('user_id', userId)
    .single();
  if (error) {
    throw error;
  }
  if (!data || !data.payload) {
    throw new Error('No backup found.');
  }
  return data;
}

export async function loadBackupForUserId(userId) {
  const data = await fetchBackupForUserId(userId);
  await clearAllData();
  await importAllData(data.payload);
  await touchLastActive();
  return data;
}
