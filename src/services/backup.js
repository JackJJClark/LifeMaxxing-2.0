import { supabase } from './supabase';
import { isAdminEmail } from '../config';
import { exportAllData, importAllData, clearAllData, touchLastActive } from '../db/db';

const BACKUP_TABLE = 'lifemaxing_backups';

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

export async function signOut() {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function saveBackup() {
  const session = await requireSession();
  const payload = await exportAllData();
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
  return record;
}

export async function loadBackup() {
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
