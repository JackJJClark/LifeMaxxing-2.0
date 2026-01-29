import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView, Platform, Image } from 'react-native';
import { ADMIN_EMAILS, isAdminEmail } from '../config';
import { supabase } from '../services/supabase';
import {
  signInWithPassword,
  signOut,
  saveBackup,
  loadBackup,
  listBackups,
  fetchBackupForUserId,
  loadBackupForUserId,
} from '../services/backup';
import {
  createHabit,
  createCombatEncounter,
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
  logEffort,
  resolveCombatEncounter,
  setHabitActive,
  getHabitEffortForName,
  deleteHabit,
} from '../db/db';

export default function StatusScreen() {
  const SHOW_TRUST_TESTS = true;
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
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminBackups, setAdminBackups] = useState([]);
  const [adminFilter, setAdminFilter] = useState('');
  const [adminSelectedUserId, setAdminSelectedUserId] = useState('');
  const [adminSummary, setAdminSummary] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminLog, setAdminLog] = useState([]);
  const [activeTab, setActiveTab] = useState('Tasks');

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
    if (!authEnabled) {
      setAuthStatus('disabled');
      setAuthEmail('');
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setAuthStatus('signed_out');
      setAuthEmail('');
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
      return;
    }
    const sessionEmail = data.session.user?.email || '';
    setAuthStatus('signed_in');
    setAuthEmail(sessionEmail);
    if (adminEnabled && isAdminEmail(sessionEmail)) {
      setAdminStatus('signed_in');
    } else {
      setAdminStatus(adminEnabled ? 'signed_out' : 'disabled');
    }
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
      if (alive) setEffortInfo(info);
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

  const isQuietMode = inactivityDays >= 3;

  async function handleLogEffort(customHabitId, customHabitName) {
    const targetHabitId = customHabitId || habitId;
    if (!targetHabitId) return;
    const targetHabit = customHabitName
      ? { name: customHabitName, isActive: true }
      : selectedHabit;
    if (!targetHabit || !targetHabit.isActive) {
      return;
    }
    const effortInfo = await getHabitEffortForName(targetHabit.name);
    const result = await logEffort({
      habitId: targetHabitId,
      effortValue: effortInfo.effort,
      note: null,
    });
    await refresh();
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
    if (!authEnabled) {
      setAccountMessage('Account linking is not enabled.');
      return;
    }
    setAdminBusy(true);
    setAccountMessage('');
    setAdminMessage('');
    try {
      await signInWithPassword(loginEmail.trim(), loginPassword);
      await refreshAuthStatus();
      setAccountMessage('Signed in.');
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
      const record = await saveBackup();
      const message = `Backup saved (${new Date(record.updated_at).toLocaleString()}).`;
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
      const record = await loadBackup();
      await refresh();
      const message = `Backup loaded (${new Date(record.updated_at).toLocaleString()}).`;
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
      setAdminSummary({
        updatedAt: data.updated_at,
        identityLevel: payload.identity?.level || 0,
        totalEffort: payload.identity?.totalEffortUnits || 0,
        habits: payload.habits?.length || 0,
        efforts: payload.effortLogs?.length || 0,
        chests: payload.chests?.length || 0,
        items: payload.items?.length || 0,
        payloadBytes,
      });
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
      const record = await loadBackupForUserId(adminSelectedUserId);
      await refresh();
      setAdminMessage(`Loaded backup (${new Date(record.updated_at).toLocaleString()}).`);
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

  if (loading || !snapshot) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Lifemaxxing</Text>
        <Text style={styles.muted}>Preparing identity...</Text>
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
            Re-entry mode: {isQuietMode ? 'quiet' : 'standard'} ({inactivityDays} days)
          </Text>
          <Text style={styles.subtle}>
            Active habits: {activeHabits} - Paused: {pausedHabits}
          </Text>
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
            </View>
          ) : null}
          {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
        </View>
      ) : null}

      {showAdmin ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Admin Dashboard</Text>
          {adminStatus === 'disabled' ? (
            <Text style={styles.subtle}>Admin tools are disabled.</Text>
          ) : null}
          {adminStatus === 'signed_out' ? (
            <Text style={styles.subtle}>Sign in via Help > Link account to access admin tools.</Text>
          ) : null}
          {adminStatus === 'signed_in' ? (
            <>
              <Text style={styles.subtle}>Backups (Supabase)</Text>
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
                  <Text style={styles.gridTitle}>{chest.rarity.toUpperCase()}</Text>
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
    backgroundColor: '#05070f',
  },
  appFrameGlow: {
    position: 'absolute',
    top: -80,
    left: -60,
    right: -60,
    height: 240,
    backgroundColor: '#0b1a36',
    opacity: 0.5,
  },
  topBar: {
    height: 80,
    backgroundColor: '#0a1222',
    borderBottomWidth: 1,
    borderBottomColor: '#21406d',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  brandBox: {
    width: 56,
    height: 56,
    borderRadius: 7,
    backgroundColor: '#0a152c',
    borderWidth: 1,
    borderColor: '#6fb0ff',
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
    width: 44,
    height: 44,
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
    backgroundColor: '#102244',
    borderWidth: 1,
    borderColor: '#8ac2ff',
  },
  navText: {
    color: '#c7e2ff',
    fontSize: 12,
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
    backgroundColor: '#091324',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f3b66',
    padding: 14,
  },
  sideBlock: {
    borderWidth: 1,
    borderColor: '#203a5f',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#0b172c',
  },
  sideLabel: {
    color: '#7fb3ff',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sideValue: {
    color: '#e9f4ff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sideMeta: {
    color: '#9bb3d6',
    fontSize: 12,
  },
  centerPanel: {
    flex: 1,
    backgroundColor: '#0a1222',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#21406d',
    overflow: 'hidden',
  },
  centerHeader: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#223b60',
    backgroundColor: '#0b1931',
  },
  centerTitle: {
    color: '#d2e7ff',
    fontSize: 13,
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
    borderColor: '#2a4775',
    backgroundColor: '#0a1426',
  },
  centerTabActive: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8ac2ff',
    backgroundColor: '#11264c',
  },
  centerTabText: {
    color: '#c7e2ff',
    fontSize: 11,
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c7e2ff',
    marginBottom: 12,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: '#0b162d',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1f3b66',
    shadowColor: '#6fb0ff',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  panelTight: {
    paddingVertical: 10,
  },
  panelQuiet: {
    backgroundColor: '#0a152c',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1f3b66',
    shadowColor: '#6fb0ff',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  menuStack: {
    backgroundColor: '#0b162d',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1f3b66',
    shadowColor: '#6fb0ff',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  menuHeader: {
    marginBottom: 12,
  },
  menuHint: {
    color: '#9bb3d6',
    fontSize: 12,
    marginTop: 4,
  },
  menuSection: {
    marginBottom: 12,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#1f3b66',
    marginVertical: 8,
  },
  menuLabel: {
    color: '#9fd0ff',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  panelTitle: {
    color: '#9fd0ff',
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  subtle: {
    color: '#9bb3d6',
    fontSize: 12,
    marginTop: 6,
  },
  muted: {
    color: '#9bb3d6',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#1b5fa7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6fb0ff',
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
    backgroundColor: '#1b5fa7',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6fb0ff',
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
    borderColor: '#2b4a78',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a152c',
  },
  avatarText: {
    color: '#90c9ff',
    fontSize: 12,
    letterSpacing: 1.4,
  },
  heroStats: {
    marginLeft: 16,
  },
  heroLabel: {
    color: '#9bb3d6',
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroValue: {
    color: '#eaf4ff',
    fontSize: 36,
    fontWeight: '700',
    marginTop: 4,
  },
  heroSubtle: {
    color: '#9bb3d6',
    fontSize: 13,
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
    fontSize: 14,
    letterSpacing: 0.4,
  },
  statValue: {
    color: '#eaf4ff',
    fontSize: 14,
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
    marginBottom: 12,
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
    fontSize: 14,
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
});
