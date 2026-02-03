import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  Image,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TURNSTILE_SITE_KEY, TURNSTILE_VERIFY_URL, PHASE2_ENABLED } from '../config';
import { supabase, getIsAdmin } from '../services/supabase';
import RitualOverlay from '../components/RitualOverlay';
import SlideOverFullScreen from '../components/SlideOverFullScreen';
import HabitSpaceOverlay from '../components/HabitSpaceOverlay';
import {
  signInWithPassword,
  signUpWithPassword,
  signOut,
  saveBackupPayload,
  listBackups,
  listBackupHistory,
  upsertUserProfile,
  listUserProfiles,
  listBackupSummaries,
  listSystemEvents,
  listAdminAudit,
  logSystemEvent,
  logAdminAction,
  deleteUserBackup,
  deleteUserBackupHistory,
  deleteUserSummary,
  deleteUserProfile,
  deleteUserSystemEvents,
  fetchBackupForUserId,
  fetchBackupPayload,
} from '../services/backup';
import {
  createHabit,
  createRitualOpening,
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
  listCards,
  listArcQuestStatus,
  getEvidenceSummary,
  listRecentEfforts,
  countHabitActionsToday,
  exportAllData,
  importAllData,
  touchLastActive,
  logEffort,
  completeRitualOpening,
  setHabitActive,
  deleteHabit,
  acceptArcQuest,
  ignoreArcQuest,
  bindArcQuestToHabit,
  markOrientationComplete,
  adminSpawnChest,
  adminOpenChest,
  adminUnlockAllChestRewards,
  adminGrantCard,
  adminGrantExp,
  adminForceLevelUp,
  adminResetLevel,
  adminCompleteQuest,
  adminResetQuestProgress,
  adminSimulateMissedDays,
  adminResetToday,
  getEquippedCardId,
} from '../db/db';
import { SEASON_MANIFEST } from '../data/seasonManifest';
import {
  HabitIcon,
  getHabitActionConfig,
  getHabitSpec,
  getHabitTypeFromName,
} from '../utils/getHabitActionConfig';

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
const BACKUP_HISTORY_KEY = 'lifemaxing.backupHistory.v1';
const EXP_UNITS_PER_LEVEL = 10;
const EXP_NOTES_KEY = 'lifemaxing.expNotesEnabled.v1';
const HABIT_NOTES_KEY = 'lifemaxing.habitNotes.v1';
const RARITY_COLORS = {
  common: '#7aa2d6',
  uncommon: '#6fd0ff',
  rare: '#f6c46a',
  epic: '#d3a6ff',
  relic: '#ffd36a',
};


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

function canUseWebStorage() {
  return typeof window !== 'undefined' && window.localStorage;
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
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitId, setHabitId] = useState(null);
  const [inactivityDays, setInactivityDays] = useState(0);
  const [newHabitName, setNewHabitName] = useState('');
  const [chests, setChests] = useState([]);
  const [items, setItems] = useState([]);
  const [cards, setCards] = useState([]);
  const [efforts, setEfforts] = useState([]);
  const [effortFilter, setEffortFilter] = useState('all');
  const [habitNotes, setHabitNotes] = useState({});
  const [expNotesEnabled, setExpNotesEnabled] = useState(false);
  const [expNoteMessage, setExpNoteMessage] = useState('');
  const [habitActionCounts, setHabitActionCounts] = useState({});
  const [evidence, setEvidence] = useState(null);
  const [ritualChest, setRitualChest] = useState(null);
  const [ritualMessage, setRitualMessage] = useState('');
  const [mercyStatus, setMercyStatus] = useState(null);
  const [accountMessage, setAccountMessage] = useState('');
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('unknown');
  const [authEmail, setAuthEmail] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState('login');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminBackups, setAdminBackups] = useState([]);
  const [adminFilter, setAdminFilter] = useState('');
  const [adminSelectedUserId, setAdminSelectedUserId] = useState('');
  const [adminSummary, setAdminSummary] = useState(null);
  const [adminHistory, setAdminHistory] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminUserIdSearch, setAdminUserIdSearch] = useState('');
  const [adminSummaries, setAdminSummaries] = useState([]);
  const [adminEvents, setAdminEvents] = useState([]);
  const [adminAudit, setAdminAudit] = useState([]);
  const [adminUserLimit, setAdminUserLimit] = useState(50);
  const [adminSummaryLimit, setAdminSummaryLimit] = useState(50);
  const [adminEventsLimit, setAdminEventsLimit] = useState(25);
  const [adminAuditLimit, setAdminAuditLimit] = useState(25);
  const [adminUserPage, setAdminUserPage] = useState(0);
  const [adminEventsPage, setAdminEventsPage] = useState(0);
  const [adminAuditPage, setAdminAuditPage] = useState(0);
  const [adminDateFrom, setAdminDateFrom] = useState('');
  const [adminDateTo, setAdminDateTo] = useState('');
  const [helpTab, setHelpTab] = useState('Account');
  const [backupPreview, setBackupPreview] = useState(null);
  const [backupPreviewPayload, setBackupPreviewPayload] = useState(null);
  const [backupConflict, setBackupConflict] = useState(null);
  const [backupHistory, setBackupHistory] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminLog, setAdminLog] = useState([]);
  const [arcQuests, setArcQuests] = useState([]);
  const [arcOverlay, setArcOverlay] = useState(null);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Tasks');
  const [rlsMessage, setRlsMessage] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
const [turnstileToken, setTurnstileToken] = useState('');
const [turnstileMessage, setTurnstileMessage] = useState('');
  const [orientationAccepted, setOrientationAccepted] = useState(false);
  const [orientationIgnored, setOrientationIgnored] = useState(false);
  const [orientationMessage, setOrientationMessage] = useState('');
  const [adminPaletteOpen, setAdminPaletteOpen] = useState(false);
  const [adminPaletteQuery, setAdminPaletteQuery] = useState('');
  const [adminPaletteSelection, setAdminPaletteSelection] = useState(null);
  const [adminPaletteMessage, setAdminPaletteMessage] = useState('');
  const [adminPaletteBusy, setAdminPaletteBusy] = useState(false);
  const [adminPaletteParams, setAdminPaletteParams] = useState({});
  const [habitSpaceOpen, setHabitSpaceOpen] = useState(false);
  const [habitSpaceHabitId, setHabitSpaceHabitId] = useState(null);
  const [adminSeasonLocks, setAdminSeasonLocks] = useState({});
  const [adminRevealedCards, setAdminRevealedCards] = useState({});
  const [adminPhaseOverride, setAdminPhaseOverride] = useState(null);
  const [equippedCardId, setEquippedCardId] = useState(null);
  const [selectedChallengeHabitId, setSelectedChallengeHabitId] = useState(null);
  const [gallerySelection, setGallerySelection] = useState(null);
  const [habitDetailId, setHabitDetailId] = useState(null);
  const [showAllArcQuests, setShowAllArcQuests] = useState(false);
  const [chestNotice, setChestNotice] = useState(null);
  const [ritualOverlayOpen, setRitualOverlayOpen] = useState(false);
  const [ritualOverlayChest, setRitualOverlayChest] = useState(null);
  const [ritualOverlayRewards, setRitualOverlayRewards] = useState([]);
  const [mercyInfoOpen, setMercyInfoOpen] = useState(false);
  const [tasksStatusOpen, setTasksStatusOpen] = useState(false);
  const [tasksEvidenceOpen, setTasksEvidenceOpen] = useState(false);
  const [tasksOrientationOpen, setTasksOrientationOpen] = useState(false);
  const [tasksArcOpen, setTasksArcOpen] = useState(false);
  const phase2Active = adminPhaseOverride === null ? PHASE2_ENABLED : adminPhaseOverride === 'on';
  const BASE_TABS = useMemo(
    () => [
      'Tasks',
      'Inventory',
      ...(phase2Active ? ['Gallery'] : []),
      'Shops',
      'Party',
      'Group',
      'Quests',
      'Help',
    ],
    [phase2Active]
  );

  const newHabitInputRef = useRef(null);
  const expAnim = useRef(new Animated.Value(0));
  const expNoteTimeoutRef = useRef(null);
  const lastEffortTotalRef = useRef(0);

  // Task sub-tabs removed to keep navigation singular (global tabs only).

  const authEnabled = !!supabase;
  const adminAvailable = isAdmin === true;
  const navTabs = BASE_TABS;
  const HELP_TABS = ['Account', 'Backups', 'Local', 'Onboarding', 'Trust'];

  async function refresh() {
    const snap = await getStatusSnapshot();
    const days = await getInactivityDays();
    const mercy = await getMercyStatus(days);
    const rawHabits = await listHabits();
    const habitList = rawHabits.map(normalizeHabitForUI);
    const chestList = await listChests(5);
      const itemList = await listItems(20);
      const cardList = await listCards(phase2Active ? 200 : 20);
      const effortList = await listRecentEfforts({
        limit: 60,
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
      setCards(cardList);
      setEfforts(effortList);
      setEvidence(evidenceSummary);
      setRitualChest(latestChest);
      const currentEquipped = await getEquippedCardId();
      setEquippedCardId(currentEquipped);
      await refreshArcQuests();
      if (!habitId && habitList.length > 0) {
        const active = habitList.find((habit) => habit.isActive);
        setHabitId(active ? active.id : habitList[0].id);
      }
      await refreshHabitActionCounts(habitList);
    }

  async function refreshHabitActionCounts(habitList) {
    const totals = Object.fromEntries(habitList.map((habit) => [habit.id, 0]));
    if (habitList.length === 0) {
      setHabitActionCounts(totals);
      return;
    }
    const entries = await Promise.all(
      habitList.map(async (habit) => {
        const config = getHabitActionConfig(habit);
        const actionType = config.actionType || 'custom';
        const total = await countHabitActionsToday({ habitId: habit.id, actionType });
        return [habit.id, total];
      })
    );
    for (const [habitId, total] of entries) {
      totals[habitId] = total;
    }
    setHabitActionCounts(totals);
  }

  async function refreshArcQuests() {
    try {
      const arcQuestList = await listArcQuestStatus();
      setArcQuests(arcQuestList);
    } catch (error) {
      console.error('Failed to refresh arc quests', error);
    }
  }

  async function handleAcceptArc(arcId) {
    try {
      await acceptArcQuest(arcId);
      await refreshArcQuests();
    } catch (error) {
      console.error('Failed to accept arc quest', error);
    }
  }

  async function handleAcceptArcForHabit(arcId, habitId) {
    if (!habitId) return;
    try {
      await bindArcQuestToHabit(arcId, habitId);
      await refreshArcQuests();
    } catch (error) {
      console.error('Failed to bind arc quest to habit', error);
    }
  }

  async function handleIgnoreArc(arcId) {
    try {
      await ignoreArcQuest(arcId);
      await refreshArcQuests();
    } catch (error) {
      console.error('Failed to ignore arc quest', error);
    }
  }

  async function handleCycleArcHabit(arc) {
    if (habits.length === 0) return;
    try {
      const nextIndex = habits.findIndex((habit) => habit.id === arc.habitId) + 1;
      const targetIndex = nextIndex < habits.length ? nextIndex : -1;
      const nextHabitId = targetIndex === -1 ? null : habits[targetIndex].id;
      await bindArcQuestToHabit(arc.id, nextHabitId);
      await refreshArcQuests();
    } catch (error) {
      console.error('Failed to bind arc quest', error);
    }
  }

  async function refreshAuthStatus() {
    if (!authEnabled || !EMAIL_AUTH_ENABLED) {
      setAuthStatus('disabled');
      setAuthEmail('');
      setLastBackupAt(null);
      await refreshBackupHistory();
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
      setLastBackupAt(null);
      await refreshBackupHistory();
      if (Platform.OS === 'web' && !onboardingDismissed) {
        setShowOnboarding(true);
        setOnboardingStep('login');
      }
      return;
    }
    const sessionEmail = data.session.user?.email || '';
    setAuthStatus('signed_in');
    setAuthEmail(sessionEmail);
    try {
      await upsertUserProfile({ email: sessionEmail });
    } catch (error) {
      // Ignore profile sync errors.
    }
    await refreshBackupHistory();
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
      await refreshBackupHistory();
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
        const normalizedTab = stored === 'Challenges' ? 'Quests' : stored;
        if (BASE_TABS.includes(normalizedTab)) {
          setActiveTab(normalizedTab);
        }
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
    let alive = true;
    async function restoreExpNotes() {
      if (Platform.OS === 'web') {
        try {
          const stored = window.localStorage.getItem(EXP_NOTES_KEY);
          if (!alive || stored === null) return;
          setExpNotesEnabled(stored === 'true');
          return;
        } catch (error) {
          return;
        }
      }
      try {
        const stored = await AsyncStorage.getItem(EXP_NOTES_KEY);
        if (!alive || stored === null) return;
        setExpNotesEnabled(stored === 'true');
      } catch (error) {
        // Ignore storage errors.
      }
    }
    restoreExpNotes();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function restoreHabitNotes() {
      if (Platform.OS === 'web') {
        try {
          const stored = window.localStorage.getItem(HABIT_NOTES_KEY);
          if (!alive || !stored) return;
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            setHabitNotes(parsed);
          }
          return;
        } catch (error) {
          return;
        }
      }
      try {
        const stored = await AsyncStorage.getItem(HABIT_NOTES_KEY);
        if (!alive || !stored) return;
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          setHabitNotes(parsed);
        }
      } catch (error) {
        // Ignore storage errors.
      }
    }
    restoreHabitNotes();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      window.localStorage.setItem('lifemaxing.activeTab', activeTab);
    } catch (error) {
      // Ignore storage errors.
    }
  }, [activeTab]);

  useEffect(() => () => {
    if (expNoteTimeoutRef.current) {
      clearTimeout(expNoteTimeoutRef.current);
      expNoteTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => {
    let mounted = true;

    async function checkAdmin() {
      const ok = await getIsAdmin();
      if (mounted) setIsAdmin(ok);
    }

    checkAdmin();

    const { data: sub } =
      supabase?.auth.onAuthStateChange(() => {
        checkAdmin();
      }) || {};

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const totalEffortUnits = snapshot?.identity?.totalEffortUnits || 0;
  const expProgress =
    EXP_UNITS_PER_LEVEL > 0 ? (totalEffortUnits % EXP_UNITS_PER_LEVEL) / EXP_UNITS_PER_LEVEL : 0;

  useEffect(() => {
    const duration = phase2Active ? 600 : 2000;
    Animated.timing(expAnim.current, {
      toValue: expProgress,
      duration,
      useNativeDriver: false,
    }).start();
  }, [expProgress]);

  useEffect(() => {
    if (!phase2Active || !expNotesEnabled) {
      lastEffortTotalRef.current = totalEffortUnits;
      return;
    }
    const prevTotal = lastEffortTotalRef.current;
    if (totalEffortUnits > prevTotal) {
      setExpNoteMessage('Progress noted');
      if (expNoteTimeoutRef.current) {
        clearTimeout(expNoteTimeoutRef.current);
      }
      expNoteTimeoutRef.current = setTimeout(() => {
        setExpNoteMessage('');
        expNoteTimeoutRef.current = null;
      }, 2000);
    }
    lastEffortTotalRef.current = totalEffortUnits;
  }, [totalEffortUnits, expNotesEnabled]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(EXP_NOTES_KEY, expNotesEnabled ? 'true' : 'false');
        return;
      } catch (error) {
        // Ignore storage errors.
      }
    }
    AsyncStorage.setItem(EXP_NOTES_KEY, expNotesEnabled ? 'true' : 'false').catch(() => {});
  }, [expNotesEnabled]);

  useEffect(() => {
    const payload = JSON.stringify(habitNotes || {});
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(HABIT_NOTES_KEY, payload);
        return;
      } catch (error) {
        // Ignore storage errors.
      }
    }
    AsyncStorage.setItem(HABIT_NOTES_KEY, payload).catch(() => {});
  }, [habitNotes]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !adminAvailable) return;
    function handleKeyDown(event) {
      const key = event.key?.toLowerCase?.() || '';
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'a') {
        event.preventDefault();
        setAdminPaletteOpen(true);
      }
      if (key === 'escape') {
        setAdminPaletteOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [adminAvailable]);

  useEffect(() => {
    if (adminAvailable || !adminPaletteOpen) return;
    setAdminPaletteOpen(false);
    setAdminPaletteQuery('');
    setAdminPaletteSelection(null);
    setAdminPaletteMessage('');
    setAdminPaletteParams({});
  }, [adminAvailable, adminPaletteOpen]);

  const selectedHabit = useMemo(
    () => habits.find((habit) => habit.id === habitId) || null,
    [habits, habitId]
  );

  const habitById = useMemo(
    () => new Map(habits.map((habit) => [habit.id, habit])),
    [habits]
  );
  useEffect(() => {
    if (habitSpaceHabitId && !habitById.has(habitSpaceHabitId)) {
      closeHabitSpace();
    }
  }, [habitSpaceHabitId, habitById]);
  const galleryCardStats = useMemo(() => {
    const counts = new Map();
    const latest = new Map();
    cards.forEach((card) => {
      const key = card.cardKey;
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
      const current = latest.get(key);
      if (!current || new Date(card.earnedAt) > new Date(current.earnedAt)) {
        latest.set(key, card);
      }
    });
    return { counts, latest };
  }, [cards]);

  const challengeHabit = useMemo(() => {
    if (!habits.length) return null;
    if (selectedChallengeHabitId) {
      return habitById.get(selectedChallengeHabitId) || habits[0];
    }
    return habits[0];
  }, [habits, habitById, selectedChallengeHabitId]);
  const challengeArcInfo = useMemo(() => findArcQuestForHabit(challengeHabit), [
    arcQuests,
    challengeHabit,
  ]);
  const challengeArcQuest = challengeArcInfo?.quest || null;
  const challengeArcAccepted = challengeArcInfo?.accepted ?? false;
  const challengeSpec = useMemo(
    () => (challengeHabit ? getHabitSpec(challengeHabit) : null),
    [challengeHabit]
  );
  const latestChallengeEffort = useMemo(
    () => (challengeHabit ? getLatestEffortForHabit(challengeHabit.id) : null),
    [challengeHabit, efforts]
  );

  const orientationIdentity = snapshot?.identity;
  const shouldShowOrientation = Boolean(
    orientationIdentity &&
      (orientationIdentity.totalEffortUnits || 0) === 0 &&
      !orientationIdentity.orientationCompleted &&
      !orientationIgnored
  );
  useEffect(() => {
    if (shouldShowOrientation) {
      setOrientationMessage('');
    } else {
      setOrientationAccepted(false);
      setOrientationIgnored(false);
    }
  }, [shouldShowOrientation]);

  useEffect(() => {
    refresh();
  }, [effortFilter]);

  useEffect(() => {
    if (habits.length === 0) {
      setSelectedChallengeHabitId(null);
      return;
    }
    setSelectedChallengeHabitId((prev) => {
      if (prev && habits.some((habit) => habit.id === prev)) {
        return prev;
      }
      const active = habits.find((habit) => habit.isActive);
      return active ? active.id : habits[0].id;
    });
  }, [habits]);



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

  function ensureTurnstileReady() {
    if (!turnstileEnabled) return true;
    if (turnstileToken) return true;
    setTurnstileMessage('Complete the Turnstile check to continue.');
    return false;
  }

  async function verifyTurnstileToken(action) {
    // Server-side verification is required to prevent bypass of client-only checks.
    if (!turnstileEnabled) return { ok: true };
    if (!TURNSTILE_VERIFY_URL) {
      return { ok: false, message: 'Turnstile verification endpoint is not configured.' };
    }
    if (!turnstileToken) {
      return { ok: false, message: 'Complete the Turnstile check to continue.' };
    }
    try {
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: turnstileToken, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        return {
          ok: false,
          message: data.error || 'Turnstile verification failed. Try again.',
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: 'Turnstile verification failed. Try again.' };
    }
  }
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

  function summarizeBackupPayload(payload, updatedAt) {
    let payloadBytes = 0;
    try {
      payloadBytes = JSON.stringify(payload).length;
    } catch (error) {
      payloadBytes = 0;
    }
    const meta = payload && typeof payload === 'object' ? payload.meta || null : null;
    if (!payload || typeof payload !== 'object') {
      return {
        updatedAt,
        identityLevel: 0,
        totalEffort: 0,
        habits: 0,
        efforts: 0,
        chests: 0,
        items: 0,
        cards: 0,
        payloadBytes,
        encrypted: false,
        meta,
      };
    }
    return {
      updatedAt,
      identityLevel: payload.identity?.level || 0,
      totalEffort: payload.identity?.totalEffortUnits || 0,
      habits: payload.habits?.length || 0,
      efforts: payload.effortLogs?.length || 0,
      chests: payload.chests?.length || 0,
      items: payload.items?.length || 0,
      cards: payload.cards?.length || 0,
      payloadBytes,
      encrypted: false,
      meta,
    };
  }

  function buildBackupSummary(payload, payloadBytes = 0) {
    const meta = payload?.meta || null;
    return {
      identityLevel: payload?.identity?.level || 0,
      totalEffort: payload?.identity?.totalEffortUnits || 0,
      habits: payload?.habits?.length || 0,
      efforts: payload?.effortLogs?.length || 0,
      chests: payload?.chests?.length || 0,
      items: payload?.items?.length || 0,
      cards: payload?.cards?.length || 0,
      lastActiveAt: payload?.identity?.lastActiveAt || null,
      payloadBytes,
      deviceId: meta?.deviceId || null,
      appVersion: meta?.appVersion || null,
    };
  }

  function normalizeBackupHistory(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry) => entry && entry.updatedAt)
      .map((entry) => ({
        updatedAt: entry.updatedAt,
        deviceId: entry.deviceId || null,
        appVersion: entry.appVersion || null,
      }))
      .slice(0, 5);
  }

  function mergeBackupHistory(remoteList, localList) {
    const combined = [...(remoteList || []), ...(localList || [])];
    const normalized = normalizeBackupHistory(combined);
    return normalized.filter(
      (item, index, list) =>
        index === list.findIndex((existing) => existing.updatedAt === item.updatedAt)
    );
  }

  async function loadBackupHistory() {
    try {
      if (Platform.OS === 'web') {
        if (!canUseWebStorage()) return [];
        const raw = window.localStorage.getItem(BACKUP_HISTORY_KEY);
        if (!raw) return [];
        return normalizeBackupHistory(JSON.parse(raw));
      }
      const raw = await AsyncStorage.getItem(BACKUP_HISTORY_KEY);
      if (!raw) return [];
      return normalizeBackupHistory(JSON.parse(raw));
    } catch (error) {
      return [];
    }
  }

  async function persistBackupHistory(next) {
    const normalized = normalizeBackupHistory(next);
    try {
      if (Platform.OS === 'web') {
        if (!canUseWebStorage()) return;
        window.localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(normalized));
        return;
      }
      await AsyncStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(normalized));
    } catch (error) {
      // Ignore storage errors.
    }
  }

  async function appendBackupHistory(entry) {
    if (!entry?.updatedAt) return;
    const next = [entry, ...backupHistory].filter(
      (item, index, list) =>
        index === list.findIndex((existing) => existing.updatedAt === item.updatedAt)
    );
    setBackupHistory(next.slice(0, 5));
    await persistBackupHistory(next);
  }

  async function refreshBackupHistory() {
    const local = await loadBackupHistory();
    if (authStatus !== 'signed_in') {
      setBackupHistory(local);
      return;
    }
    try {
      const remote = await listBackupHistory({ limit: 5 });
      const normalizedRemote = (remote || []).map((entry) => ({
        updatedAt: entry.updated_at,
        deviceId: entry.device_id || entry.payload_meta?.deviceId || null,
        appVersion: entry.app_version || entry.payload_meta?.appVersion || null,
      }));
      const merged = mergeBackupHistory(normalizedRemote, local);
      setBackupHistory(merged);
      await persistBackupHistory(merged);
    } catch (error) {
      setBackupHistory(local);
    }
  }

  function parseTimestamp(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function getLocalLatestActivity() {
    const candidates = [
      parseTimestamp(identity?.lastActiveAt),
      parseTimestamp(evidence?.lastEffortAt),
      parseTimestamp(evidence?.lastChestAt),
    ].filter(Boolean);
    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates.map((date) => date.getTime())));
  }

  function handleAcceptOrientation() {
    setOrientationAccepted(true);
    setOrientationIgnored(false);
  }

  function handleIgnoreOrientation() {
    setOrientationIgnored(true);
    setOrientationAccepted(false);
  }

  async function handleLogEffort({
    habitId: overrideHabitId,
    note: overrideNote = null,
    actionType: overrideActionType,
    units: overrideUnits,
  } = {}) {
    const targetHabitId = overrideHabitId || habitId;
    if (!targetHabitId) return;
    const targetHabit = habitById.get(targetHabitId) || selectedHabit;
    if (!targetHabit || !targetHabit.isActive) {
      return;
    }
    const actionConfig = getHabitActionConfig(targetHabit);
    const habitSpec = getHabitSpec(targetHabit);
    const resolvedActionType = overrideActionType || actionConfig.actionType || 'custom';
    const resolvedUnits = overrideUnits ?? actionConfig.units ?? 1;
    const noteSource =
      overrideNote !== null && overrideNote !== undefined ? overrideNote : null;
    const cleanedNote = noteSource?.trim ? noteSource.trim() : '';
    const optimisticTimestamp = new Date().toISOString();
    setHabitActionCounts((prev) => ({
      ...prev,
      [targetHabitId]: (prev[targetHabitId] || 0) + resolvedUnits,
    }));
    setEfforts((prev) =>
      [
        {
          id: `optimistic_${optimisticTimestamp}`,
          habitId: targetHabitId,
          timestamp: optimisticTimestamp,
          label: habitSpec?.actions?.[0]?.label || 'Effort',
          actionType: resolvedActionType,
          units: resolvedUnits,
        },
        ...prev,
      ].slice(0, 60)
    );
    const result = await logEffort({
      habitId: targetHabitId,
      note: cleanedNote.length ? cleanedNote : null,
      actionType: resolvedActionType,
      units: resolvedUnits,
    });
    if (shouldShowOrientation) {
      await markOrientationComplete();
      setOrientationMessage("You logged an action. That's all this system ever asks.");
    }
    await refresh();
    if (result?.arcUnlocks?.length) {
      setArcOverlay(result.arcUnlocks[0]);
    }
    setChestNotice({ chestId: result?.chestId || null, at: Date.now() });
    if (authStatus === 'signed_in') {
      try {
        const payload = await exportAllData();
        const payloadBytes = JSON.stringify(payload).length;
        const summary = buildBackupSummary(payload, payloadBytes);
        const encryptedPayload = await encryptIfNeeded(payload);
        const record = await saveBackupPayload(encryptedPayload, summary);
        setLastBackupAt(record.updated_at);
        await appendBackupHistory({
          updatedAt: record.updated_at,
          deviceId: payload.meta?.deviceId || null,
          appVersion: payload.meta?.appVersion || null,
        });
      } catch (error) {
        setAccountMessage(error?.message || 'Auto-backup failed.');
        try {
          await logSystemEvent({
            type: 'backup_error',
            message: error?.message || 'Auto-backup failed.',
            context: { source: 'auto' },
          });
        } catch (logError) {
          // Ignore logging errors.
        }
      }
    }
  }

  async function handleHabitAction(habit, action = null) {
    if (!habit || !habit.isActive) return;
    const config = getHabitActionConfig(habit);
    const spec = getHabitSpec(habit);
    const resolvedAction = action || spec.actions?.[0];
    const resolvedUnits =
      resolvedAction && resolvedAction.type === 'increment'
        ? resolvedAction.amount || 1
        : config.units || 1;
    await handleLogEffort({
      habitId: habit.id,
      actionType: config.actionType,
      units: resolvedUnits,
    });
  }

  async function handleRitualOpen(outcome) {
    if (!ritualChest) return;
    const opening = await createRitualOpening(ritualChest.id);
    if (!opening) return;
    const result = await completeRitualOpening({
      openingId: opening.id,
      chestId: ritualChest.id,
    });
    if (outcome === 'win') {
      setRitualMessage('Chest opened.');
    } else {
      setRitualMessage('Chest closed. Rewards remain.');
    }
    await refresh();
  }

  async function handleOpenChest() {
    // Ritual-only chest opening. No outcomes.
    await handleRitualOpen('win');
  }

  async function handleOpenRitual(chestId) {
    if (!chestId) return;
    try {
      await adminUnlockAllChestRewards({ chestId });
      const chest = await adminOpenChest({ chestId });
      setRitualOverlayChest(chest);
      setRitualOverlayRewards(chest?.rewards || []);
      setRitualOverlayOpen(true);
    } catch (error) {
      setRitualMessage(error?.message || 'Unable to open ritual.');
    }
  }

  async function openLatestChest() {
    if (!ritualChest?.id) return;
    await adminUnlockAllChestRewards({
      chestId: ritualChest.id,
    });
    const result = await adminOpenChest({
      chestId: ritualChest.id,
    });
    setRitualOverlayChest(result || ritualChest);
    setRitualOverlayRewards(result?.rewards || []);
    setRitualOverlayOpen(true);
  }

  async function handleAccountSignIn() {
    if (!authEnabled || !EMAIL_AUTH_ENABLED) {
      setAccountMessage('Account linking is not enabled.');
      return;
    }
    if (!ensureTurnstileReady()) {
      return;
    }
    setTurnstileMessage('');
    const verification = await verifyTurnstileToken('signin');
    if (!verification.ok) {
      setTurnstileMessage(verification.message);
      return;
    }
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
      setBackupPreview(null);
      setBackupPreviewPayload(null);
      setBackupConflict(null);
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
      const payloadBytes = JSON.stringify(payload).length;
      const summary = buildBackupSummary(payload, payloadBytes);
      const encryptedPayload = await encryptIfNeeded(payload);
      const record = await saveBackupPayload(encryptedPayload, summary);
      setLastBackupAt(record.updated_at);
      await appendBackupHistory({
        updatedAt: record.updated_at,
        deviceId: payload.meta?.deviceId || null,
        appVersion: payload.meta?.appVersion || null,
      });
      const message = `Backup saved (${new Date(record.updated_at).toLocaleString()}).${
        isEncryptedPayload(encryptedPayload) ? ' Encrypted.' : ''
      }`;
      setAccountMessage(message);
      setAdminMessage(message);
      setAdminLog((prev) => [
        { label: 'Saved backup (self)', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      try {
        await logSystemEvent({
          type: 'backup_saved',
          message,
          context: { source: 'manual' },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      const message = error?.message || 'Backup failed.';
      setAccountMessage(message);
      setAdminMessage(message);
      try {
        await logSystemEvent({
          type: 'backup_error',
          message,
          context: { source: 'manual' },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
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
      setBackupPreview(summarizeBackupPayload(decrypted, record.updated_at));
      setBackupPreviewPayload(decrypted);
      const localLatest = getLocalLatestActivity();
      const remoteUpdatedAt = parseTimestamp(record.updated_at);
      if (localLatest && remoteUpdatedAt && localLatest > remoteUpdatedAt) {
        setBackupConflict({
          localUpdatedAt: localLatest.toISOString(),
          remoteUpdatedAt: record.updated_at,
        });
        setAccountMessage('Backup found. Local changes are newer â€” review before restoring.');
      } else {
        setBackupConflict(null);
        setAccountMessage('Backup ready to restore. Review the preview below.');
      }
    } catch (error) {
      const message = error?.message || 'Load failed.';
      setAccountMessage(message);
      setAdminMessage(message);
      try {
        await logSystemEvent({
          type: 'restore_error',
          message,
          context: { source: 'preview' },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleConfirmLoadBackup() {
    if (!backupPreviewPayload) return;
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      await clearAllData();
      await importAllData(backupPreviewPayload);
      await touchLastActive();
      const updatedAt = backupPreview?.updatedAt || null;
      if (updatedAt) {
        setLastBackupAt(updatedAt);
      }
      await refresh();
      const message = updatedAt
        ? `Backup restored (${new Date(updatedAt).toLocaleString()}).`
        : 'Backup restored.';
      setAccountMessage(message);
      setAdminMessage(message);
      setAdminLog((prev) => [
        { label: 'Restored backup (self)', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      try {
        await logSystemEvent({
          type: 'restore_success',
          message,
          context: { source: 'confirm' },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      const message = error?.message || 'Restore failed.';
      setAccountMessage(message);
      setAdminMessage(message);
      try {
        await logSystemEvent({
          type: 'restore_error',
          message,
          context: { source: 'confirm' },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } finally {
      setAdminBusy(false);
      setBackupPreview(null);
      setBackupPreviewPayload(null);
      setBackupConflict(null);
    }
  }

  function handleCancelBackupPreview() {
    setBackupPreview(null);
    setBackupPreviewPayload(null);
    setBackupConflict(null);
  }

  async function handleClearBackupHistory() {
    setBackupHistory([]);
    await persistBackupHistory([]);
  }

  async function handleRefreshBackups() {
    if (!adminAvailable) {
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
    if (!adminAvailable) {
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
      try {
        await logAdminAction({
          action: 'preview_backup',
          targetUserId: adminSelectedUserId,
          context: { updatedAt: data.updated_at },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      setAdminMessage(error?.message || 'Preview failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleLoadBackupHistoryForUser() {
    if (!adminAvailable) {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const history = await listBackupHistory({
        limit: 10,
        userId: adminSelectedUserId,
        includePayload: true,
      });
      const normalized = (history || []).map((entry) => ({
        id: entry.id,
        updatedAt: entry.updated_at,
        deviceId: entry.device_id || entry.payload_meta?.deviceId || null,
        appVersion: entry.app_version || entry.payload_meta?.appVersion || null,
        payload: entry.payload || null,
        payloadMeta: entry.payload_meta || null,
      }));
      setAdminHistory(normalized);
      if (normalized.length === 0) {
        setAdminMessage('No backup history found for this user.');
      }
      setAdminLog((prev) => [
        { label: 'Loaded backup history', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
    } catch (error) {
      setAdminMessage(error?.message || 'Failed to load backup history.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleRestoreHistoryEntry(entry) {
    if (!entry?.payload) {
      setAdminMessage('No payload found for this history entry.');
      return;
    }
    const confirmRestore =
      Platform.OS !== 'web' ||
      (typeof window !== 'undefined' &&
        window.confirm('Restore this historical backup to this device? This will replace local data.'));
    if (!confirmRestore) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const decrypted = await decryptIfNeeded(entry.payload);
      await clearAllData();
      await importAllData(decrypted);
      await touchLastActive();
      await refresh();
      setAdminMessage(`Restored history entry (${new Date(entry.updatedAt).toLocaleString()}).`);
      setAdminLog((prev) => [
        { label: 'Restored history entry', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      try {
        await logAdminAction({
          action: 'restore_history_entry',
          targetUserId: adminSelectedUserId,
          context: { updatedAt: entry.updatedAt },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      setAdminMessage(error?.message || 'History restore failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleExportHistoryEntry(entry) {
    if (!entry?.payload) {
      setAdminMessage('No payload found for this history entry.');
      return;
    }
    if (Platform.OS !== 'web') {
      setAdminMessage('Export is available on web only.');
      return;
    }
    try {
      const fileName = `lifemaxing_backup_${adminSelectedUserId}_${new Date(
        entry.updatedAt
      ).toISOString()}.json`;
      const blob = new Blob([JSON.stringify(entry.payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setAdminMessage('Backup history exported.');
      try {
        await logAdminAction({
          action: 'export_history_entry',
          targetUserId: adminSelectedUserId,
          context: { updatedAt: entry.updatedAt },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      setAdminMessage(error?.message || 'History export failed.');
    }
  }

  async function handleRefreshAdminOverview() {
    if (!adminAvailable) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      const [users, summaries, events, audits] = await Promise.all([
        listUserProfiles({
          limit: adminUserLimit,
          offset: adminUserPage * adminUserLimit,
          search: adminUserSearch.trim(),
          userId: adminUserIdSearch.trim(),
        }),
        listBackupSummaries({
          limit: adminSummaryLimit,
          offset: adminUserPage * adminSummaryLimit,
          userId: adminUserIdSearch.trim(),
          from: adminDateFrom.trim(),
          to: adminDateTo.trim(),
        }),
        listSystemEvents({
          limit: adminEventsLimit,
          offset: adminEventsPage * adminEventsLimit,
          userId: adminUserIdSearch.trim(),
          from: adminDateFrom.trim(),
          to: adminDateTo.trim(),
        }),
        listAdminAudit({
          limit: adminAuditLimit,
          offset: adminAuditPage * adminAuditLimit,
          targetUserId: adminUserIdSearch.trim(),
          from: adminDateFrom.trim(),
          to: adminDateTo.trim(),
        }),
      ]);
      setAdminUsers(users);
      setAdminSummaries(summaries);
      setAdminEvents(events);
      setAdminAudit(audits);
    } catch (error) {
      setAdminMessage(error?.message || 'Failed to load admin overview.');
    } finally {
      setAdminLoading(false);
    }
  }

  function confirmAdminAction(message) {
    if (Platform.OS !== 'web') return true;
    if (typeof window === 'undefined') return true;
    return window.confirm(message);
  }

  async function handleDeleteUserData(type) {
    if (!adminAvailable) {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    const labels = {
      backup: 'latest backup',
      history: 'backup history',
      summary: 'summary stats',
      profile: 'profile',
      events: 'system events',
    };
    const confirm = confirmAdminAction(
      `Delete ${labels[type] || type} for user ${adminSelectedUserId}? This cannot be undone.`
    );
    if (!confirm) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      if (type === 'backup') await deleteUserBackup({ userId: adminSelectedUserId });
      if (type === 'history') await deleteUserBackupHistory({ userId: adminSelectedUserId });
      if (type === 'summary') await deleteUserSummary({ userId: adminSelectedUserId });
      if (type === 'profile') await deleteUserProfile({ userId: adminSelectedUserId });
      if (type === 'events') await deleteUserSystemEvents({ userId: adminSelectedUserId });
      setAdminMessage(`Deleted ${labels[type] || type}.`);
      setAdminLog((prev) => [
        { label: `Deleted ${labels[type] || type}`, at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      try {
        await logAdminAction({
          action: `delete_${type}`,
          targetUserId: adminSelectedUserId,
        });
      } catch (logError) {
        // Ignore logging errors.
      }
      await handleRefreshAdminOverview();
    } catch (error) {
      setAdminMessage(error?.message || 'Delete failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleDeleteAllUserData() {
    if (!adminAvailable) {
      setAdminMessage('Admin access only.');
      return;
    }
    if (!adminSelectedUserId) return;
    const confirm = confirmAdminAction(
      `Delete ALL data for user ${adminSelectedUserId}? This cannot be undone.`
    );
    if (!confirm) return;
    setAdminLoading(true);
    setAdminMessage('');
    try {
      await deleteUserBackup({ userId: adminSelectedUserId });
      await deleteUserBackupHistory({ userId: adminSelectedUserId });
      await deleteUserSummary({ userId: adminSelectedUserId });
      await deleteUserSystemEvents({ userId: adminSelectedUserId });
      await deleteUserProfile({ userId: adminSelectedUserId });
      setAdminMessage('Deleted all user data.');
      setAdminLog((prev) => [
        { label: 'Deleted all user data', at: new Date().toISOString() },
        ...prev,
      ].slice(0, 10));
      try {
        await logAdminAction({
          action: 'delete_all_user_data',
          targetUserId: adminSelectedUserId,
        });
      } catch (logError) {
        // Ignore logging errors.
      }
      await handleRefreshAdminOverview();
    } catch (error) {
      setAdminMessage(error?.message || 'Delete failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleLoadBackupForUser() {
    if (!adminAvailable) {
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
      try {
        await logAdminAction({
          action: 'load_backup_to_device',
          targetUserId: adminSelectedUserId,
          context: { updatedAt: record.updated_at },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
    } catch (error) {
      setAdminMessage(error?.message || 'Load failed.');
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleExportBackup() {
    if (!adminAvailable) {
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
      try {
        await logAdminAction({
          action: 'export_backup',
          targetUserId: adminSelectedUserId,
          context: { updatedAt: data.updated_at },
        });
      } catch (logError) {
        // Ignore logging errors.
      }
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

  function normalizeHabitForUI(h) {
    if (!h) return h;

    // Strip legacy "emoji + space" prefix from name
    const name = String(h.name || '');
    const cleaned = name.replace(/^[^\w\s]{1,3}\s+/u, '');

    // Provide stable icon for UI only
    const type = getHabitTypeFromName(cleaned, h.type);
    const iconKey = h.iconKey || '';

    return { ...h, name: cleaned, type, iconKey };
  }

  async function handleCreateHabit() {
    const name = formatHabitName(newHabitName);
    if (!name) return;
    const type = getHabitTypeFromName(name);
    const created = await createHabit(name, type);
    setNewHabitName('');
    setHabitId(created.id);
    await refresh();
  }

  async function handleToggleHabit(habit) {
    await setHabitActive(habit.id, !habit.isActive);
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
    if (!ensureTurnstileReady()) {
      return;
    }
    setTurnstileMessage('');
    const verification = await verifyTurnstileToken('signup');
    if (!verification.ok) {
      setTurnstileMessage(verification.message);
      return;
    }
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

  const isReady = !loading && snapshot;
  const safeSnapshot = snapshot || {
    identity: { level: 1, totalEffortUnits: 0 },
    counts: { habits: 0, efforts: 0, chests: 0 },
  };

  const loadingContent = (
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

  const { identity, counts } = safeSnapshot;
  const unlockedItems = items.filter((item) => !item.locked);
  const unlockedCards = cards.filter((card) => !card.locked);
  const visibleCards = phase2Active ? unlockedCards : [];
  const hasVisibleCards = visibleCards.length > 0;
  const activeHabits = habits.filter((habit) => habit.isActive).length;
  const pausedHabits = habits.length - activeHabits;
  const showTasks = activeTab === 'Tasks';
  const showInventory = activeTab === 'Inventory';
  const showGallery = activeTab === 'Gallery';
  const showQuests = activeTab === 'Quests';
  const showHelp = activeTab === 'Help';
  const showPlaceholder = ['Shops', 'Party', 'Group'].includes(activeTab);
  const phase2Stats = computePhase2Stats();
  const identityTitle = getIdentityTitle(identity?.level || 1);
  const todayKey = new Date().toISOString().slice(0, 10);
  const hasLoggedToday = efforts.some((effort) => {
    if (!effort?.timestamp) return false;
    return effort.timestamp.slice(0, 10) === todayKey;
  });
  const activeHabitList = habits.filter((habit) => habit.isActive);
  const defaultHabit = activeHabitList[0] || habits[0] || null;
  const hasLockedChest = Boolean(ritualChest);
  const primaryAction = (() => {
    if (habits.length === 0) {
      return {
        title: 'Create your first habit',
        helper: 'Start with something small and repeatable.',
        cta: 'Create habit',
        onPress: () => {
          newHabitInputRef.current?.focus?.();
        },
      };
    }
    if (!hasLoggedToday) {
      return {
        title: 'Log one action',
        helper: defaultHabit ? `Next up: ${defaultHabit.name}` : 'Log any habit action.',
        cta: 'Log action',
            onPress: () => {
          if (defaultHabit) {
            if (!defaultHabit.isActive) {
              openHabitSpace(defaultHabit.id);
              return;
            }
            handleHabitAction(defaultHabit);
          }
        },
      };
    }
    if (hasLockedChest) {
      return {
        title: 'Open chest',
        helper: 'Rewards are ready to unlock.',
        cta: 'Open chest',
        onPress: openLatestChest,
      };
    }
    if (phase2Active) {
      return {
        title: 'View your Gallery',
        helper: 'See what you have uncovered so far.',
        cta: 'Open Gallery',
        onPress: () => setActiveTab('Gallery'),
      };
    }
    return {
      title: 'Review your inventory',
      helper: 'Check your latest unlocks.',
      cta: 'Open inventory',
      onPress: () => setActiveTab('Inventory'),
    };
  })();
  const currentArcQuest = arcQuests.find((quest) => quest.accepted) || arcQuests[0] || null;
  const habitDetail = habitSpaceHabitId ? habitById.get(habitSpaceHabitId) : null;
  const adminCommands = useMemo(() => {
    const seasonOptions = SEASON_MANIFEST.map((season) => season.id);
    const questOptions = arcQuests.map((quest) => quest.id);
    const habitOptions = habits.map((habit) => habit.id);
    const allCardKeys = SEASON_MANIFEST.flatMap((season) =>
      season.cards.map((card) => card.key)
    );
    return [
      {
        id: 'grant_chest',
        label: 'Grant chest',
        params: [
          { key: 'rarity', label: 'Rarity', placeholder: 'common' },
          { key: 'tier', label: 'Tier', placeholder: 'weathered' },
          { key: 'qty', label: 'Quantity', placeholder: '1' },
        ],
        run: async (params) => {
          await adminSpawnChest({
            rarity: params.rarity || 'common',
            tier: params.tier || 'weathered',
            qty: params.qty || 1,
          });
          await refresh();
          return 'Chest granted.';
        },
      },
      {
        id: 'open_chest',
        label: 'Open chest immediately',
        run: async () => {
          if (!ritualChest?.id) return 'No locked chest found.';
          await adminUnlockAllChestRewards({ chestId: ritualChest.id });
          await refresh();
          return 'Chest unlocked.';
        },
      },
      {
        id: 'grant_card',
        label: 'Grant specific card by ID',
        params: [
          { key: 'cardKey', label: 'Card Key', placeholder: 'return_signal' },
          { key: 'qty', label: 'Quantity', placeholder: '1' },
        ],
        run: async (params) => {
          await adminGrantCard({
            cardKey: params.cardKey || 'return_signal',
            qty: params.qty || 1,
          });
          await refresh();
          return 'Card granted.';
        },
      },
      {
        id: 'reveal_random_card',
        label: 'Reveal random card',
        run: async () => {
          const key = allCardKeys.length
            ? allCardKeys[Math.floor(Math.random() * allCardKeys.length)]
            : 'return_signal';
          await adminGrantCard({ cardKey: key, qty: 1 });
          await refresh();
          return 'Random card granted.';
        },
      },
      {
        id: 'grant_exp',
        label: 'Grant EXP',
        params: [{ key: 'amount', label: 'Amount', placeholder: '5' }],
        run: async (params) => {
          await adminGrantExp({ amount: params.amount || 0 });
          await refresh();
          return 'EXP granted.';
        },
      },
      {
        id: 'force_level',
        label: 'Force level up',
        params: [{ key: 'levels', label: 'Levels', placeholder: '1' }],
        run: async (params) => {
          await adminForceLevelUp({ levels: params.levels || 1 });
          await refresh();
          return 'Level increased.';
        },
      },
      {
        id: 'reset_level',
        label: 'Reset level / EXP',
        run: async () => {
          await adminResetLevel();
          await refresh();
          return 'Level reset.';
        },
      },
      {
        id: 'unlock_season',
        label: 'Unlock season',
        params: [{ key: 'seasonId', label: 'Season ID', placeholder: seasonOptions[0] || '' }],
        run: async (params) => {
          const seasonId = params.seasonId || seasonOptions[0];
          if (!seasonId) return 'No season found.';
          setAdminSeasonLocks((prev) => ({ ...prev, [seasonId]: false }));
          return 'Season unlocked.';
        },
      },
      {
        id: 'lock_season',
        label: 'Lock season',
        params: [{ key: 'seasonId', label: 'Season ID', placeholder: seasonOptions[0] || '' }],
        run: async (params) => {
          const seasonId = params.seasonId || seasonOptions[0];
          if (!seasonId) return 'No season found.';
          setAdminSeasonLocks((prev) => ({ ...prev, [seasonId]: true }));
          return 'Season locked.';
        },
      },
      {
        id: 'reveal_all_cards',
        label: 'Reveal all cards in season',
        params: [{ key: 'seasonId', label: 'Season ID', placeholder: seasonOptions[0] || '' }],
        run: async (params) => {
          const seasonId = params.seasonId || seasonOptions[0];
          const season = SEASON_MANIFEST.find((item) => item.id === seasonId);
          if (!season) return 'Season not found.';
          setAdminRevealedCards((prev) => {
            const next = { ...prev };
            season.cards.forEach((card) => {
              next[card.key] = true;
            });
            return next;
          });
          return 'Cards revealed.';
        },
      },
      {
        id: 'reset_season',
        label: 'Reset season progress',
        params: [{ key: 'seasonId', label: 'Season ID', placeholder: seasonOptions[0] || '' }],
        run: async (params) => {
          const seasonId = params.seasonId || seasonOptions[0];
          const season = SEASON_MANIFEST.find((item) => item.id === seasonId);
          if (!season) return 'Season not found.';
          setAdminRevealedCards((prev) => {
            const next = { ...prev };
            season.cards.forEach((card) => {
              delete next[card.key];
            });
            return next;
          });
          return 'Season reset.';
        },
      },
      {
        id: 'complete_quest',
        label: 'Complete quest',
        params: [{ key: 'arcId', label: 'Quest ID', placeholder: questOptions[0] || '' }],
        run: async (params) => {
          const arcId = params.arcId || questOptions[0];
          if (!arcId) return 'No quest found.';
          await adminCompleteQuest({ arcId });
          await refreshArcQuests();
          return 'Quest completed.';
        },
      },
      {
        id: 'reset_quest',
        label: 'Reset quest progress',
        params: [{ key: 'arcId', label: 'Quest ID', placeholder: questOptions[0] || '' }],
        run: async (params) => {
          await adminResetQuestProgress({ arcId: params.arcId || '' });
          await refreshArcQuests();
          return 'Quest reset.';
        },
      },
      {
        id: 'simulate_habit',
        label: 'Simulate habit action',
        params: [{ key: 'habitId', label: 'Habit ID', placeholder: habitOptions[0] || '' }],
        run: async (params) => {
          const targetHabit = habitById.get(params.habitId || '') || defaultHabit;
          if (!targetHabit) return 'No habit found.';
          await handleHabitAction(targetHabit);
          return 'Habit action simulated.';
        },
      },
      {
        id: 'simulate_missed_days',
        label: 'Simulate missed days',
        params: [{ key: 'days', label: 'Days', placeholder: '3' }],
        run: async (params) => {
          await adminSimulateMissedDays({ days: params.days || 0 });
          await refresh();
          return 'Missed days simulated.';
        },
      },
      {
        id: 'toggle_reentry',
        label: 'Toggle re-entry mode',
        run: async () => {
          await adminSimulateMissedDays({ days: isQuietMode ? 0 : QUIET_MODE_DAYS + 1 });
          await refresh();
          return `Re-entry ${isQuietMode ? 'disabled' : 'enabled'}.`;
        },
      },
      {
        id: 'toggle_phase',
        label: 'Toggle phase flag (local override)',
        run: async () => {
          setAdminPhaseOverride((prev) => {
            if (prev === 'on') return 'off';
            if (prev === 'off') return 'on';
            return PHASE2_ENABLED ? 'off' : 'on';
          });
          return 'Phase override toggled.';
        },
      },
      {
        id: 'reset_today',
        label: "Reset today's state",
        run: async () => {
          await adminResetToday();
          await refresh();
          return 'Today reset.';
        },
      },
      {
        id: 'clear_cache',
        label: 'Clear local cache',
        run: async () => {
          await clearAllData();
          await initDb();
          await getOrCreateIdentity();
          await refresh();
          return 'Local cache cleared.';
        },
      },
      {
        id: 'reload_state',
        label: 'Reload app state',
        run: async () => {
          await refresh();
          return 'State reloaded.';
        },
      },
    ];
  }, [arcQuests, habits, ritualChest, habitById, defaultHabit, isQuietMode, phase2Active]);

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

  function getIdentityTitle(level) {
    if (level >= 20) return 'Relic-Bound';
    if (level >= 15) return 'Arckeeper';
    if (level >= 10) return 'Anchor';
    if (level >= 5) return 'Wayfarer';
    return 'Initiate';
  }

  function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computePhase2Stats() {
    const days = inactivityDays || 0;
    const activeDays = evidence?.activeDays || 0;
    const momentum =
      days <= 1 ? 'Steady' : days <= 3 ? 'Warming' : days <= 7 ? 'Quiet' : 'Dormant';
    const consistency =
      activeDays >= 20 ? 'Anchored' : activeDays >= 10 ? 'Forming' : activeDays >= 4 ? 'Faint' : 'New';
    const vitality = days <= 1 ? 'Ready' : days <= 3 ? 'Rested' : 'Recovering';
    const hp = clampValue(100 - days * 4, 60, 100);
    const mp = clampValue(85 - days * 3, 50, 90);
    return { momentum, consistency, vitality, hp, mp };
  }

  function getItemDetails(item) {
    if (!item?.modifiersJson) return { modifiers: [], tag: '' };
    try {
      const parsed = JSON.parse(item.modifiersJson);
      return {
        modifiers: Array.isArray(parsed?.modifiers) ? parsed.modifiers : [],
        tag: parsed?.tag || '',
      };
    } catch (error) {
      return { modifiers: [], tag: '' };
    }
  }

  function getRarityColor(rarity) {
    if (!rarity) return RARITY_COLORS.common;
    return RARITY_COLORS[rarity] || RARITY_COLORS.common;
  }

  function handleLogoTap() {
    if (!adminAvailable) return;
  }

  function openHabitSpace(id) {
    if (id) {
      setSelectedChallengeHabitId(id);
    }
    setHabitSpaceHabitId(id || null);
    setHabitSpaceOpen(true);
  }

  function closeHabitSpace() {
    setHabitSpaceOpen(false);
    setHabitSpaceHabitId(null);
  }

  const filteredAdminCommands = adminCommands.filter((command) =>
    command.label.toLowerCase().includes(adminPaletteQuery.toLowerCase())
  );

  async function handleRunAdminCommand(command) {
    if (!adminAvailable || !command || adminPaletteBusy) return;
    setAdminPaletteBusy(true);
    setAdminPaletteMessage('');
    try {
      const result = await command.run(adminPaletteParams);
      setAdminPaletteMessage(result || 'Command executed.');
    } catch (error) {
      setAdminPaletteMessage(error?.message || 'Command failed.');
    } finally {
      setAdminPaletteBusy(false);
    }
  }

  function renderArcQuestCard(quest) {
    if (!quest) return null;
    const linkedHabit = habitById.get(quest.habitId);
    return (
      <View key={quest.id} style={styles.arcCard}>
        <View style={styles.arcHeader}>
          <Text style={styles.arcTitle}>{quest.title}</Text>
          <Text style={styles.arcTheme}>{quest.theme}</Text>
        </View>
        <Text style={styles.subtle}>{quest.summary}</Text>
        <View style={styles.arcProgressRow}>
          <Text style={styles.arcProgressValue}>{quest.progress} effort</Text>
          <Text style={styles.arcProgressMeta}>
            {quest.unlockedCount}/{quest.totalFragments} fragments
          </Text>
        </View>
        {quest.nextMilestone ? (
          <Text style={styles.arcProgressMeta}>
            Next fragment at {quest.nextMilestone} effort
          </Text>
        ) : (
          <Text style={styles.arcProgressMeta}>All fragments unlocked.</Text>
        )}
        <View style={styles.arcControlRow}>
          <Text style={styles.arcHint}>
            Arc quests describe your journeyâ€”they never demand a daily task.
          </Text>
          {!quest.accepted && (
            <View style={styles.arcButtonRow}>
              <Pressable
                style={[styles.buttonSmall, styles.arcAcceptButton]}
                onPress={() => handleAcceptArc(quest.id)}
              >
                <Text style={styles.buttonText}>Accept quest</Text>
              </Pressable>
              {!quest.ignored && (
                <Pressable style={styles.buttonGhost} onPress={() => handleIgnoreArc(quest.id)}>
                  <Text style={styles.buttonGhostText}>Ignore for now</Text>
                </Pressable>
              )}
            </View>
          )}
          {quest.accepted && (
            <View style={styles.arcLinkRow}>
              <Text style={styles.subtle}>
                Linked Habit:&nbsp;
                <Text style={{ color: ACCENT_GOLD }}>
                  {linkedHabit ? linkedHabit.name : 'None yet'}
                </Text>
              </Text>
              <Pressable
                style={[styles.buttonSmall, styles.arcLinkButton]}
                onPress={() => handleCycleArcHabit(quest)}
              >
                <Text style={styles.buttonText}>
                  {linkedHabit ? 'Rebind habit' : 'Bind a habit'}
                </Text>
              </Pressable>
            </View>
          )}
          {!quest.accepted && quest.ignored ? (
            <Text style={styles.quietText}>
              Ignored quietlyâ€”accept any time to re-open this narrative.
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  function formatScopeTag(scope) {
    const type = scope?.type || 'any';
    const value = scope?.value || '';
    switch (type) {
      case 'habitId': {
        const habit = habitById.get(value);
        const label = habit ? habit.name : value;
        return `HABIT: ${label}`;
      }
      case 'habitType': {
        const formatted = value ? value.toString().replace(/^\w/, (c) => c.toUpperCase()) : 'Habit';
        return `TYPE: ${formatted}`;
      }
      case 'any':
      default:
        return 'ANY HABIT';
    }
  }

  function findArcQuestForHabit(habit) {
    if (!habit || arcQuests.length === 0) return null;
    const habitId = habit.id;
    const habitType = (habit.type || 'generic').toString().toLowerCase();
    const matches = arcQuests
      .map((quest) => {
        const scope = quest.scope || { type: 'any', value: null };
        const scopeType = (scope.type || 'any').toString().toLowerCase();
        const scopeValue = scope.value;
        if (scopeType === 'habitid' && scopeValue === habitId) {
          return { quest, priority: 0 };
        }
        if (
          scopeType === 'habittype' &&
          scopeValue &&
          scopeValue.toString().toLowerCase() === habitType
        ) {
          return { quest, priority: 1 };
        }
        if (scopeType === 'any') {
          return { quest, priority: 2 };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.quest.accepted && !b.quest.accepted) return -1;
        if (!a.quest.accepted && b.quest.accepted) return 1;
        return a.priority - b.priority;
      });
    const best = matches[0];
    if (!best) return null;
    return {
      quest: best.quest,
      accepted: Boolean(best.quest.accepted),
    };
  }

  function isEffortWithinScope(effort, scope) {
    if (!scope || !effort) return true;
    const scopeType = (scope.type || 'any').toLowerCase();
    const scopeValue = scope.value;
    const habit = habitById.get(effort.habitId);
    const habitType = (habit?.type || 'generic').toString().toLowerCase();
    switch (scopeType) {
      case 'habitid':
        return effort.habitId === scopeValue;
      case 'habittype':
        return scopeValue && habitType === scopeValue.toString().toLowerCase();
      case 'any':
      default:
        return true;
    }
  }

  function getLatestEffortForQuest(quest) {
    const matching = efforts
      .filter((effort) => isEffortWithinScope(effort, quest.scope))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return matching[0] || null;
  }

  function getLatestEffortForHabit(habitId) {
    if (!habitId) return null;
    const matching = efforts
      .filter((effort) => effort.habitId === habitId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return matching[0] || null;
  }

  function formatEffortActionLabel(effort) {
    if (!effort) return 'No progress tracked yet.';
    const habit = habitById.get(effort.habitId);
    const name = habit?.name || effort.habitName || 'Habit';
    const action = effort.actionType?.replace('_', ' ') || 'action';
    const units = typeof effort.units === 'number' ? effort.units : effort.effortValue || 1;
    const timestamp = new Date(effort.timestamp).toLocaleDateString();
    return `Last logged ${action} for ${name} (${units} unit${units === 1 ? '' : 's'}) on ${timestamp}`;
  }

  const mainContent = isReady ? (
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
        <>
          <View style={styles.encounterCard}>
            <View style={styles.encounterHeaderRow}>
              <Text style={styles.encounterLabel}>Encounter</Text>
              {hasLockedChest ? (
                <Pressable style={styles.encounterBadge} onPress={openLatestChest}>
                  <Text style={styles.encounterBadgeText}>Chest earned</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.encounterTitle}>{primaryAction.title}</Text>
            <Text style={styles.encounterHelper}>{primaryAction.helper}</Text>
            <Pressable style={styles.primaryActionButton} onPress={primaryAction.onPress}>
              <Text style={styles.primaryActionButtonText}>{primaryAction.cta}</Text>
            </Pressable>
          </View>

          <View style={[styles.panel, styles.panelTight]}>
            <Text style={styles.panelTitle}>Habits</Text>
            {habits.length === 0 ? (
              <Text style={styles.subtle}>No habits yet. Create one below.</Text>
              ) : (
                habits.map((habit) => {
                  const spec = getHabitSpec(habit);
                  const total = habitActionCounts[habit.id] || 0;
                  const todayEntry =
                    spec.template === 'counter_target'
                      ? { amount: total }
                      : total > 0
                      ? { kind: 'done' }
                      : undefined;
                  const progressValue = spec.getProgress(todayEntry);
                  const showCounter = spec.template === 'counter_target';
                  const target = spec.target || 1;
                  const primaryAction = spec.actions?.[0];
                  return (
                    <View key={habit.id} style={styles.habitListRow}>
                      <Pressable
                        style={[
                          styles.habitCard,
                          !habit.isActive && styles.habitCardPaused,
                        ]}
                        onPress={() => openHabitSpace(habit.id)}
                      >
                        <Text style={styles.habitCardTitle}>
                          <HabitIcon habit={habit} style={styles.habitIconInline} />
                          {habit.name}
                        </Text>
                        <Text style={styles.habitCardMeta}>
                          {habit.isActive ? 'Active' : 'Paused'}
                        </Text>
                        <View style={styles.habitProgressRow}>
                          <View style={styles.habitProgressTrack}>
                            <View
                              style={[
                                styles.habitProgressFill,
                                { width: `${Math.round(progressValue * 100)}%` },
                              ]}
                            />
                          </View>
                          {showCounter ? (
                            <Text style={styles.habitProgressText}>
                              {Math.min(total, target)}/{target}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                      <Pressable
                        style={[styles.habitQuickButton, !habit.isActive && styles.buttonDisabled]}
                        onPress={() => handleHabitAction(habit, primaryAction)}
                        disabled={!habit.isActive}
                      >
                        <Text style={styles.habitQuickButtonText}>
                          {primaryAction?.label || 'Log'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })
            )}
            <View style={styles.habitInputRow}>
              <TextInput
                ref={newHabitInputRef}
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

          <View style={styles.collapseCard}>
            <Pressable
              style={styles.collapseHeader}
              onPress={() => setTasksStatusOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle}>Status</Text>
              <Text style={styles.collapseAction}>{tasksStatusOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {tasksStatusOpen ? (
              <View style={styles.collapseBody}>
                <View style={styles.heroRow}>
                  <View style={styles.avatarBox}>
                    <Text style={styles.avatarText}>SIGIL</Text>
                  </View>
                  <View style={styles.heroStats}>
                    <Text style={styles.heroLabel}>Identity</Text>
                    <Text style={styles.heroValue}>Level {identity.level}</Text>
                    <Text style={styles.heroSubtle}>Title: {identityTitle}</Text>
                    <View style={styles.heroVitals}>
                      <View style={styles.heroVitalChip}>
                        <Text style={styles.heroVitalLabel}>HP</Text>
                        <Text style={styles.heroVitalValue}>{phase2Stats.hp}</Text>
                      </View>
                      <View style={styles.heroVitalChip}>
                        <Text style={styles.heroVitalLabel}>MP</Text>
                        <Text style={styles.heroVitalValue}>{phase2Stats.mp}</Text>
                      </View>
                    </View>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Habits</Text>
                  <Text style={styles.statValue}>{counts.habits}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Actions Logged</Text>
                  <Text style={styles.statValue}>{counts.efforts}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Chests Earned</Text>
                  <Text style={styles.statValue}>{counts.chests}</Text>
                </View>
                <Text style={styles.subtle}>
                  Re-entry mode: {isQuietMode ? 'quiet' : 'standard'}
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
          </View>

          <View style={styles.collapseCard}>
            <Pressable
              style={styles.collapseHeader}
              onPress={() => setTasksEvidenceOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle}>Evidence</Text>
              <Text style={styles.collapseAction}>{tasksEvidenceOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {tasksEvidenceOpen ? (
              <View style={styles.collapseBody}>
                <View style={styles.expRow}>
                  <Text style={styles.expLabel}>Growth</Text>
                  <View style={styles.expTrack}>
                    <Animated.View
                      style={[
                        styles.expFill,
                        {
                          width: expAnim.current.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                  {phase2Active ? (
                    <Pressable
                      style={[styles.expToggle, expNotesEnabled && styles.expToggleActive]}
                      onPress={() => setExpNotesEnabled((prev) => !prev)}
                    >
                      <Text
                        style={[styles.expToggleText, expNotesEnabled && styles.expToggleTextActive]}
                      >
                        Growth notes: {expNotesEnabled ? 'On' : 'Off'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {expNoteMessage ? <Text style={styles.expNote}>{expNoteMessage}</Text> : null}
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Momentum</Text>
                  <Text style={styles.statValue}>{phase2Stats.momentum}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Consistency</Text>
                  <Text style={styles.statValue}>{phase2Stats.consistency}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Vitality</Text>
                  <Text style={styles.statValue}>{phase2Stats.vitality}</Text>
                </View>
                <Text style={styles.subtle}>Soft stats only. No urgency, no pressure.</Text>
                {evidence ? (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Days Shown Up</Text>
                      <Text style={styles.statValue}>{evidence.activeDays}</Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Last Action</Text>
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
                  </>
                ) : (
                  <Text style={styles.subtle}>Evidence appears after the first action.</Text>
                )}
              </View>
            ) : null}
          </View>

          <View style={styles.collapseCard}>
            <Pressable
              style={styles.collapseHeader}
              onPress={() => setTasksOrientationOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle}>Orientation</Text>
              <Text style={styles.collapseAction}>
                {tasksOrientationOpen ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
            {tasksOrientationOpen ? (
              <View style={styles.collapseBody}>
                {shouldShowOrientation ? (
                  <View style={styles.orientationPanel}>
                    <Text style={styles.panelTitle}>Take the First Step</Text>
                    <Text style={styles.orientationSubtitle}>
                      Every system begins with a single signal.
                    </Text>
                    <Text style={styles.orientationObjective}>Objective: Log any action once.</Text>
                    <Text style={styles.subtle}>
                      This is enough for now. Action first, explanation later.
                    </Text>
                    <View style={styles.orientationActions}>
                      <Pressable
                        style={[
                          styles.buttonSmall,
                          styles.orientationActionButton,
                          orientationAccepted && styles.buttonDisabled,
                        ]}
                        onPress={handleAcceptOrientation}
                        disabled={orientationAccepted}
                      >
                        <Text style={styles.buttonText}>
                          {orientationAccepted ? 'Quest accepted' : 'Accept quest'}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.buttonGhost, styles.orientationIgnore]}
                        onPress={handleIgnoreOrientation}
                      >
                        <Text style={styles.buttonGhostText}>Ignore for now</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.subtle}>Orientation is complete.</Text>
                )}
                {orientationMessage ? (
                  <View style={styles.orientationMessage}>
                    <Text style={styles.orientationMessageText}>{orientationMessage}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.collapseCard}>
            <Pressable
              style={styles.collapseHeader}
              onPress={() => setTasksArcOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle}>Arc Quest</Text>
              <Text style={styles.collapseAction}>{tasksArcOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {tasksArcOpen ? (
              <View style={styles.collapseBody}>
                {!currentArcQuest ? (
                  <Text style={styles.subtle}>Arc quests appear quietly over time.</Text>
                ) : (
                  <>
                    <View style={styles.arcList}>{renderArcQuestCard(currentArcQuest)}</View>
                    {arcQuests.length > 1 ? (
                      <Pressable
                        style={styles.buttonGhost}
                        onPress={() => setShowAllArcQuests((prev) => !prev)}
                      >
                        <Text style={styles.buttonGhostText}>
                          {showAllArcQuests ? 'Hide quests' : 'View all quests'}
                        </Text>
                      </Pressable>
                    ) : null}
                    {showAllArcQuests ? (
                      <View style={styles.arcList}>
                        {arcQuests
                          .filter((quest) => quest.id !== currentArcQuest.id)
                          .map((quest) => renderArcQuestCard(quest))}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {showHelp ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Account</Text>
          <View style={styles.helpTabRow}>
            {HELP_TABS.map((tab) => (
              <Pressable
                key={tab}
                style={[styles.helpTab, helpTab === tab && styles.helpTabActive]}
                onPress={() => setHelpTab(tab)}
              >
                <Text style={[styles.helpTabText, helpTab === tab && styles.helpTabTextActive]}>
                  {tab}
                </Text>
              </Pressable>
            ))}
          </View>

          {helpTab === 'Account' ? (
            <View style={styles.helpCard}>
              <Text style={styles.menuLabel}>Session</Text>
              <Text style={styles.subtle}>
                {authStatus === 'signed_in'
                  ? `Mode: Linked (${authEmail || 'signed in'})`
                  : 'Mode: Guest (local-first)'}
              </Text>
              
            </View>
          ) : null}

          {helpTab === 'Backups' ? (
            <View style={styles.helpCard}>
              <Text style={styles.menuLabel}>Backups</Text>
              <Text style={styles.subtle}>
                Last backup: {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'None'}
              </Text>
              {backupHistory.length > 0 ? (
                <View style={styles.menuSection}>
                  <Text style={styles.menuLabel}>Backup History</Text>
                  {backupHistory.map((entry) => (
                    <Text key={entry.updatedAt} style={styles.subtle}>
                      {new Date(entry.updatedAt).toLocaleString()}
                      {entry.deviceId ? ` - ${entry.deviceId}` : ''}
                      {entry.appVersion ? ` (v${entry.appVersion})` : ''}
                    </Text>
                  ))}
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={handleClearBackupHistory}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonGhostText}>Clear history</Text>
                  </Pressable>
                </View>
              ) : null}
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
              {backupPreview ? (
                <View style={styles.menuSection}>
                  <Text style={styles.menuLabel}>Restore Preview</Text>
                  {backupConflict ? (
                    <Text style={styles.subtle}>
                      Local activity is newer than this backup. Restoring will replace those changes.
                    </Text>
                  ) : null}
                  <Text style={styles.subtle}>Level {backupPreview.identityLevel}</Text>
                  <Text style={styles.subtle}>Effort {backupPreview.totalEffort}</Text>
                  <Text style={styles.subtle}>Habits {backupPreview.habits}</Text>
                  {phase2Active ? (
                    <Text style={styles.subtle}>Cards {backupPreview.cards || 0}</Text>
                  ) : null}
                  <Text style={styles.subtle}>Chests {backupPreview.chests}</Text>
                  <Text style={styles.subtle}>Items {backupPreview.items}</Text>
                  <Pressable
                    style={styles.button}
                    onPress={handleConfirmLoadBackup}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonText}>
                      {backupConflict ? 'Restore anyway' : 'Restore now'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.buttonGhost}
                    onPress={handleCancelBackupPreview}
                    disabled={adminBusy}
                  >
                    <Text style={styles.buttonGhostText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {helpTab === 'Local' ? (
            <View style={styles.helpCard}>
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
          ) : null}

          {helpTab === 'Onboarding' ? (
            <View style={styles.helpCard}>
              <Text style={styles.menuLabel}>Account & Onboarding</Text>
              <Pressable style={styles.buttonGhost} onPress={handleShowOnboarding}>
                <Text style={styles.buttonGhostText}>Show onboarding</Text>
              </Pressable>
            </View>
          ) : null}

          {helpTab === 'Trust' && SHOW_TRUST_TESTS ? (
            <View style={styles.helpCard}>
              <Text style={styles.menuLabel}>Trust Tests</Text>
              <Text style={styles.subtle}>Manual checklist (dev sanity):</Text>
              <View style={styles.trustList}>
                <Text style={styles.trustItem}>* Reopen after inactivity feels safe</Text>
                <Text style={styles.trustItem}>* Opening a chest never harms you</Text>
                <Text style={styles.trustItem}>* Consistency beats spikes</Text>
                <Text style={styles.trustItem}>* Power never appears without effort</Text>
                <Text style={styles.trustItem}>* Identity never decreases</Text>
              </View>
            </View>
          ) : null}

          {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
        </View>
      ) : null}
          
          

      {showInventory ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Chests</Text>
          {chests.length === 0 ? (
          <Text style={styles.subtle}>No chests yet. Log an action to earn one.</Text>
          ) : (
            <View style={styles.grid}>
              {chests.map((chest) => (
                <View key={chest.id} style={styles.gridCard}>
                  <Text style={styles.rarityTitle}>
                    {(chest.tierLabel || chest.tier || 'Weathered').toString().toUpperCase()}
                  </Text>
                  <Text style={styles.gridSubtle}>Potential: {chest.rarity}</Text>
                  {chest.theme ? (
                    <Text style={styles.gridSubtle}>Theme: {chest.theme}</Text>
                  ) : null}
                  {chest.habitName ? (
                    <Text style={styles.gridSubtle}>From {chest.habitName}</Text>
                  ) : null}
                  <Text style={styles.gridSubtle}>{chest.rewardCount} rewards</Text>
                  <Text style={styles.gridSubtle}>{chest.lockedCount} locked</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {showGallery && phase2Active ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Seasonal Gallery</Text>
          {SEASON_MANIFEST.map((season) => (
            <View key={season.id} style={styles.gallerySeason}>
              <View style={styles.galleryHeader}>
                <Text style={styles.galleryTitle}>{season.name}</Text>
                <Text style={styles.galleryTime}>{season.timeframe}</Text>
              </View>
              {season.theme ? (
                <Text style={styles.galleryTheme}>{season.theme}</Text>
              ) : null}
              {adminSeasonLocks[season.id] ? (
                <View style={styles.galleryLocked}>
                  <Text style={styles.galleryLockedText}>Season locked</Text>
                </View>
              ) : (
              <View style={styles.grid}>
                {season.cards.map((card, index) => {
                  const discoveredCount = galleryCardStats.counts.get(card.key) || 0;
                  const adminRevealed = !!adminRevealedCards[card.key];
                  const discovered = discoveredCount > 0 || adminRevealed;
                  const latest = galleryCardStats.latest.get(card.key);
                  const rarity = card.rarity || latest?.rarity || 'common';
                  const frameColor = getRarityColor(rarity);
                  return (
                    <Pressable
                      key={`${season.id}-${card.key}`}
                      style={[
                        styles.galleryCard,
                        !discovered && styles.galleryCardUnknown,
                        { borderColor: frameColor },
                      ]}
                      onPress={() =>
                        setGallerySelection({
                          season,
                          card,
                          discovered,
                          discoveredCount: discoveredCount > 0 ? discoveredCount : 1,
                          latest,
                        })
                      }
                    >
                      <Text style={styles.gallerySlotIndex}>Slot {index + 1}</Text>
                      <Text style={styles.galleryCardTitle}>
                        {discovered ? card.name : '?'}
                      </Text>
                      <Text style={styles.galleryCardRarity}>{rarity.toUpperCase()}</Text>
                      {discovered ? (
                        <Text style={styles.galleryCardCount}>
                          x{discoveredCount > 0 ? discoveredCount : 1}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {showQuests ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Habit Journeys</Text>
          {habits.length === 0 ? (
            <Text style={styles.subtle}>Create a habit to discover its journey.</Text>
          ) : (
            <>
              <View style={styles.challengeHabitRow}>
                {habits.map((habit) => (
                    <Pressable
                      key={habit.id}
                      style={[
                        styles.challengeHabitChip,
                        selectedChallengeHabitId === habit.id && styles.challengeHabitChipActive,
                      ]}
                      onPress={() => openHabitSpace(habit.id)}
                    >
                      <Text style={styles.challengeHabitText}>
                        <HabitIcon habit={habit} style={styles.habitIconInline} />
                        {habit.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {challengeHabit ? (
                  <View style={styles.challengeCard}>
                  <View style={styles.challengeCardHeader}>
                      <View>
                        <Text style={styles.challengeCardTag}>
                          {challengeArcQuest ? 'Arc Quest' : 'Habit Journey'}
                        </Text>
                        <Text style={styles.challengeCardTitle}>
                          {challengeArcQuest ? (
                            challengeArcQuest.title
                          ) : (
                            <>
                              <HabitIcon habit={challengeHabit} style={styles.habitIconInline} />
                              {challengeHabit.name}
                            </>
                          )}
                        </Text>
                      </View>
                    {challengeArcQuest ? (
                      <Text style={styles.challengeCardScope}>
                        {formatScopeTag(challengeArcQuest.scope)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.arcFeedTheme}>
                    {challengeArcQuest?.theme || 'Your habit, your story.'}
                  </Text>
                  <Text style={styles.subtle}>
                    {challengeArcQuest?.summary ||
                      'No arc quest is tied to this habit yet. Keep showing up and one will appear.'}
                  </Text>
                  {challengeArcQuest ? (
                    <View style={styles.arcProgressRow}>
                      <Text style={styles.arcProgressValue}>{challengeArcQuest.progress} effort</Text>
                      <Text style={styles.arcProgressMeta}>
                        {challengeArcQuest.unlockedCount}/{challengeArcQuest.totalFragments} fragments
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.arcProgressMeta}>
                      Arc quest details show up once the journey is unlocked or linked.
                    </Text>
                  )}
                  <Text style={styles.arcProgressMeta}>
                    {formatEffortActionLabel(latestChallengeEffort)}
                  </Text>
                  <View style={styles.challengeButtonRow}>
                    {challengeArcQuest && !challengeArcAccepted ? (
                      <Pressable
                        style={styles.challengeAcceptButton}
                        onPress={() =>
                          handleAcceptArcForHabit(challengeArcQuest.id, challengeHabit.id)
                        }
                        disabled={!challengeHabit.isActive}
                      >
                        <Text style={styles.challengeAcceptButtonText}>Accept arc quest</Text>
                      </Pressable>
                    ) : null}
                      <Pressable
                        style={[
                          styles.challengeLogButton,
                          !challengeHabit.isActive && styles.buttonDisabled,
                        ]}
                        onPress={() =>
                          handleHabitAction(
                            challengeHabit,
                            challengeSpec?.actions?.[0]
                          )
                        }
                        disabled={!challengeHabit.isActive}
                      >
                        <Text style={styles.challengeLogButtonText}>
                          {challengeSpec?.actions?.[0]?.label || 'Log'}
                        </Text>
                      </Pressable>
                    <Pressable
                      style={[styles.challengeToggleButton]}
                      onPress={() => handleToggleHabit(challengeHabit)}
                    >
                      <Text style={styles.challengeToggleButtonText}>
                        {challengeHabit.isActive ? 'Pause' : 'Resume'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.challengeDeleteButton]}
                      onPress={() => handleDeleteHabit(challengeHabit)}
                    >
                      <Text style={styles.challengeDeleteButtonText}>Delete habit</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </>
          )}
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
                  <Text style={styles.filterText}>
                    <HabitIcon habit={habit} style={styles.habitIconInline} />
                    {habit.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          {efforts.length === 0 ? (
            <Text style={styles.subtle}>No actions logged yet.</Text>
          ) : (
            efforts.map((effort) => (
              <View key={effort.id} style={styles.effortRowCompact}>
                <View>
                  <Text style={styles.effortTitle}>{effort.habitName}</Text>
                  <Text style={styles.effortMeta}>
                    {new Date(effort.timestamp).toLocaleDateString()} -{' '}
                    {typeof effort.units === 'number' ? effort.units : 1} units
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
            <Text style={styles.panelTitle}>Encounter</Text>
            <Text style={styles.menuHint}>Open what you already earned.</Text>
          </View>
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Chest</Text>
            {ritualChest ? (
              <>
                <Text style={styles.subtle}>
                  {ritualChest.rarity} chest • {ritualChest.lockedCount} inside
                </Text>
                <Pressable style={styles.button} onPress={handleOpenChest}>
                  <Text style={styles.buttonText}>Open chest</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.subtle}>No chests waiting right now.</Text>
            )}
            {ritualMessage ? <Text style={styles.subtle}>{ritualMessage}</Text> : null}
          </View>
          <View style={styles.menuDivider} />
          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>Inventory</Text>
            {unlockedItems.length === 0 && !hasVisibleCards ? (
              <Text style={styles.subtle}>Rewards appear here after you open a chest.</Text>
            ) : (
              <>
                {unlockedItems.length > 0 ? (
                  <>
                    <Text style={styles.menuHint}>Items</Text>
                    <View style={styles.grid}>
                      {unlockedItems.map((item) => {
                        const details = getItemDetails(item);
                        return (
                          <View key={item.id} style={styles.gridCard}>
                            <Text style={styles.gridTitle}>{item.name || item.type}</Text>
                            <Text style={styles.gridSubtle}>{item.rarity || 'common'}</Text>
                            {item.effect ? (
                              <Text style={styles.gridSubtle}>{item.effect}</Text>
                            ) : (
                              <Text style={styles.gridSubtle}>
                                {details.tag} {details.modifiers?.join(' ')}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {hasVisibleCards ? (
                  <>
                    <Text style={styles.menuHint}>Cards</Text>
                    <View style={styles.grid}>
                      {visibleCards.map((card) => (
                        <View key={card.id} style={styles.gridCard}>
                          <Text style={styles.gridTitle}>{card.name}</Text>
                          <Text style={styles.gridSubtle}>{card.rarity}</Text>
                          <Text style={styles.gridSubtle}>{card.effect}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}
              </>
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
            <Text style={styles.trustItem}>* Opening a chest never harms you</Text>
            <Text style={styles.trustItem}>* Consistency beats spikes</Text>
            <Text style={styles.trustItem}>* Power never appears without effort</Text>
            <Text style={styles.trustItem}>* Identity never decreases</Text>
          </View>
        </View>
      ) : null}
    </>
  ) : null;

  return (
    <View style={styles.appFrame}>
      <View style={styles.backgroundNebula} pointerEvents="none" />
      <View style={styles.backgroundRing} pointerEvents="none" />
      <Pressable style={styles.backgroundLogoTap} onPress={handleLogoTap}>
        <Image
          source={require('../../assets/lifemaxxing-logo.png')}
          style={styles.backgroundLogo}
          accessibilityIgnoresInvertColors
        />
      </Pressable>
      {ritualOverlayOpen && ritualOverlayChest ? (
        <RitualOverlay
          chest={ritualOverlayChest}
          rewards={ritualOverlayRewards}
          onClose={() => {
            setRitualOverlayOpen(false);
            setRitualOverlayChest(null);
            setRitualOverlayRewards([]);
            refresh();
          }}
        />
      ) : null}
      {arcOverlay ? (
        <View style={styles.arcOverlay}>
          <View style={styles.arcOverlayCard}>
            <Text style={styles.arcOverlayTitle}>Arc Fragment Unlocked</Text>
            <Text style={styles.arcOverlayName}>{arcOverlay.title}</Text>
            {arcOverlay.fragment ? (
              <Text style={styles.arcOverlayFragment}>{arcOverlay.fragment}</Text>
            ) : null}
            <Pressable style={styles.button} onPress={() => setArcOverlay(null)}>
              <Text style={styles.buttonText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {gallerySelection ? (
        <View style={styles.galleryOverlay}>
          <View style={styles.galleryModal}>
            <Text style={styles.galleryModalTitle}>
              {gallerySelection.discovered ? gallerySelection.card.name : 'Undiscovered'}
            </Text>
            <Text style={styles.galleryModalMeta}>
              {gallerySelection.season.name} â€” {gallerySelection.season.timeframe}
            </Text>
            <View
              style={[
                styles.galleryModalBadge,
                { borderColor: getRarityColor(gallerySelection.card.rarity) },
              ]}
            >
              <Text style={styles.galleryModalBadgeText}>
                {gallerySelection.card.rarity.toUpperCase()}
              </Text>
            </View>
            {gallerySelection.discovered ? (
              <>
                <Text style={styles.galleryModalBody}>
                  {gallerySelection.latest?.effect || 'A quiet artifact from your journey.'}
                </Text>
                <Text style={styles.galleryModalCount}>
                  Owned: x{gallerySelection.discoveredCount}
                </Text>
              </>
            ) : (
              <Text style={styles.galleryModalBody}>
                This card will reveal itself when it is discovered.
              </Text>
            )}
            <Pressable style={styles.button} onPress={() => setGallerySelection(null)}>
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {adminAvailable && adminPaletteOpen ? (
        <Pressable style={styles.adminPaletteOverlay} onPress={() => setAdminPaletteOpen(false)}>
          <Pressable style={styles.adminPaletteCard} onPress={() => {}}>
            <View style={styles.adminPaletteHeader}>
              <Text style={styles.adminPaletteTitle}>Admin Command Palette</Text>
              <Pressable onPress={() => setAdminPaletteOpen(false)}>
                <Text style={styles.adminPaletteClose}>Close</Text>
              </Pressable>
            </View>
            <TextInput
              value={adminPaletteQuery}
              onChangeText={setAdminPaletteQuery}
              placeholder="Search commands..."
              placeholderTextColor="#4b5563"
              style={styles.adminPaletteInput}
            />
            <ScrollView style={styles.adminPaletteList}>
              {filteredAdminCommands.map((command) => {
                const selected = adminPaletteSelection?.id === command.id;
                return (
                  <Pressable
                    key={command.id}
                    style={[
                      styles.adminPaletteItem,
                      selected && styles.adminPaletteItemActive,
                    ]}
                    onPress={() => {
                      setAdminPaletteSelection(command);
                      setAdminPaletteParams({});
                      setAdminPaletteMessage('');
                    }}
                  >
                    <Text style={styles.adminPaletteItemText}>{command.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {adminPaletteSelection ? (
              <View style={styles.adminPaletteParams}>
                {(adminPaletteSelection.params || []).map((param) => (
                  <TextInput
                    key={param.key}
                    value={adminPaletteParams[param.key] || ''}
                    onChangeText={(value) =>
                      setAdminPaletteParams((prev) => ({ ...prev, [param.key]: value }))
                    }
                    placeholder={`${param.label}${param.placeholder ? ` (${param.placeholder})` : ''}`}
                    placeholderTextColor="#4b5563"
                    style={styles.adminPaletteInput}
                  />
                ))}
                <Pressable
                  style={[styles.button, adminPaletteBusy && styles.buttonDisabled]}
                  onPress={() => handleRunAdminCommand(adminPaletteSelection)}
                  disabled={adminPaletteBusy}
                >
                  <Text style={styles.buttonText}>Run</Text>
                </Pressable>
              </View>
            ) : null}
            {adminPaletteMessage ? (
              <Text style={styles.adminPaletteMessage}>{adminPaletteMessage}</Text>
            ) : null}
          </Pressable>
        </Pressable>
      ) : null}
      <SlideOverFullScreen
        open={habitSpaceOpen}
        onClose={closeHabitSpace}
        from="right"
        title="Habit Space"
      >
          <HabitSpaceOverlay
            habitId={habitSpaceHabitId}
            habits={habits}
            efforts={efforts}
            arcQuests={arcQuests}
            onClose={closeHabitSpace}
            onLog={(action) => {
              if (habitDetail) handleHabitAction(habitDetail, action);
            }}
            onRest={() => {
              setOrientationMessage('Rest tracked soon.');
            }}
            onAcceptArc={handleAcceptArcForHabit}
            onIgnoreArc={handleIgnoreArc}
          />
      </SlideOverFullScreen>

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

      {isReady ? (
        <View style={styles.layout}>
          <View style={styles.sidePanel}>
          <Text style={styles.panelTitle}>Status Log</Text>
          <Pressable
            style={styles.statusDropdown}
            onPress={() => setStatusDropdownOpen((prev) => !prev)}
          >
            <Text style={styles.statusDropdownLabel}>Today</Text>
            <Text style={styles.statusDropdownValue}>
              {statusDropdownOpen ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
          {statusDropdownOpen ? (
            <View style={styles.statusDropdownList}>
              <Text style={styles.sideLabel}>Habits</Text>
              {habits.filter((habit) => habit.isActive).length === 0 ? (
                <Text style={styles.sideMeta}>No active habits yet.</Text>
              ) : (
                  habits
                    .filter((habit) => habit.isActive)
                    .map((habit) => (
                      <Text key={habit.id} style={styles.sideMeta}>
                        - <HabitIcon habit={habit} style={styles.habitIconInline} />
                        {habit.name}
                      </Text>
                    ))
                )}
              <Text style={styles.sideLabel}>Arc Quests</Text>
              {arcQuests.length === 0 ? (
                <Text style={styles.sideMeta}>Quiet for now.</Text>
              ) : (
                arcQuests.map((quest) => (
                  <Text key={quest.id} style={styles.sideMeta}>
                    - {quest.title} ({quest.unlockedCount}/{quest.totalFragments})
                  </Text>
                ))
              )}
            </View>
          ) : null}
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Identity</Text>
            <Text style={styles.sideValue}>Level {identity?.level || 1}</Text>
            <Text style={styles.sideMeta}>Title: {identityTitle}</Text>
            <View style={styles.sideVitalsRow}>
              <Text style={styles.sideMeta}>HP {phase2Stats.hp}</Text>
              <Text style={styles.sideMeta}>MP {phase2Stats.mp}</Text>
            </View>
          </View>
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Today</Text>
            <Text style={styles.sideValue}>{phase2Stats.momentum}</Text>
            <Text style={styles.sideMeta}>Consistency: {phase2Stats.consistency}</Text>
            <Text style={styles.sideMeta}>Vitality: {phase2Stats.vitality}</Text>
          </View>
          <View style={styles.sideBlock}>
            <Text style={styles.sideLabel}>Re-entry</Text>
            <Text style={styles.sideValue}>{isQuietMode ? 'Quiet' : 'Standard'}</Text>
            <Text style={styles.sideMeta}>
              {isQuietMode ? 'Lower friction mode' : 'Standard mode'}
            </Text>
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
            <Pressable
              style={styles.infoLink}
              onPress={() => setMercyInfoOpen((prev) => !prev)}
            >
              <Text style={styles.infoLinkText}>
                {mercyInfoOpen ? 'Hide' : 'What is this?'}
              </Text>
            </Pressable>
            {mercyInfoOpen ? (
              <View style={styles.mercyInfo}>
                <Text style={styles.mercyTitle}>Mercy</Text>
                <Text style={styles.mercyBullet}>- Mercy is a rare safety net for missed days.</Text>
                <Text style={styles.mercyBullet}>
                  - It prevents a small drop from becoming a spiral.
                </Text>
                <Text style={styles.mercyBullet}>
                  - It never deletes progress or identity.
                </Text>
                <Text style={styles.mercyFooter}>
                  You can ignore it. It activates only when needed.
                </Text>
              </View>
            ) : null}
          </View>
          </View>

          <View style={styles.centerPanel}>
            <View style={styles.centerRuneRing} pointerEvents="none" />
            <View style={styles.centerHeader}>
              <Text style={styles.centerTitle}>{activeTab.toUpperCase()}</Text>
            </View>

            <ScrollView
              style={styles.centerScroll}
              contentContainerStyle={styles.centerScrollContent}
            >
              <View style={styles.contentColumn}>{mainContent}</View>
            </ScrollView>
          </View>
        </View>
      ) : (
        loadingContent
      )}
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
  backgroundLogoTap: {
    position: 'absolute',
    right: -40,
    bottom: -30,
    width: 240,
    height: 240,
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
  adminToolbarButton: {
    marginLeft: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
  },
  adminToolbarButtonText: {
    color: '#9fd6ff',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  infoLink: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
  },
  infoLinkText: {
    color: '#9fd6ff',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  mercyInfo: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0b152a',
  },
  mercyTitle: {
    color: '#eaf4ff',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  mercyBullet: {
    color: '#c7e2ff',
    fontSize: 11,
    marginBottom: 4,
  },
  mercyFooter: {
    color: '#9bb3d6',
    fontSize: 11,
    marginTop: 6,
  },
  sideVitalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  statusDropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4e82',
    backgroundColor: '#0f1d3b',
    marginBottom: 12,
  },
  statusDropdownLabel: {
    color: '#8bd6ff',
    fontSize: FONT.sm,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusDropdownValue: {
    color: '#e9f4ff',
    fontSize: FONT.sm,
  },
  statusDropdownList: {
    borderWidth: 1,
    borderColor: '#2b4e82',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#0b162e',
    marginBottom: 12,
  },
  arcList: {
    gap: 12,
  },
  arcFeed: {
    gap: 10,
    marginBottom: 14,
  },
  arcFeedCard: {
    borderWidth: 1,
    borderColor: '#1f3865',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0c1429',
  },
  arcFeedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  arcFeedTitle: {
    color: '#f6c46a',
    fontSize: FONT.lg,
    fontWeight: '700',
  },
  arcFeedScope: {
    color: '#9dfbff',
    fontSize: FONT.xs,
    letterSpacing: 0.8,
  },
  arcFeedTheme: {
    color: '#cfeaff',
    fontSize: FONT.sm,
    marginBottom: 4,
  },
  challengeCardTag: {
    color: '#9fd6ff',
    fontSize: FONT.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  challengeHabitRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  challengeHabitChip: {
    borderWidth: 1,
    borderColor: '#2b4e82',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#0c1429',
  },
  challengeHabitChipActive: {
    borderColor: '#7bc7ff',
    backgroundColor: '#102244',
  },
  challengeHabitText: {
    color: '#c7e2ff',
    fontSize: FONT.sm,
    letterSpacing: 0.5,
  },
  challengeCard: {
    borderWidth: 1,
    borderColor: '#1f3865',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    backgroundColor: '#0a1226',
  },
  challengeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  challengeCardTitle: {
    color: '#f6c46a',
    fontSize: FONT.lg,
    fontWeight: '700',
  },
  challengeCardScope: {
    color: '#9dfbff',
    fontSize: FONT.xs,
    letterSpacing: 0.8,
  },
  challengeButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    justifyContent: 'flex-start',
  },
  challengeLogButton: {
    borderWidth: 1,
    borderColor: '#65c0ff',
    borderRadius: 12,
    backgroundColor: '#1a3c70',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  challengeLogButtonText: {
    color: '#fff',
    fontSize: FONT.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  challengeToggleButton: {
    borderWidth: 1,
    borderColor: '#7ad6ff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#122444',
  },
  challengeToggleButtonText: {
    color: '#c7e2ff',
    fontSize: FONT.sm,
    letterSpacing: 0.6,
  },
  challengeDeleteButton: {
    borderWidth: 1,
    borderColor: '#ff7070',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#20131d',
  },
  challengeDeleteButtonText: {
    color: '#ffb0b0',
    fontSize: FONT.sm,
    letterSpacing: 0.6,
  },
  challengeAcceptButton: {
    borderWidth: 1,
    borderColor: '#9ef5c2',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#12331c',
  },
  challengeAcceptButtonText: {
    color: '#b5ffd6',
    fontSize: FONT.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  arcCard: {
    borderWidth: 1,
    borderColor: '#2b4e82',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#0b162e',
  },
  arcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  arcTitle: {
    color: '#eaf4ff',
    fontSize: FONT.lg,
    fontWeight: '700',
  },
  arcTheme: {
    color: '#8bd6ff',
    fontSize: FONT.sm,
  },
  arcProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  arcProgressValue: {
    color: '#cfeaff',
    fontSize: FONT.sm,
  },
  arcProgressMeta: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
  },
  arcControlRow: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#132248',
    paddingTop: 10,
    gap: 6,
  },
  arcHint: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
  },
  arcButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  arcAcceptButton: {
    borderColor: '#6fd0ff',
    backgroundColor: '#122444',
  },
  arcLinkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  arcLinkButton: {
    borderColor: '#7bc7ff',
    backgroundColor: '#0c1732',
  },
  orientationPanel: {
    borderWidth: 1,
    borderColor: '#6fd0ff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    backgroundColor: '#0a1a33',
  },
  orientationSubtitle: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    marginBottom: 6,
  },
  orientationObjective: {
    color: '#eaf4ff',
    fontSize: FONT.lg,
    fontWeight: '600',
    marginBottom: 4,
  },
  orientationActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  orientationActionButton: {
    borderColor: '#2fa4ff',
    backgroundColor: '#12223c',
  },
  orientationIgnore: {
    marginTop: 0,
  },
  orientationMessage: {
    borderWidth: 1,
    borderColor: '#7bc7ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    backgroundColor: '#0b1630',
  },
  orientationMessageText: {
    color: '#eaf4ff',
    fontSize: FONT.md,
  },
  arcOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4, 8, 18, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  galleryOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4, 8, 18, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 55,
    padding: 24,
  },
  galleryModal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6fd0ff',
    backgroundColor: '#0c1732',
    padding: 20,
    gap: 10,
  },
  galleryModalTitle: {
    color: '#eaf4ff',
    fontSize: 18,
    fontWeight: '700',
  },
  galleryModalMeta: {
    color: '#9bb3d6',
    fontSize: 12,
  },
  galleryModalBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  galleryModalBadgeText: {
    color: '#eaf4ff',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  galleryModalBody: {
    color: '#c7e2ff',
    fontSize: 12,
    lineHeight: 18,
  },
  galleryModalCount: {
    color: '#f6c46a',
    fontSize: 12,
    fontWeight: '700',
  },
  adminPaletteOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4, 8, 18, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 70,
    padding: 24,
  },
  adminPaletteCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#7bc7ff',
    backgroundColor: '#0c1732',
    padding: 18,
    gap: 12,
  },
  adminPaletteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  adminPaletteTitle: {
    color: '#eaf4ff',
    fontSize: 16,
    fontWeight: '700',
  },
  adminPaletteClose: {
    color: '#9bb3d6',
    fontSize: 12,
  },
  adminPaletteInput: {
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#eaf4ff',
    backgroundColor: '#0a152c',
  },
  adminPaletteList: {
    maxHeight: 220,
  },
  adminPaletteItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    padding: 10,
    marginBottom: 8,
  },
  adminPaletteItemActive: {
    borderColor: '#7bc7ff',
    backgroundColor: '#102244',
  },
  adminPaletteItemText: {
    color: '#c7e2ff',
    fontSize: 12,
  },
  adminPaletteParams: {
    gap: 8,
  },
  adminPaletteMessage: {
    color: '#9fd6ff',
    fontSize: 12,
  },
  arcOverlayCard: {
    width: 320,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6fd0ff',
    backgroundColor: '#0c1732',
    padding: 20,
    gap: 10,
  },
  arcOverlayTitle: {
    color: '#8bd6ff',
    fontSize: FONT.xs,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  arcOverlayName: {
    color: ACCENT_GOLD,
    fontSize: FONT.xl,
    fontWeight: '700',
  },
  arcOverlayFragment: {
    color: '#eaf4ff',
    fontSize: FONT.sm,
    lineHeight: 20,
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
  primaryActionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#7bc7ff',
    backgroundColor: '#0b1a33',
    padding: 16,
    marginBottom: 12,
  },
  encounterCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#7bc7ff',
    backgroundColor: '#0b1a33',
    padding: 16,
    marginBottom: 12,
  },
  encounterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  encounterLabel: {
    color: '#9bb3d6',
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  encounterBadge: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
  },
  encounterBadgeText: {
    color: '#9fd6ff',
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  encounterTitle: {
    color: '#eaf4ff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  encounterHelper: {
    color: '#c7e2ff',
    fontSize: 12,
    marginBottom: 12,
  },
  collapseCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    padding: 12,
    marginBottom: 12,
  },
  collapseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  collapseTitle: {
    color: '#9fe1ff',
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  collapseAction: {
    color: '#9bb3d6',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  collapseBody: {
    marginTop: 12,
  },
  primaryActionLabel: {
    color: '#9bb3d6',
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  primaryActionTitle: {
    color: '#eaf4ff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  primaryActionHelper: {
    color: '#c7e2ff',
    fontSize: 12,
    marginBottom: 12,
  },
  primaryActionButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#79d2ff',
    backgroundColor: '#1e63b8',
  },
  primaryActionButtonText: {
    color: '#eaf4ff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.6,
  },
  noticeCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f5ca3',
    backgroundColor: '#0a152c',
    padding: 12,
    marginBottom: 12,
  },
  noticeTitle: {
    color: '#eaf4ff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  noticeSubtle: {
    color: '#9bb3d6',
    fontSize: 12,
    marginBottom: 8,
  },
  habitListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  habitCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0b152a',
    padding: 12,
  },
  habitCardPaused: {
    opacity: 0.6,
  },
  habitCardTitle: {
    color: '#eaf4ff',
    fontSize: 15,
    fontWeight: '700',
  },
  habitIconInline: {
    color: '#c7e2ff',
    fontSize: 13,
  },
  habitCardMeta: {
    color: '#9bb3d6',
    fontSize: 12,
    marginTop: 4,
  },
  habitProgressRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  habitProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#0a152c',
    borderWidth: 1,
    borderColor: '#1f3b66',
    overflow: 'hidden',
  },
  habitProgressFill: {
    height: '100%',
    backgroundColor: '#8ee3a1',
  },
  habitProgressText: {
    color: '#9ef5c2',
    fontSize: 11,
    fontWeight: '700',
  },
  habitQuickButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ea0ff',
    backgroundColor: '#12315a',
  },
  habitQuickButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
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
  heroVitals: {
    flexDirection: 'row',
    marginTop: 10,
  },
  expRow: {
    marginTop: 14,
  },
  expLabel: {
    color: '#9bb3d6',
    fontSize: FONT.sm,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  expTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#0b162d',
    borderWidth: 1,
    borderColor: '#2b4a78',
    overflow: 'hidden',
  },
  expFill: {
    height: '100%',
    backgroundColor: '#6fb0ff',
  },
  expToggle: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
  },
  expToggleActive: {
    borderColor: '#7bc7ff',
    backgroundColor: '#102244',
  },
  expToggleText: {
    color: '#9bb3d6',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  expToggleTextActive: {
    color: '#eaf4ff',
  },
  expNote: {
    color: '#9fd6ff',
    fontSize: 12,
    marginTop: 6,
  },
  heroVitalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#12264a',
    marginRight: 8,
  },
  heroVitalLabel: {
    color: '#9bb3d6',
    fontSize: FONT.xs,
    marginRight: 6,
    letterSpacing: 0.5,
  },
  heroVitalValue: {
    color: '#eaf4ff',
    fontWeight: '700',
    fontSize: FONT.sm,
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
  habitBlock: {
    marginBottom: 14,
    gap: 6,
  },
  habitActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  habitActionDetails: {
    flex: 1,
  },
  habitActionLabel: {
    color: '#9fd6ff',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  habitActionSummary: {
    color: '#c7e2ff',
    fontSize: 12,
    marginTop: 2,
  },
  habitActionCounter: {
    color: '#9ef5c2',
    fontSize: 11,
    marginTop: 2,
  },
  habitActionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ea0ff',
    backgroundColor: '#12315a',
  },
  habitActionButtonText: {
    color: '#ffffff',
    fontSize: FONT.md,
    fontWeight: '700',
    letterSpacing: 0.6,
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
  ritualRow: {
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

  panelSubtitle: {
    color: '#ffffff',
    fontSize: FONT.md,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 6,
    letterSpacing: 0.4,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gallerySeason: {
    marginTop: 12,
  },
  galleryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  galleryTitle: {
    color: '#eaf4ff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  galleryTime: {
    color: '#9bb3d6',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  galleryTheme: {
    color: '#9bb3d6',
    fontSize: 12,
    marginBottom: 10,
  },
  galleryLocked: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    padding: 12,
    marginBottom: 12,
  },
  galleryLockedText: {
    color: '#9bb3d6',
    fontSize: 12,
  },
  galleryCard: {
    width: '47%',
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#0a152c',
    padding: 12,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  galleryCardUnknown: {
    backgroundColor: '#0b1528',
    opacity: 0.9,
  },
  gallerySlotIndex: {
    color: '#9bb3d6',
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  galleryCardTitle: {
    color: '#eaf4ff',
    fontSize: 13,
    fontWeight: '700',
  },
  galleryCardRarity: {
    color: '#9fd6ff',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  galleryCardCount: {
    color: '#f6c46a',
    fontSize: 12,
    fontWeight: '700',
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

  adminGrid: {
    gap: 12,
  },

  helpTabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  helpTab: {
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#0a152c',
  },
  helpTabActive: {
    borderColor: '#7bc7ff',
    backgroundColor: '#102244',
  },
  helpTabText: {
    color: '#c7e2ff',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  helpTabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  helpCard: {
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#0a152c',
    marginBottom: 10,
  },
  turnstileContainer: {
    alignSelf: 'stretch',
    minHeight: 70,
    marginTop: 8,
    marginBottom: 4,
  },
});

