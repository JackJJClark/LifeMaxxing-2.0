import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView, Platform, Image } from 'react-native';
import { ADMIN_EMAILS, TURNSTILE_SITE_KEY, isAdminEmail } from '../config';
import { supabase } from '../services/supabase';
import {
  signInWithPassword,
  signUpWithPassword,
  signOut,
  saveBackupPayload,
  listBackups,
  fetchBackupForUserId,
  fetchBackupPayload,
} from '../services/backup';
import {
  createHabit,
  createCombatEncounter,
  clearAllData,
  getInactivityDays,
  getMercyStatus,
  getLatestLockedChest,
  getOrCreateIdentity,
  getStatusSnapshot,
  initDb,
  listChests,
  listHabits,
  listItems,
  getEvidenceSummary,
  listRecentEfforts,
  exportAllData,
  importAllData,
  touchLastActive,
  logEffort,
  resolveCombatEncounter,
  setHabitActive,
  getHabitEffortForName,
  deleteHabit,
} from '../db/db';

const TOP_BAR_HEIGHT = Platform.OS === 'web' ? 80 : 88;
const BRAND_BOX_SIZE = Platform.OS === 'web' ? 56 : 64;
const BRAND_LOGO_SIZE = Platform.OS === 'web' ? 44 : 52;
const EMAIL_AUTH_ENABLED = true;
const FONT = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  hero: 36,
};
const ACCENT_GOLD = '#f6c46a';
const ENCRYPTION_VERSION = 1;
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function TurnstileWidget({ onToken, onError }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !TURNSTILE_SITE_KEY) return undefined;
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    let mounted = true;
    let widgetId = null;

    const loadScript = () => {
      if (window.turnstile) return Promise.resolve();
      const existing = document.querySelector('script[data-turnstile]');
      if (existing) {
        return new Promise((resolve, reject) => {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        });
      }
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Turnstile script failed to load.'));
        document.head.appendChild(script);
      });
    };

    const renderWidget = async () => {
      try {
        await loadScript();
        if (!mounted || !window.turnstile || !containerRef.current) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => {
            if (onToken) onToken(token);
          },
          'error-callback': () => {
            if (onError) onError('Turnstile error.');
          },
          'expired-callback': () => {
            if (onToken) onToken('');
          },
        });
      } catch (error) {
        if (onError) onError(error?.message || 'Turnstile error.');
      }
    };

    renderWidget();

    return () => {
      mounted = false;
      if (window.turnstile && widgetId !== null) {
        try {
          window.turnstile.remove(widgetId);
        } catch (error) {
          // Ignore cleanup errors.
        }
      }
    };
  }, [onError, onToken]);

  if (Platform.OS !== 'web' || !TURNSTILE_SITE_KEY) return null;
  return <View ref={containerRef} style={styles.turnstileContainer} />;
}

function canUseWebCrypto() {
  return (
    typeof window !== 'undefined' &&
    window.crypto &&
    window.crypto.subtle &&
    typeof TextEncoder !== 'undefined' &&
    typeof TextDecoder !== 'undefined'
  );
}

function isEncryptedPayload(payload) {
  return (
    payload &&
    typeof payload === 'object' &&
    payload.__encrypted === true &&
    payload.data &&
    payload.iv &&
    payload.salt
  );
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 150000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptPayload(passphrase, payload) {
  if (!canUseWebCrypto()) {
    throw new Error('Encryption is available on web only.');
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(JSON.stringify(payload));
  const cipherBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    __encrypted: true,
    v: ENCRYPTION_VERSION,
    alg: 'AES-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(cipherBuffer)),
  };
}

async function decryptPayload(passphrase, envelope) {
  if (!canUseWebCrypto()) {
    throw new Error('Decryption is available on web only.');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const data = fromBase64(envelope.data);
  const key = await deriveKey(passphrase, salt);
  const plainBuffer = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plainBuffer));
}

export default function StatusScreen() {
  const SHOW_TRUST_TESTS = true;
  const QUIET_MODE_DAYS = 2;
  const BASE_TABS = [
    'Tasks',
    'Inventory',
    'Shops',
    'Party',
    'Group',
    'Challenges',
    'Help',
  ];
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitId, setHabitId] = useState(null);
  const [inactivityDays, setInactivityDays] = useState(0);
  const [newHabitName, setNewHabitName] = useState('');
  const [chests, setChests] = useState([]);
  const [items, setItems] = useState([]);
  const [efforts, setEfforts] = useState([]);
  const [effortFilter, setEffortFilter] = useState('all');
  const [effortInfo, setEffortInfo] = useState(null);
  const [effortNote, setEffortNote] = useState('');
  const [habitEfforts, setHabitEfforts] = useState({});
  const [evidence, setEvidence] = useState(null);
  const [combatChest, setCombatChest] = useState(null);
  const [combatMessage, setCombatMessage] = useState('');
  const [mercyStatus, setMercyStatus] = useState(null);
  const [accountMessage, setAccountMessage] = useState('');
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('unknown');
  const [authEmail, setAuthEmail] = useState('');
  const [adminStatus, setAdminStatus] = useState('unknown');
  const [adminMessage, setAdminMessage] = useState('');
  const [adminClaim, setAdminClaim] = useState(null);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState('login');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminBackups, setAdminBackups] = useState([]);
  const [adminFilter, setAdminFilter] = useState('');
  const [adminSelectedUserId, setAdminSelectedUserId] = useState('');
  const [adminSummary, setAdminSummary] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminLog, setAdminLog] = useState([]);
  const [activeTab, setActiveTab] = useState('Tasks');
  const [rlsMessage, setRlsMessage] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileMessage, setTurnstileMessage] = useState('');

  const adminEnabled = ADMIN_EMAILS.length > 0;
  const authEnabled = !!supabase;
  const showAdminTab = Platform.OS === 'web' && adminEnabled;
  const navTabs = useMemo(() => {
    const tabs = [...BASE_TABS];
    if (showAdminTab) tabs.push('Admin');
    return tabs;
  }, [showAdminTab]);

  async function refresh() {
    const snap = await getStatusSnapshot();
    const days = await getInactivityDays();
    const mercy = await getMercyStatus(days);
    const habitList = await listHabits();
    const chestList = await listChests(5);
    const itemList = await listItems(20);
    const effortList = await listRecentEfforts({
      limit: 6,
      habitId: effortFilter === 'all' ? null : effortFilter,
    });
    const evidenceSummary = await getEvidenceSummary();
    const latestChest = await getLatestLockedChest();
    setSnapshot(snap);
    setInactivityDays(days);
    setMercyStatus(mercy);
    setHabits(habitList);
    setChests(chestList);
    setItems(itemList);
    setEfforts(effortList);
    setEvidence(evidenceSummary);
    setCombatChest(latestChest);
    if (habitList.length > 0) {
      const effortEntries = await Promise.all(
        habitList.map(async (habit) => {
          const info = await getHabitEffortForName(habit.name);
          return [habit.id, info];
        })
      );
      setHabitEfforts(Object.fromEntries(effortEntries));
    } else {
      setHabitEfforts({});
    }
    if (!habitId && habitList.length > 0) {
      const active = habitList.find((habit) => habit.isActive);
      setHabitId(active ? active.id : habitList[0].id);
    }
  }

  async function refreshAuthStatus() {
    if (!authEnabled || !EMAIL_AUTH_ENABLED) {
      setAuthStatus('disabled');
      setAuthEmail('');
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
      setAdminClaim(null);
      setLastBackupAt(null);
      if (Platform.OS === 'web' && !onboardingDismissed) {
        setShowOnboarding(true);
        setOnboardingStep('login');
      } else {
        setShowOnboarding(false);
      }
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setAuthStatus('signed_out');
      setAuthEmail('');
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
      setAdminClaim(null);
      setLastBackupAt(null);
      if (Platform.OS === 'web' && !onboardingDismissed) {
        setShowOnboarding(true);
        setOnboardingStep('login');
      }
      return;
    }
    const sessionEmail = data.session.user?.email || '';
    const claim = data.session.user?.app_metadata?.is_admin;
    setAuthStatus('signed_in');
    setAuthEmail(sessionEmail);
    setAdminClaim(typeof claim === 'boolean' ? claim : null);
    if (adminEnabled && isAdminEmail(sessionEmail)) {
      setAdminStatus('signed_in');
    } else {
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
    }
    setShowOnboarding(false);
  }

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      await initDb();
      await getOrCreateIdentity();
      if (!alive) return;
      await refresh();
      await refreshAuthStatus();
      setLoading(false);
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const stored = window.localStorage.getItem('lifemaxing.activeTab');
      if (stored) {
        setActiveTab(stored);
      }
    } catch (error) {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const stored = window.localStorage.getItem('lifemaxing.onboarding.dismissed');
      if (stored === 'true') {
        setOnboardingDismissed(true);
      }
    } catch (error) {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      window.localStorage.setItem('lifemaxing.activeTab', activeTab);
    } catch (error) {
      // Ignore storage errors.
    }
  }, [activeTab]);

  const selectedHabit = useMemo(
    () => habits.find((habit) => habit.id === habitId) || null,
    [habits, habitId]
  );

  useEffect(() => {
    refresh();
  }, [effortFilter]);


  useEffect(() => {
    let alive = true;
    async function loadEffortInfo() {
      if (!selectedHabit) {
        setEffortInfo(null);
        return;
      }
      const info = await getHabitEffortForName(selectedHabit.name);
      if (alive) {
        setEffortInfo(info);
      }
    }
    loadEffortInfo();
    return () => {
      alive = false;
    };
  }, [selectedHabit?.name]);

  useEffect(() => {
    if (showAdminTab && activeTab === 'Admin' && adminBackups.length === 0) {
      handleRefreshBackups();
    }
  }, [showAdminTab, activeTab]);

  const isQuietMode = inactivityDays >= QUIET_MODE_DAYS;
  const turnstileEnabled = Platform.OS === 'web' && !!TURNSTILE_SITE_KEY;
  const turnstileStatus = turnstileToken ? 'Turnstile token ready.' : turnstileMessage;

  function handleTurnstileToken(token) {
    setTurnstileToken(token);
    if (token) {
      setTurnstileMessage('Turnstile token ready.');
    } else if (turnstileEnabled) {
      setTurnstileMessage('Turnstile expired. Complete the check again.');
    } else {
      setTurnstileMessage('');
    }
  }

  function handleTurnstileError(message) {
    setTurnstileToken('');
    setTurnstileMessage(message || 'Turnstile error.');
  }
  const hasPassphrase = backupPassphrase.trim().length > 0;
  const encryptionEnabled = Platform.OS === 'web' && hasPassphrase;

  async function encryptIfNeeded(payload) {
    if (!hasPassphrase) return payload;
    if (Platform.OS !== 'web') {
      throw new Error('Backup encryption is available on web only.');
    }
    return encryptPayload(backupPassphrase, payload);
  }

  async function decryptIfNeeded(payload) {
    if (!isEncryptedPayload(payload)) return payload;
    if (!hasPassphrase) {
      throw new Error('Passphrase required to decrypt this backup.');
    }
    return decryptPayload(backupPassphrase, payload);
  }

  async function handleLogEffort(customHabitId, customHabitName) {
    const targetHabitId = customHabitId || habitId;
    if (!targetHabitId) return;
    const targetHabit = customHabitName
      ? { name: customHabitName, isActive: true }
      : selectedHabit;
    if (!targetHabit || !targetHabit.isActive) {
      return;
    }
    const cleanedNote = effortNote.trim();
    const result = await logEffort({
      habitId: targetHabitId,
      note: cleanedNote.length ? cleanedNote : null,
    });
    await refresh();
    setEffortNote('');
    if (authStatus === 'signed_in') {
      try {
        const payload = await exportAllData();
        const encryptedPayload = await encryptIfNeeded(payload);
        const record = await saveBackupPayload(encryptedPayload);
        setLastBackupAt(record.updated_at);
      } catch (error) {
        setAccountMessage(error?.message || 'Auto-backup failed.');
      }
    }
  }

  async function handleCombat(outcome) {
    if (!combatChest) return;
    const encounter = await createCombatEncounter(combatChest.id);
    if (!encounter) return;
    const result = await resolveCombatEncounter({
      encounterId: encounter.id,
      chestId: combatChest.id,
      outcome,
    });
    if (outcome === 'win') {
      setCombatMessage(`Victory: unlocked ${result.unlocked} reward(s).`);
    } else {
      setCombatMessage('No downside. Rewards remain locked.');
    }
    await refresh();
  }

  async function handleAccountSignIn() {
    if (!authEnabled || !EMAIL_AUTH_ENABLED) {
      setAccountMessage('Account linking is not enabled.');
      return;
    }
    setTurnstileMessage('');
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      await signInWithPassword(loginEmail.trim(), loginPassword);
      await refreshAuthStatus();
      try {
        const record = await fetchBackupPayload();
        const decrypted = await decryptIfNeeded(record.payload);
        await clearAllData();
        await importAllData(decrypted);
        await touchLastActive();
        setLastBackupAt(record.updated_at);
        await refresh();
        setAccountMessage(
          isEncryptedPayload(record.payload)
            ? 'Signed in. Encrypted backup loaded.'
            : 'Signed in. Latest backup loaded.'
        );
      } catch (error) {
        setAccountMessage(error?.message || 'Signed in. No backup found.');
      }
      setAdminLog((prev) => [
        { label: 'Signed in', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      setShowLoginForm(false);
      setLoginPassword('');
      setAdminBackups([]);
      setAdminSelectedUserId('');
      setAdminSummary(null);
    } catch (error) {
      setAccountMessage(error?.message || 'Sign in failed.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAccountSignOut() {
    if (!authEnabled) {
      setAccountMessage('Account linking is not enabled.');
      return;
    }
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      await signOut();
      await refreshAuthStatus();
      setLastBackupAt(null);
      setAccountMessage('Signed out.');
      setAdminLog((prev) => [
        { label: 'Signed out', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      setAdminBackups([]);
      setAdminSelectedUserId('');
      setAdminSummary(null);
    } catch (error) {
      setAccountMessage(error?.message || 'Sign out failed.');
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleSaveBackup() {
    if (!authEnabled) {
      setAccountMessage('Account linking is not enabled.');
      setAdminMessage('Account linking is not enabled.');
      return;
    }
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      const payload = await exportAllData();
      const encryptedPayload = await encryptIfNeeded(payload);
      const record = await saveBackupPayload(encryptedPayload);
      setLastBackupAt(record.updated_at);
      const message = `Backup saved (${new Date(record.updated_at).toLocaleString()}).${
        isEncryptedPayload(encryptedPayload) ? ' Encrypted.' : ''
      }`;
      setAccountMessage(message);
      setAdminMessage(message);
      setAdminLog((prev) => [
        { label: 'Saved backup (self)', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      const message = error?.message || 'Backup failed.';
      setAccountMessage(message);
      setAdminMessage(message);
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleLoadBackup() {
    if (!authEnabled) {
      setAccountMessage('Account linking is not enabled.');
      setAdminMessage('Account linking is not enabled.');
      return;
    }
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      const record = await fetchBackupPayload();
      const decrypted = await decryptIfNeeded(record.payload);
      await clearAllData();
      await importAllData(decrypted);
      await touchLastActive();
      setLastBackupAt(record.updated_at);
      await refresh();
      const message = `Backup loaded (${new Date(record.updated_at).toLocaleString()}).${
        isEncryptedPayload(record.payload) ? ' Decrypted.' : ''
      }`;
      setAccountMessage(message);
      setAdminMessage(message);
      setAdminLog((prev) => [
        { label: 'Loaded backup (self)', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      const message = error?.message || 'Load failed.';
      setAccountMessage(message);
      setAdminMessage(message);
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleRefreshBackups() {
    if (adminStatus !== 'signed_in') {
      setAdminMessage('Admin access only.');
      return;
    }
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const list = await listBackups({
        limit: 50,
        userId: adminFilter.trim() || null,
      });
      setAdminBackups(list);
      if (list.length === 0) {
        setAdminMessage('No backups found.');
      }
      setAdminLog((prev) => [
        { label: 'Refreshed backup list', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      setAdminMessage(error?.message || 'Failed to load backups.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handlePreviewBackup() {
    if (adminStatus !== 'signed_in') {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const data = await fetchBackupForUserId(adminSelectedUserId);
      const payload = data.payload || {};
      const payloadBytes = JSON.stringify(payload).length;
      if (isEncryptedPayload(payload)) {
        setAdminSummary({
          updatedAt: data.updated_at,
          identityLevel: 0,
          totalEffort: 0,
          habits: 0,
          efforts: 0,
          chests: 0,
          items: 0,
          payloadBytes,
          encrypted: true,
        });
      } else {
        setAdminSummary({
          updatedAt: data.updated_at,
          identityLevel: payload.identity?.level || 0,
          totalEffort: payload.identity?.totalEffortUnits || 0,
          habits: payload.habits?.length || 0,
          efforts: payload.effortLogs?.length || 0,
          chests: payload.chests?.length || 0,
          items: payload.items?.length || 0,
          payloadBytes,
          encrypted: false,
        });
      }
      setAdminLog((prev) => [
        { label: 'Previewed backup', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      setAdminMessage(error?.message || 'Preview failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleLoadBackupForUser() {
    if (adminStatus !== 'signed_in') {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const record = await fetchBackupForUserId(adminSelectedUserId);
      const decrypted = await decryptIfNeeded(record.payload);
      await clearAllData();
      await importAllData(decrypted);
      await touchLastActive();
      await refresh();
      setAdminMessage(
        `Loaded backup (${new Date(record.updated_at).toLocaleString()}).${
          isEncryptedPayload(record.payload) ? ' Decrypted.' : ''
        }`
      );
      setAdminLog((prev) => [
        { label: 'Loaded backup to device', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      setAdminMessage(error?.message || 'Load failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleExportBackup() {
    if (adminStatus !== 'signed_in') {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const data = await fetchBackupForUserId(adminSelectedUserId);
      const payload = data.payload || {};
      const fileName = `lifemaxing_backup_${adminSelectedUserId}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        setAdminMessage('Backup exported.');
      } else {
        setAdminMessage('Export is available on web only.');
      }
      setAdminLog((prev) => [
        { label: 'Exported backup JSON', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      setAdminMessage(error?.message || 'Export failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  function formatHabitName(raw) {
    if (!raw) return '';
    const trimmed = raw.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  function habitEmoji(name) {
    const text = name.toLowerCase();
    if (text.includes('gym') || text.includes('lift') || text.includes('workout')) return '💪';
    if (text.includes('run') || text.includes('cardio')) return '🏃';
    if (text.includes('water') || text.includes('hydrate')) return '💧';
    if (text.includes('sleep') || text.includes('bed')) return '😴';
    if (text.includes('meditate') || text.includes('mind')) return '🧘';
    if (text.includes('read')) return '📚';
    if (text.includes('walk')) return '🚶';
    if (text.includes('meal') || text.includes('protein') || text.includes('nutrition')) return '🥗';
    return '⭐';
  }

  async function handleCreateHabit() {
    const name = formatHabitName(newHabitName);
    if (!name) return;
    const decorated = `${habitEmoji(name)} ${name}`;
    const created = await createHabit(decorated);
    setNewHabitName('');
    setHabitId(created.id);
    await handleLogEffort(created.id, created.name);
    await refresh();
  }

  async function handleToggleHabit(habit) {
    await setHabitActive(habit.id, !habit.isActive);
    if (!habit.isActive) {
      await handleLogEffort(habit.id, habit.name);
    }
    if (habit.id === habitId && habit.isActive) {
      const nextActive = habits.find((item) => item.isActive && item.id !== habit.id);
      setHabitId(nextActive ? nextActive.id : null);
    }
    await refresh();
  }

  async function handleDeleteHabit(habit) {
    await deleteHabit(habit.id);
    if (habit.id === habitId) {
      setHabitId(null);
    }
    await refresh();
  }

  async function handleVerifyRls() {
    if (!authEnabled) {
      setRlsMessage('Supabase is not configured.');
      return;
    }
    setAdminLoading(true);
    setRlsMessage('');
    try {
      const { data, error } = await supabase
        .from('lifemaxing_backups')
        .select('user_id')
        .limit(1);
      if (error) {
        setRlsMessage('RLS blocked the query (expected for non-admin).');
      } else if (data && data.length > 0) {
        setRlsMessage(`RLS allowed select. Rows visible: ${data.length}.`);
      } else {
        setRlsMessage('RLS allowed select, but no rows visible.');
      }
    } catch (error) {
      setRlsMessage(error?.message || 'RLS check failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleAccountSignUp() {
    if (!authEnabled || !EMAIL_AUTH_ENABLED) {
      setAccountMessage('Account linking is not enabled.');
      return;
    }
    setTurnstileMessage('');
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      await signUpWithPassword(loginEmail.trim(), loginPassword);
      await refreshAuthStatus();
      setAccountMessage('Sign up complete. Check your email to confirm, then sign in.');
      setAdminLog((prev) => [
        { label: 'Signed up', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      setShowLoginForm(false);
      setLoginPassword('');
      setOnboardingStep('login');
    } catch (error) {
      setAccountMessage(error?.message || 'Sign up failed.');
    } finally {
      setAdminBusy(false);
    }
  }

  function handleContinueGuest() {
    setShowOnboarding(false);
    setOnboardingDismissed(true);
    setOnboardingStep('login');
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem('lifemaxing.onboarding.dismissed', 'true');
      } catch (error) {
        // Ignore storage errors.
      }
    }
  }

  async function handleResetLocalData() {
    const confirmReset =
      Platform.OS !== 'web' ||
      (typeof window !== 'undefined' &&
        window.confirm('Clear all local data on this device? This cannot be undone.'));
    if (!confirmReset) return;
    await clearAllData();
    await getOrCreateIdentity();
    setHabitId(null);
    await refresh();
    setAccountMessage('Local data cleared on this device.');
  }

  function handleShowOnboarding() {
    setShowOnboarding(true);
    setOnboardingStep('login');
    setOnboardingDismissed(false);
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem('lifemaxing.onboarding.dismissed', 'false');
      } catch (error) {
        // Ignore storage errors.
      }
    }
  }

  async function handleExportLocalData() {
    if (Platform.OS !== 'web') {
      setAccountMessage('Export is available on web only.');
      return;
    }
    try {
      const payload = await exportAllData();
      const encryptedPayload = await encryptIfNeeded(payload);
      const blob = new Blob([JSON.stringify(encryptedPayload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      link.href = url;
      link.download = `lifemaxing_export_${stamp}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setAccountMessage(
        isEncryptedPayload(encryptedPayload) ? 'Local data exported (encrypted).' : 'Local data exported.'
      );
    } catch (error) {
      setAccountMessage(error?.message || 'Export failed.');
    }
  }

  async function handleImportLocalData() {
    if (Platform.OS !== 'web') {
      setAccountMessage('Import is available on web only.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (event) => {
      const file = event.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const payload = JSON.parse(reader.result);
          const decrypted = await decryptIfNeeded(payload);
          await clearAllData();
          await importAllData(decrypted);
          await refresh();
          setAccountMessage(
            isEncryptedPayload(payload) ? 'Local data imported (decrypted).' : 'Local data imported.'
          );
        } catch (error) {
          setAccountMessage(error?.message || 'Import failed.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  if (loading || !snapshot) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingPanel}>
          <Image
            source={require('../../assets/lifemaxxing-logo.png')}
            style={styles.loadingLogo}
            accessibilityLabel="Lifemaxxing logo"
          />
          <Text style={styles.loadingTitle}>Lifemaxxing</Text>
          <Text style={styles.loadingSubtle}>Stabilizing identity...</Text>
        </View>
      </View>
    );
  }

  const { identity, counts } = snapshot;
  const unlockedItems = items.filter((item) => !item.locked);
  const activeHabits = habits.filter((habit) => habit.isActive).length;
  const pausedHabits = habits.length - activeHabits;
  const showTasks = activeTab === 'Tasks';
  const showInventory = activeTab === 'Inventory';
  const showChallenges = activeTab === 'Challenges';
  const showHelp = activeTab === 'Help';
  const showAdmin = activeTab === 'Admin';
  const showPlaceholder = ['Shops', 'Party', 'Group'].includes(activeTab);

  function getHabitTags(name) {
    const text = name.toLowerCase();
    const tags = new Set();
    if (text.includes('gym') || text.includes('lift') || text.includes('strength')) {
      tags.add('Strength');
      tags.add('Endurance');
    }
    if (text.includes('run') || text.includes('cardio') || text.includes('cycle')) {
      tags.add('Endurance');
      tags.add('Mobility');
    }
    if (text.includes('sleep') || text.includes('bed') || text.includes('rest')) {
      tags.add('Sleep');
    }
    if (text.includes('meditate') || text.includes('focus') || text.includes('study')) {
      tags.add('Focus');
    }
    if (text.includes('meal') || text.includes('nutrition') || text.includes('protein')) {
      tags.add('Nutrition');
    }
    if (text.includes('walk') || text.includes('stretch') || text.includes('mobility')) {
      tags.add('Mobility');
    }
    if (text.includes('journal') || text.includes('mood') || text.includes('gratitude')) {
      tags.add('Mood');
    }
    if (tags.size === 0) {
      tags.add('Focus');
    }
    return Array.from(tags);
  }

  // Stats system is intentionally deferred to a later phase.

  const mainContent = (
    <>
      <Text style={styles.title}>Lifemaxxing</Text>

      {showPlaceholder ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{activeTab}</Text>
          {activeTab === 'Shops' ? (
            <>
              <Text style={styles.subtle}>Catalog placeholder for demo.</Text>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Unlocked Items</Text>
                <Text style={styles.statValue}>{unlockedItems.length}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Locked Items</Text>
                <Text style={styles.statValue}>{items.length - unlockedItems.length}</Text>
              </View>
              <Text style={styles.subtle}>Future: spend rewards, rotate offers.</Text>
            </>
          ) : null}
          {activeTab === 'Party' ? (
            <>
              <Text style={styles.subtle}>Party roster placeholder.</Text>
              <View style={styles.habitRow}>
                <View style={styles.habitChip}>
                  <Text style={styles.habitText}>You (Leader)</Text>
                </View>
                <View style={styles.habitToggle}>
                  <Text style={styles.habitToggleText}>Online</Text>
                </View>
              </View>
              <View style={styles.habitRow}>
                <View style={styles.habitChip}>
                  <Text style={styles.habitText}>Empty Slot</Text>
                </View>
                <View style={styles.habitToggle}>
                  <Text style={styles.habitToggleText}>Invite</Text>
                </View>
              </View>
              <Text style={styles.subtle}>Future: party buffs and shared quests.</Text>
            </>
          ) : null}
          {activeTab === 'Group' ? (
            <>
              <Text style={styles.subtle}>Group hub placeholder.</Text>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Identity Level</Text>
                <Text style={styles.statValue}>{identity.level}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Total Effort</Text>
                <Text style={styles.statValue}>{identity.totalEffortUnits}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Active Days</Text>
                <Text style={styles.statValue}>{evidence ? evidence.activeDays : 0}</Text>
              </View>
              <Text style={styles.subtle}>Future: shared metrics + sync.</Text>
            </>
          ) : null}
        </View>
      ) : null}

      {showTasks ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Status</Text>
          <View style={styles.heroRow}>
            <View style={styles.avatarBox}>
              <Text style={styles.avatarText}>SIGIL</Text>
            </View>
            <View style={styles.heroStats}>
              <Text style={styles.heroLabel}>Identity Level</Text>
              <Text style={styles.heroValue}>{identity.level}</Text>
              <Text style={styles.heroSubtle}>Total Effort: {identity.totalEffortUnits}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Habits</Text>
            <Text style={styles.statValue}>{counts.habits}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Efforts Logged</Text>
            <Text style={styles.statValue}>{counts.efforts}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Chests Earned</Text>
            <Text style={styles.statValue}>{counts.chests}</Text>
          </View>
          <Text style={styles.subtle}>
            Days since last effort: {inactivityDays}
          </Text>
          <Text style={styles.subtle}>
            Re-entry mode: {isQuietMode ? 'quiet' : 'standard'} (quiet after {QUIET_MODE_DAYS}+ days)
          </Text>
          <Text style={styles.subtle}>
            Active habits: {activeHabits} - Paused: {pausedHabits}
          </Text>
          {!EMAIL_AUTH_ENABLED ? (
            <Text style={styles.subtle}>
              Email sign-in disabled until a domain is configured.
            </Text>
          ) : null}
          {mercyStatus?.eligible ? (
            <Text style={styles.subtle}>Mercy active: slight chest boost on next effort.</Text>
          ) : null}
          {mercyStatus && !mercyStatus.eligible && mercyStatus.cooldownDaysRemaining > 0 ? (
            <Text style={styles.subtle}>
              Mercy recharges in {mercyStatus.cooldownDaysRemaining} days.
            </Text>
          ) : null}
        </View>
      ) : null}

      {showTasks ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Core Stats</Text>
          <Text style={styles.subtle}>
            Phase 2: character stats + point system rewrite.
          </Text>
        </View>
      ) : null}

      {showTasks && evidence ? (
        <View style={[styles.panel, styles.panelTight]}>
          <Text style={styles.panelTitle}>Evidence</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Days Shown Up</Text>
            <Text style={styles.statValue}>{evidence.activeDays}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Last Effort</Text>
            <Text style={styles.statValue}>
              {evidence.lastEffortAt
                ? new Date(evidence.lastEffortAt).toLocaleDateString()
                : 'No log yet'}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Last Chest</Text>
            <Text style={styles.statValue}>
              {evidence.lastChestAt
                ? new Date(evidence.lastChestAt).toLocaleDateString()
                : 'No chest yet'}
            </Text>
          </View>
        </View>
      ) : null}

      {showTasks && isQuietMode ? (
        <View style={styles.panelQuiet}>
          <Text style={styles.panelTitle}>Re-entry</Text>
          <Text style={styles.quietText}>
            No backlog. Creating a habit auto-logs effort.
          </Text>
        </View>
      ) : null}

      {showHelp ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Account</Text>
          <Text style={styles.subtle}>
            {authStatus === 'signed_in'
              ? `Mode: Linked (${authEmail || 'signed in'})`
              : 'Mode: Guest (local-first)'}
          </Text>
          {adminStatus === 'signed_in' ? (
            <Text style={styles.subtle}>Admin access enabled.</Text>
          ) : null}
          {authStatus === 'signed_in' ? (
            <Text style={styles.subtle}>
              Admin claim: {adminClaim === null ? 'Not present' : adminClaim ? 'true' : 'false'}
            </Text>
          ) : null}
          {authStatus === 'disabled' ? (
            <Text style={styles.subtle}>Account linking is not configured.</Text>
          ) : null}
          <Pressable
            style={styles.buttonGhost}
            onPress={() => setShowLoginForm((current) => !current)}
            disabled={!authEnabled}
          >
            <Text style={styles.buttonGhostText}>Link account</Text>
          </Pressable>
          {showLoginForm ? (
            <View style={styles.loginPanel}>
              <TextInput
                value={loginEmail}
                onChangeText={setLoginEmail}
                placeholder="Email"
                placeholderTextColor="#4b5563"
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TextInput
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="Password"
                placeholderTextColor="#4b5563"
                style={styles.input}
                secureTextEntry
              />
              {turnstileEnabled ? (
                <>
                  <TurnstileWidget
                    onToken={handleTurnstileToken}
                    onError={handleTurnstileError}
                  />
                  {turnstileStatus ? (
                    <Text style={styles.subtle}>{turnstileStatus}</Text>
                  ) : null}
                </>
              ) : null}
              <Pressable
                style={styles.button}
                onPress={handleAccountSignIn}
                disabled={adminBusy}
              >
                <Text style={styles.buttonText}>Sign in</Text>
              </Pressable>
            </View>
          ) : null}
          {authStatus === 'signed_in' ? (
            <Pressable
              style={styles.buttonGhost}
              onPress={handleAccountSignOut}
              disabled={adminBusy}
            >
              <Text style={styles.buttonGhostText}>Sign out</Text>
            </Pressable>
          ) : null}
          {authStatus === 'signed_in' ? (
            <View style={styles.menuSection}>
              <Text style={styles.menuLabel}>Backup</Text>
              <Text style={styles.subtle}>
                Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'None'}
              </Text>
              <Pressable
                style={styles.buttonGhost}
                onPress={handleSaveBackup}
                disabled={adminBusy}
              >
                <Text style={styles.buttonGhostText}>Save backup</Text>
              </Pressable>
              <Pressable
                style={styles.buttonGhost}
                onPress={handleLoadBackup}
                disabled={adminBusy}
              >
                <Text style={styles.buttonGhostText}>Load backup to this device</Text>
              </Pressable>
              {Platform.OS === 'web' ? (
                <View style={styles.menuSection}>
                  <Text style={styles.menuLabel}>Backup Encryption</Text>
                  <TextInput
                    value={backupPassphrase}
                    onChangeText={setBackupPassphrase}
                    placeholder="Passphrase (optional)"
                    placeholderTextColor="#4b5563"
                    style={styles.input}
                    secureTextEntry
                  />
                  <Text style={styles.subtle}>
                    {encryptionEnabled
                      ? 'Encrypting backups on this device.'
                      : 'Leave blank to save unencrypted backups.'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.subtle}>Backup encryption is available on web only.</Text>
              )}
            </View>
          ) : null}
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Local Data</Text>
            <Pressable style={styles.buttonGhost} onPress={handleExportLocalData}>
              <Text style={styles.buttonGhostText}>Export local data</Text>
            </Pressable>
            <Pressable style={styles.buttonGhost} onPress={handleImportLocalData}>
              <Text style={styles.buttonGhostText}>Import local data</Text>
            </Pressable>
            <Pressable style={styles.buttonGhost} onPress={handleResetLocalData}>
              <Text style={styles.buttonGhostText}>Reset local data</Text>
            </Pressable>
          </View>
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Account & Onboarding</Text>
            <Pressable style={styles.buttonGhost} onPress={handleShowOnboarding}>
              <Text style={styles.buttonGhostText}>Show onboarding</Text>
            </Pressable>
          </View>
          {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
        </View>
      ) : null}

      {showAdmin ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Admin Dashboard</Text>
          <Text style={styles.subtle}>
            Server must enforce RLS. Client checks alone are not sufficient.
          </Text>
          <Text style={styles.subtle}>
            Admin email list only gates UI visibility, not data access.
          </Text>
          {adminStatus === 'disabled' ? (
            <Text style={styles.subtle}>Admin tools are disabled.</Text>
          ) : null}
          {adminStatus === 'signed_out' ? (
            <Text style={styles.subtle}>Sign in via Help > Link account to access admin tools.</Text>
          ) : null}
          {adminStatus === 'signed_in' ? (
            <>
              <Text style={styles.subtle}>Backups (Supabase)</Text>
              <Pressable
                style={styles.buttonGhost}
                onPress={handleVerifyRls}
                disabled={adminLoading}
              >
                <Text style={styles.buttonGhostText}>Verify RLS</Text>
              </Pressable>
              {rlsMessage ? <Text style={styles.subtle}>{rlsMessage}</Text> : null}
              <View style={styles.habitInputRow}>
                <TextInput
                  value={adminFilter}
                  onChangeText={setAdminFilter}
                  placeholder="Filter by user id (optional)"
                  placeholderTextColor="#4b5563"
                  style={styles.input}
                  autoCapitalize="none"
                />
                <Pressable
                  style={styles.buttonSmall}
                  onPress={handleRefreshBackups}
                  disabled={adminLoading}
                >
                  <Text style={styles.buttonText}>Refresh</Text>
                </Pressable>
              </View>
              {adminBackups.length === 0 ? (
                <Text style={styles.subtle}>No backups loaded yet.</Text>
              ) : (
                adminBackups.map((backup) => (
                  <Pressable
                    key={backup.user_id}
                    style={[
                      styles.adminRow,
                      adminSelectedUserId === backup.user_id && styles.adminRowSelected,
                    ]}
                    onPress={() => {
                      setAdminSelectedUserId(backup.user_id);
                      setAdminSummary(null);
                    }}
                  >
                    <View>
                      <Text style={styles.adminRowTitle}>{backup.user_id}</Text>
                      <Text style={styles.subtle}>
                        Updated {new Date(backup.updated_at).toLocaleString()}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
              {adminSelectedUserId ? (
                <View style={styles.menuSection}>
                  <Text style={styles.menuLabel}>Selected Backup</Text>
                  <Text style={styles.subtle}>{adminSelectedUserId}</Text>
                  <Pressable
                    style={styles.button}
                    onPress={handlePreviewBackup}
                    disabled={adminLoading}
                  >
                    <Text style={styles.buttonText}>Preview summary</Text>
                  </Pressable>
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={handleExportBackup}
                    disabled={adminLoading}
                  >
                    <Text style={styles.buttonGhostText}>Export JSON</Text>
                  </Pressable>
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={handleLoadBackupForUser}
                    disabled={adminLoading}
                  >
                    <Text style={styles.buttonGhostText}>Load to this device</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
          {adminSummary ? (
            <View style={styles.panelQuiet}>
              <Text style={styles.panelTitle}>Summary</Text>
              {adminSummary.encrypted ? (
                <Text style={styles.subtle}>
                  Encrypted backup. Provide the passphrase to load it on this device.
                </Text>
              ) : null}
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Identity Level</Text>
                <Text style={styles.statValue}>{adminSummary.identityLevel}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Total Effort</Text>
                <Text style={styles.statValue}>{adminSummary.totalEffort}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Habits</Text>
                <Text style={styles.statValue}>{adminSummary.habits}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Efforts</Text>
                <Text style={styles.statValue}>{adminSummary.efforts}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Chests</Text>
                <Text style={styles.statValue}>{adminSummary.chests}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Items</Text>
                <Text style={styles.statValue}>{adminSummary.items}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Payload (bytes)</Text>
                <Text style={styles.statValue}>{adminSummary.payloadBytes}</Text>
              </View>
              <Text style={styles.subtle}>
                Updated {new Date(adminSummary.updatedAt).toLocaleString()}
              </Text>
            </View>
          ) : null}
          <Pressable
            style={styles.buttonGhost}
            onPress={handleSaveBackup}
            disabled={adminBusy}
          >
            <Text style={styles.buttonGhostText}>Save current device backup</Text>
          </Pressable>
          <Pressable
            style={styles.buttonGhost}
            onPress={handleLoadBackup}
            disabled={adminBusy}
          >
            <Text style={styles.buttonGhostText}>Load my backup to this device</Text>
          </Pressable>
          {adminLog.length > 0 ? (
            <View style={styles.menuSection}>
              <Text style={styles.menuLabel}>Recent Actions</Text>
              {adminLog.map((entry, index) => (
                <Text key={`${entry.at}-${index}`} style={styles.subtle}>
                  {new Date(entry.at).toLocaleString()} - {entry.label}
                </Text>
              ))}
            </View>
          ) : null}
          {adminMessage ? <Text style={styles.subtle}>{adminMessage}</Text> : null}
        </View>
      ) : null}

      {showTasks ? (
        <View style={[styles.panel, styles.panelTight]}>
          <Text style={styles.panelTitle}>Habits</Text>
          {habits.length === 0 ? (
            <Text style={styles.subtle}>No habits yet. Create one below.</Text>
          ) : (
            habits.map((habit) => (
              <View key={habit.id} style={styles.habitRow}>
                <Pressable
                  style={[
                    styles.habitChip,
                    habitId === habit.id && styles.habitChipSelected,
                    !habit.isActive && styles.habitChipDisabled,
                  ]}
                  onPress={() => setHabitId(habit.id)}
                >
                  <View style={styles.habitLabelRow}>
                    <Text style={styles.habitText}>{habit.name}</Text>
                    <Text style={styles.habitEffort}>
                      {habitEfforts[habit.id]
                        ? `${habitEfforts[habit.id].effort}/10 (${Math.round(
                            habitEfforts[habit.id].prevalence
                          )}% of US adults do this)`
                        : ''}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.habitActions}>
                  <Pressable style={styles.habitToggle} onPress={() => handleToggleHabit(habit)}>
                    <Text style={styles.habitToggleText}>{habit.isActive ? 'Active' : 'Paused'}</Text>
                  </Pressable>
                  <Pressable style={styles.habitDelete} onPress={() => handleDeleteHabit(habit)}>
                    <Text style={styles.habitDeleteText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
          <View style={styles.menuDivider} />
          <Text style={styles.panelTitle}>Log Effort</Text>
          {selectedHabit ? (
            <>
              <Text style={styles.subtle}>
                Selected: {selectedHabit.name} {selectedHabit.isActive ? '' : '(paused)'}
              </Text>
              <Text style={styles.subtle}>
                Effort auto-calculated from US prevalence:
                {effortInfo ? ` ${effortInfo.effort}/10` : ' ...'}
              </Text>
              <Text style={styles.subtle}>
                This value is fixed by habit prevalence to keep effort consistent.
              </Text>
              <TextInput
                value={effortNote}
                onChangeText={setEffortNote}
                placeholder="Optional note..."
                placeholderTextColor="#4b5563"
                style={[styles.input, styles.noteInput]}
              />
              <Pressable
                style={[styles.button, !selectedHabit.isActive && styles.buttonDisabled]}
                onPress={() => handleLogEffort(selectedHabit.id, selectedHabit.name)}
                disabled={!selectedHabit.isActive}
              >
                <Text style={styles.buttonText}>Log effort</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.subtle}>Select a habit to log effort.</Text>
          )}
          <View style={styles.habitInputRow}>
            <TextInput
              value={newHabitName}
              onChangeText={setNewHabitName}
              placeholder="New habit name"
              placeholderTextColor="#4b5563"
              style={styles.input}
            />
            <Pressable style={styles.buttonSmall} onPress={handleCreateHabit}>
              <Text style={styles.buttonText}>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showInventory ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Chests</Text>
          {chests.length === 0 ? (
            <Text style={styles.subtle}>No chests yet. Log effort to earn one.</Text>
          ) : (
            <View style={styles.grid}>
              {chests.map((chest) => (
                <View key={chest.id} style={styles.gridCard}>
                  <Text style={styles.rarityTitle}>{chest.rarity.toUpperCase()}</Text>
                  <Text style={styles.gridSubtle}>{chest.rewardCount} rewards</Text>
                  <Text style={styles.gridSubtle}>{chest.lockedCount} locked</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {showChallenges ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Recent Efforts</Text>
          <View style={styles.filterRow}>
            <Pressable
              style={[styles.filterChip, effortFilter === 'all' && styles.filterChipSelected]}
              onPress={() => setEffortFilter('all')}
            >
              <Text style={styles.filterText}>All</Text>
            </Pressable>
            {habits.map((habit) => (
              <Pressable
                key={habit.id}
                style={[styles.filterChip, effortFilter === habit.id && styles.filterChipSelected]}
                onPress={() => setEffortFilter(habit.id)}
              >
                <Text style={styles.filterText}>{habit.name}</Text>
              </Pressable>
            ))}
          </View>
          {efforts.length === 0 ? (
            <Text style={styles.subtle}>No effort logged yet.</Text>
          ) : (
            efforts.map((effort) => (
              <View key={effort.id} style={styles.effortRowCompact}>
                <View>
                  <Text style={styles.effortTitle}>{effort.habitName}</Text>
                  <Text style={styles.effortMeta}>
                    {new Date(effort.timestamp).toLocaleDateString()} - {effort.effortValue} units
                  </Text>
                  {effort.note ? <Text style={styles.effortNote}>Note: {effort.note}</Text> : null}
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}

      {showInventory ? (
        <View style={styles.menuStack}>
          <View style={styles.menuHeader}>
            <Text style={styles.panelTitle}>Unlocks</Text>
            <Text style={styles.menuHint}>Combat unlocks rewards already earned.</Text>
          </View>
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Encounter</Text>
            {combatChest ? (
              <>
                <Text style={styles.subtle}>
                  {combatChest.rarity} chest - {combatChest.lockedCount} locked
                </Text>
                <View style={styles.combatRow}>
                  <Pressable style={styles.button} onPress={() => handleCombat('win')}>
                    <Text style={styles.buttonText}>Resolve: Win</Text>
                  </Pressable>
                  <Pressable style={styles.buttonGhost} onPress={() => handleCombat('lose')}>
                    <Text style={styles.buttonGhostText}>Resolve: Loss</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={styles.subtle}>No locked rewards to unlock.</Text>
            )}
            {combatMessage ? <Text style={styles.subtle}>{combatMessage}</Text> : null}
          </View>
          <View style={styles.menuDivider} />
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Inventory</Text>
            {unlockedItems.length === 0 ? (
              <Text style={styles.subtle}>Rewards remain locked until combat unlocks them.</Text>
            ) : (
              <View style={styles.grid}>
                {unlockedItems.map((item) => {
                  const details = JSON.parse(item.modifiersJson);
                  return (
                    <View key={item.id} style={styles.gridCard}>
                      <Text style={styles.gridTitle}>{item.type}</Text>
                      <Text style={styles.gridSubtle}>{details.tag}</Text>
                      <Text style={styles.gridSubtle}>{details.modifiers.join(' ')}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {showHelp && SHOW_TRUST_TESTS ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Trust Tests</Text>
          <Text style={styles.subtle}>Manual checklist (dev sanity):</Text>
          <View style={styles.trustList}>
            <Text style={styles.trustItem}>* Reopen after inactivity feels safe</Text>
            <Text style={styles.trustItem}>* Losing combat has zero downside</Text>
            <Text style={styles.trustItem}>* Consistency beats spikes</Text>
            <Text style={styles.trustItem}>* Power never appears without effort</Text>
            <Text style={styles.trustItem}>* Identity never decreases</Text>
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.appFrame}>
      <View style={styles.backgroundNebula} pointerEvents="none" />
      <View style={styles.backgroundRing} pointerEvents="none" />
      <Image
        source={require('../../assets/lifemaxxing-logo.png')}
        style={styles.backgroundLogo}
        accessibilityIgnoresInvertColors
      />
      {showOnboarding ? (
        <View style={styles.onboardingOverlay}>
          <View
            style={[
              styles.onboardingCard,
              onboardingStep === 'signup' && styles.onboardingCardSignup,
            ]}
          >
            <Image
              source={require('../../assets/lifemaxxing-logo.png')}
              style={styles.onboardingLogo}
              accessibilityLabel="Lifemaxxing logo"
            />
            {!EMAIL_AUTH_ENABLED ? (
              <>
                <Text style={styles.onboardingTitle}>Welcome to Lifemaxxing</Text>
                <Text style={styles.onboardingSubtle}>
                  Email sign-in is coming soon. Continue as guest for now.
                </Text>
                <View style={styles.loginPanel}>
                  <Pressable style={styles.button} onPress={handleContinueGuest}>
                    <Text style={styles.buttonText}>Skip for now</Text>
                  </Pressable>
                </View>
              </>
            ) : onboardingStep === 'login' ? (
              <>
                <Text style={styles.onboardingTitle}>Welcome to Lifemaxxing</Text>
                <Text style={styles.onboardingSubtle}>
                  Sign in to restore your identity or continue as guest.
                </Text>
                <View style={styles.loginPanel}>
                  <TextInput
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    placeholder="Email"
                    placeholderTextColor="#4b5563"
                    style={styles.input}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <TextInput
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                    placeholder="Password"
                    placeholderTextColor="#4b5563"
                    style={styles.input}
                    secureTextEntry
                  />
                  {turnstileEnabled ? (
                    <>
                      <TurnstileWidget
                        onToken={handleTurnstileToken}
                        onError={handleTurnstileError}
                      />
                      {turnstileStatus ? (
                        <Text style={styles.subtle}>{turnstileStatus}</Text>
                      ) : null}
                    </>
                  ) : null}
                  <Pressable
                    style={styles.button}
                    onPress={handleAccountSignIn}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonText}>Sign in</Text>
                  </Pressable>
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={() => setOnboardingStep('signup')}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonGhostText}>Create account</Text>
                  </Pressable>
                  <Pressable style={styles.buttonGhost} onPress={handleContinueGuest}>
                    <Text style={styles.buttonGhostText}>Skip for now</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.onboardingTitle}>Claim your identity</Text>
                <Text style={styles.onboardingSubtle}>
                  Create an account to back up your progress and return anytime.
                </Text>
                <View style={styles.onboardingBenefits}>
                  <Text style={styles.onboardingBenefitItem}>
                    - Save your identity and chests to the cloud
                  </Text>
                  <Text style={styles.onboardingBenefitItem}>
                    - Restore on any device
                  </Text>
                  <Text style={styles.onboardingBenefitItem}>
                    - Zero impact on effort rules
                  </Text>
                </View>
                <View style={styles.loginPanel}>
                  <TextInput
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    placeholder="Email"
                    placeholderTextColor="#4b5563"
                    style={styles.input}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <TextInput
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                    placeholder="Password"
                    placeholderTextColor="#4b5563"
                    style={styles.input}
                    secureTextEntry
                  />
                  {turnstileEnabled ? (
                    <>
                      <TurnstileWidget
                        onToken={handleTurnstileToken}
                        onError={handleTurnstileError}
                      />
                      {turnstileStatus ? (
                        <Text style={styles.subtle}>{turnstileStatus}</Text>
                      ) : null}
                    </>
                  ) : null}
                  <Pressable
                    style={styles.button}
                    onPress={handleAccountSignUp}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonText}>Sign up</Text>
                  </Pressable>
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={() => setOnboardingStep('login')}
                  >
                    <Text style={styles.buttonGhostText}>Back to sign in</Text>
                  </Pressable>
                </View>
              </>
            )}
            {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={styles.appFrameGlow} pointerEvents="none" />
      <View style={styles.topBar}>
        <Pressable
          style={styles.brandBox}
          onPress={() => setActiveTab('Tasks')}
        >
          <Image
            source={require('../../assets/lifemaxxing-logo.png')}
            style={styles.brandLogo}
            accessibilityLabel="Lifemaxxing logo"
          />
        </Pressable>
        <View style={styles.navRow}>
          {navTabs.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.navItem, activeTab === tab && styles.navItemActive]}
            >
              <Text style={[styles.navText, activeTab === tab && styles.navTextActive]}>
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.layout}>
        <View style={styles.sidePanel}>
          <Text style={styles.panelTitle}>Quest Log</Text>
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Daily Goal</Text>
            <Text style={styles.sideValue}>{activeHabits} Active Habits</Text>
            <Text style={styles.sideMeta}>Next action: log effort</Text>
          </View>
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Timer</Text>
            <Text style={styles.sideValue}>01:39:08</Text>
            <Text style={styles.sideMeta}>Placeholder countdown</Text>
          </View>
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Mercy</Text>
            <Text style={styles.sideValue}>
              {mercyStatus?.eligible ? 'Ready' : 'Cooldown'}
            </Text>
            <Text style={styles.sideMeta}>
              {mercyStatus && !mercyStatus.eligible
                ? `${mercyStatus.cooldownDaysRemaining} days remaining`
                : 'Boost next chest'}
            </Text>
          </View>
        </View>

      <View style={styles.centerPanel}>
        <View style={styles.centerRuneRing} pointerEvents="none" />
        <View style={styles.centerHeader}>
          <Text style={styles.centerTitle}>{activeTab.toUpperCase()}</Text>
            <View style={styles.centerTabs}>
              <View style={styles.centerTabActive}>
                <Text style={styles.centerTabText}>STATUS</Text>
              </View>
              <View style={styles.centerTab}>
                <Text style={styles.centerTabText}>QUESTS</Text>
              </View>
              <View style={styles.centerTab}>
                <Text style={styles.centerTabText}>SKILLS</Text>
              </View>
              <View style={styles.centerTab}>
                <Text style={styles.centerTabText}>EQUIP</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.centerScroll} contentContainerStyle={styles.centerScrollContent}>
            <View style={styles.contentColumn}>{mainContent}</View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
    backgroundColor: '#070914',
  },
  appFrameGlow: {
    position: 'absolute',
    top: -80,
    left: -60,
    right: -60,
    height: 240,
    backgroundColor: '#122757',
    opacity: 0.5,
  },
  backgroundNebula: {
    position: 'absolute',
    top: -140,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: '#2b1a5b',
    opacity: 0.35,
  },
  backgroundRing: {
    position: 'absolute',
    top: 120,
    left: -120,
    width: 420,
    height: 420,
    borderRadius: 220,
    borderWidth: 2,
    borderColor: '#1f4e8b',
    opacity: 0.35,
  },
  backgroundLogo: {
    position: 'absolute',
    right: -40,
    bottom: -30,
    width: 240,
    height: 240,
    opacity: 0.08,
    resizeMode: 'contain',
  },
  topBar: {
    height: TOP_BAR_HEIGHT,
    backgroundColor: '#0c1326',
    borderBottomWidth: 1,
    borderBottomColor: '#2b5aa2',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  brandBox: {
    width: BRAND_BOX_SIZE,
    height: BRAND_BOX_SIZE,
    borderRadius: 7,
    backgroundColor: '#0b1733',
    borderWidth: 1,
    borderColor: '#6fd0ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  brandIcon: {
    color: '#ffffff',
    fontSize: 12,
    letterSpacing: 1.6,
    fontWeight: '700',
  },
  brandLogo: {
    width: BRAND_LOGO_SIZE,
    height: BRAND_LOGO_SIZE,
    resizeMode: 'contain',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navItemActive: {
    backgroundColor: '#12315a',
    borderWidth: 1,
    borderColor: '#7bc7ff',
  },
  navText: {
    color: '#cfeaff',
    fontSize: FONT.sm,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  navTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    padding: 18,
    gap: 18,
  },
  sidePanel: {
    width: 240,
    backgroundColor: '#0c1732',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24508f',
    padding: 14,
  },
  sideBlock: {
    borderWidth: 1,
    borderColor: '#2b4e82',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#0f1d3b',
  },
  sideLabel: {
    color: '#8bd6ff',
    fontSize: FONT.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sideValue: {
    color: '#e9f4ff',
    fontSize: FONT.lg,
    fontWeight: '700',
    marginBottom: 4,
  },
  sideMeta: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
  },
  centerPanel: {
    flex: 1,
    backgroundColor: '#0d1832',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2c5aa0',
    overflow: 'hidden',
  },
  centerRuneRing: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 360,
    height: 360,
    borderRadius: 200,
    borderWidth: 1,
    borderColor: '#2a5aa6',
    opacity: 0.22,
  },
  centerHeader: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2a4f86',
    backgroundColor: '#0e1f3f',
  },
  centerTitle: {
    color: '#e2f1ff',
    fontSize: FONT.sm,
    letterSpacing: 4,
    fontWeight: '700',
    marginBottom: 10,
  },
  centerTabs: {
    flexDirection: 'row',
    gap: 10,
  },
  centerTab: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2f5ca3',
    backgroundColor: '#0c1b36',
  },
  centerTabActive: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7bc7ff',
    backgroundColor: '#143062',
  },
  centerTabText: {
    color: '#c7e2ff',
    fontSize: FONT.xs,
    letterSpacing: 1,
  },
  centerScroll: {
    flex: 1,
  },
  centerScrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 40,
    alignItems: 'center',
  },
  contentColumn: {
    width: '100%',
    maxWidth: 720,
  },
  questCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    padding: 14,
  },
  questTitle: {
    color: '#eaf4ff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  questList: {
    gap: 8,
  },
  questRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  questItem: {
    color: '#c7e2ff',
    fontSize: 12,
  },
  questCheck: {
    color: '#9fd0ff',
    fontSize: 14,
    fontWeight: '700',
  },
  questWarning: {
    color: '#9bb3d6',
    fontSize: 11,
    marginTop: 12,
  },
  container: {
    flexGrow: 1,
    paddingTop: 24,
    paddingHorizontal: 0,
    paddingBottom: 0,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05070f',
    padding: 24,
  },
  loadingPanel: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f3b66',
    backgroundColor: '#0b162d',
    shadowColor: '#6fb0ff',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  loadingLogo: {
    width: 120,
    height: 120,
    resizeMode: 'contain',
    marginBottom: 12,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c7e2ff',
    marginBottom: 8,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  loadingSubtle: {
    color: '#9bb3d6',
    fontSize: 13,
  },
  onboardingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(5, 7, 15, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  onboardingCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f3b66',
    backgroundColor: '#0b162d',
    shadowColor: '#6fb0ff',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  onboardingCardSignup: {
    borderColor: '#7bc7ff',
    backgroundColor: '#0b1a33',
  },
  onboardingLogo: {
    width: 96,
    height: 96,
    resizeMode: 'contain',
    alignSelf: 'center',
    marginBottom: 12,
  },
  onboardingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#eaf4ff',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  onboardingSubtle: {
    color: '#9bb3d6',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  onboardingBenefits: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f3b66',
    backgroundColor: '#0a152c',
    padding: 12,
    marginBottom: 12,
  },
  onboardingBenefitItem: {
    color: '#c7e2ff',
    fontSize: 12,
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c7e2ff',
    marginBottom: 12,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: '#0f1c3b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2c5aa0',
    shadowColor: '#6fd0ff',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  panelTight: {
    paddingVertical: 10,
  },
  panelQuiet: {
    backgroundColor: '#0f1a35',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2c5aa0',
    shadowColor: '#6fd0ff',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  menuStack: {
    backgroundColor: '#0f1c3b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2c5aa0',
    shadowColor: '#6fd0ff',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  menuHeader: {
    marginBottom: 12,
  },
  menuHint: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    marginTop: 4,
  },
  menuSection: {
    marginBottom: 12,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#2a4f86',
    marginVertical: 8,
  },
  menuLabel: {
    color: '#9fe1ff',
    fontSize: FONT.sm,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  panelTitle: {
    color: '#9fe1ff',
    fontSize: FONT.sm,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  subtle: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    marginTop: 6,
  },
  muted: {
    color: '#9bb3d6',
    fontSize: FONT.md,
  },
  button: {
    backgroundColor: '#1e63b8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#79d2ff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonQuiet: {
    backgroundColor: '#1b5fa7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#6fb0ff',
  },
  buttonSmall: {
    backgroundColor: '#1e63b8',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#79d2ff',
  },
  buttonText: {
    color: '#eaf4ff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  quietText: {
    color: '#cbd9f0',
    fontSize: 13,
    lineHeight: 20,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBox: {
    width: 76,
    height: 76,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2f5ca3',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1b36',
  },
  avatarText: {
    color: '#8bd6ff',
    fontSize: FONT.sm,
    letterSpacing: 1.4,
  },
  heroStats: {
    marginLeft: 16,
  },
  heroLabel: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroValue: {
    color: ACCENT_GOLD,
    fontSize: FONT.hero,
    fontWeight: '700',
    marginTop: 4,
  },
  heroSubtle: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1f3b66',
    marginVertical: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statLabel: {
    color: '#c7e2ff',
    fontSize: FONT.md,
    letterSpacing: 0.4,
  },
  statValue: {
    color: '#eaf4ff',
    fontSize: FONT.md,
    fontWeight: '700',
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  habitChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0b152a',
  },
  habitChipSelected: {
    borderColor: '#6fb0ff',
    backgroundColor: '#102244',
  },
  habitChipDisabled: {
    opacity: 0.5,
  },
  habitText: {
    color: '#eaf4ff',
    fontSize: 15,
  },
  habitLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  habitEffort: {
    color: '#9fd0ff',
    fontSize: 12,
    fontWeight: '700',
  },
  habitActions: {
    marginLeft: 10,
    alignItems: 'flex-end',
    gap: 8,
  },
  habitToggle: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#11203b',
    borderWidth: 1,
    borderColor: '#2b4a78',
  },
  habitToggleText: {
    color: '#c7e2ff',
    fontSize: 12,
  },
  habitDelete: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#1a0f1f',
    borderWidth: 1,
    borderColor: '#7a2c3b',
  },
  habitDeleteText: {
    color: '#f2b8c6',
    fontSize: 11,
    fontWeight: '700',
  },
  habitInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eaf4ff',
    marginRight: 10,
    backgroundColor: '#0a152c',
  },
  loginPanel: {
    marginTop: 12,
    gap: 10,
  },
  effortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  effortPresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  effortPreset: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  effortPresetActive: {
    borderColor: '#79d2ff',
    backgroundColor: '#12315a',
  },
  effortChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#0a152c',
  },
  effortChipSelected: {
    borderColor: '#6fb0ff',
    backgroundColor: '#102244',
  },
  effortText: {
    color: '#eaf4ff',
    fontSize: 16,
    fontWeight: '700',
  },
  noteInput: {
    marginBottom: 8,
  },
  combatRow: {
    marginTop: 12,
  },
  buttonGhost: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6fb0ff',
  },
  buttonGhostText: {
    color: '#c7e2ff',
    fontWeight: '700',
    fontSize: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: '47%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    padding: 12,
  },
  gridTitle: {
    color: '#eaf4ff',
    fontSize: FONT.md,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  rarityTitle: {
    color: ACCENT_GOLD,
    fontSize: FONT.md,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  gridSubtle: {
    color: '#9bb3d6',
    fontSize: 12,
    marginBottom: 4,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  filterChipSelected: {
    borderColor: '#6fb0ff',
    backgroundColor: '#102244',
  },
  filterChipDisabled: {
    opacity: 0.5,
  },
  filterText: {
    color: '#c7e2ff',
    fontSize: 12,
  },
  effortRowCompact: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1f3b66',
  },
  effortTitle: {
    color: '#eaf4ff',
    fontSize: 14,
    fontWeight: '700',
  },
  effortMeta: {
    color: '#9bb3d6',
    fontSize: 12,
    marginTop: 2,
  },
  effortNote: {
    color: '#c7e2ff',
    fontSize: 12,
    marginTop: 4,
  },
  trustList: {
    marginTop: 8,
  },
  trustItem: {
    color: '#c7e2ff',
    fontSize: 12,
    marginBottom: 6,
  },
  adminRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0a152c',
  },
  adminRowSelected: {
    borderColor: '#6fb0ff',
    backgroundColor: '#102244',
  },
  adminRowTitle: {
    color: '#eaf4ff',
    fontSize: 12,
    fontWeight: '700',
  },
  turnstileContainer: {
    alignSelf: 'stretch',
    minHeight: 70,
    marginTop: 8,
    marginBottom: 4,
  },
});
