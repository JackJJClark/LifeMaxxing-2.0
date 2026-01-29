import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput, ScrollView } from 'react-native';
import {
  createHabit,
  createCombatEncounter,
  getInactivityDays,
  getMercyStatus,
  getLatestLockedChest,
  getOrCreateDefaultHabit,
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
  touchLastActive,
} from '../db/db';

export default function StatusScreen() {
  const SHOW_TRUST_TESTS = true;
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitId, setHabitId] = useState(null);
  const [lastAction, setLastAction] = useState('');
  const [inactivityDays, setInactivityDays] = useState(0);
  const [effortValue, setEffortValue] = useState(1);
  const [newHabitName, setNewHabitName] = useState('');
  const [effortNote, setEffortNote] = useState('');
  const [chests, setChests] = useState([]);
  const [items, setItems] = useState([]);
  const [efforts, setEfforts] = useState([]);
  const [effortFilter, setEffortFilter] = useState('all');
  const [evidence, setEvidence] = useState(null);
  const [combatChest, setCombatChest] = useState(null);
  const [combatMessage, setCombatMessage] = useState('');
  const [mercyStatus, setMercyStatus] = useState(null);
  const [accountMessage, setAccountMessage] = useState('');

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
    if (!habitId && habitList.length > 0) {
      const active = habitList.find((habit) => habit.isActive);
      setHabitId(active ? active.id : habitList[0].id);
    }
  }

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      await initDb();
      await getOrCreateIdentity();
      const habit = await getOrCreateDefaultHabit();
      await touchLastActive();
      if (!alive) return;
      setHabitId(habit.id);
      await refresh();
      setLoading(false);
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [effortFilter]);

  const selectedHabit = useMemo(
    () => habits.find((habit) => habit.id === habitId) || null,
    [habits, habitId]
  );

  const isQuietMode = inactivityDays >= 3;
  const effortOptions = isQuietMode ? [1] : [1, 2, 3, 5];

  useEffect(() => {
    if (isQuietMode && effortValue !== 1) {
      setEffortValue(1);
    }
  }, [isQuietMode, effortValue]);

  async function handleLogEffort() {
    if (!habitId) return;
    if (!selectedHabit || !selectedHabit.isActive) {
      setLastAction('Select an active habit.');
      return;
    }
    const note = effortNote.trim();
    const result = await logEffort({ habitId, effortValue, note: note.length ? note : null });
    let message = `Effort logged - chest ${result.rarity}`;
    if (result.mercyUsed) {
      message += ' (mercy)';
    }
    if (result.mercyBypass) {
      message += ' +1 unlocked';
    }
    setLastAction(message);
    setEffortNote('');
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

  async function handleCreateHabit() {
    const name = newHabitName.trim();
    if (!name) return;
    const created = await createHabit(name);
    setNewHabitName('');
    setHabitId(created.id);
    setLastAction(`Habit created: ${created.name}`);
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Lifemaxxing</Text>

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
          <Text style={styles.subtle}>Mercy recharges in {mercyStatus.cooldownDaysRemaining} days.</Text>
        ) : null}
      </View>

      {evidence ? (
        <View style={[styles.panel, styles.panelTight]}>
          <Text style={styles.panelTitle}>Evidence</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Total Effort</Text>
            <Text style={styles.statValue}>{evidence.totalEffort}</Text>
          </View>
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

      {isQuietMode ? (
        <View style={styles.panelQuiet}>
          <Text style={styles.panelTitle}>Re-entry</Text>
          <Text style={styles.quietText}>
            No backlog. A single small effort is enough to restart the loop.
          </Text>
          <Pressable style={styles.buttonQuiet} onPress={handleLogEffort}>
            <Text style={styles.buttonText}>Log 1 Effort</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Account</Text>
        <Text style={styles.subtle}>Mode: Guest (local-first)</Text>
        <Pressable
          style={styles.buttonGhost}
          onPress={() => setAccountMessage('Account linking is not enabled in this build.')}
        >
          <Text style={styles.buttonGhostText}>Link account (placeholder)</Text>
        </Pressable>
        {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
      </View>

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
                <Text style={styles.habitText}>{habit.name}</Text>
              </Pressable>
              <Pressable style={styles.habitToggle} onPress={() => handleToggleHabit(habit)}>
                <Text style={styles.habitToggleText}>{habit.isActive ? 'Active' : 'Paused'}</Text>
              </Pressable>
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

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Effort</Text>
        <Text style={styles.subtle}>Selected habit: {selectedHabit ? selectedHabit.name : 'None'}</Text>
        <View style={styles.filterRow}>
          {habits.map((habit) => (
            <Pressable
              key={habit.id}
              style={[
                styles.filterChip,
                habitId === habit.id && styles.filterChipSelected,
                !habit.isActive && styles.filterChipDisabled,
              ]}
              onPress={() => setHabitId(habit.id)}
            >
              <Text style={styles.filterText}>{habit.name}</Text>
            </Pressable>
          ))}
        </View>
        {isQuietMode ? (
          <Text style={styles.subtle}>Quiet mode: low effort defaults.</Text>
        ) : null}
        <View style={styles.effortRow}>
          {effortOptions.map((value) => (
            <Pressable
              key={value}
              style={[styles.effortChip, effortValue === value && styles.effortChipSelected]}
              onPress={() => setEffortValue(value)}
            >
              <Text style={styles.effortText}>{value}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.button} onPress={handleLogEffort}>
          <Text style={styles.buttonText}>Log Effort</Text>
        </Pressable>
        {!isQuietMode ? (
          <TextInput
            value={effortNote}
            onChangeText={setEffortNote}
            placeholder="Optional note"
            placeholderTextColor="#4b5563"
            style={styles.inputNote}
            multiline
          />
        ) : null}
        {lastAction ? <Text style={styles.subtle}>{lastAction}</Text> : null}
      </View>

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
                {effort.note ? (
                  <Text style={styles.effortNote}>Note: {effort.note}</Text>
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>

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

      {SHOW_TRUST_TESTS ? (
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingTop: 72,
    paddingHorizontal: 24,
    paddingBottom: 32,
    backgroundColor: '#0f1115',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#e5e7eb',
    marginBottom: 16,
    letterSpacing: 1.2,
  },
  panel: {
    backgroundColor: '#181c23',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2f3a',
  },
  panelTight: {
    paddingVertical: 12,
  },
  panelQuiet: {
    backgroundColor: '#121720',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2f3a',
  },
  menuStack: {
    backgroundColor: '#181c23',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2f3a',
  },
  menuHeader: {
    marginBottom: 12,
  },
  menuHint: {
    color: '#9aa4b2',
    fontSize: 12,
    marginTop: 4,
  },
  menuSection: {
    marginBottom: 12,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#2a2f3a',
    marginVertical: 8,
  },
  menuLabel: {
    color: '#cbd5f5',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  trustList: {
    marginTop: 8,
  },
  trustItem: {
    color: '#cbd5f5',
    fontSize: 12,
    marginBottom: 6,
  },
  panelTitle: {
    color: '#9aa4b2',
    fontSize: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  subtle: {
    color: '#9aa4b2',
    fontSize: 13,
    marginTop: 6,
  },
  muted: {
    color: '#9aa4b2',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonQuiet: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonSmall: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 16,
  },
  quietText: {
    color: '#cbd5f5',
    fontSize: 14,
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
    borderColor: '#2a2f3a',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10141b',
  },
  avatarText: {
    color: '#93c5fd',
    fontSize: 12,
    letterSpacing: 1.4,
  },
  heroStats: {
    marginLeft: 16,
  },
  heroLabel: {
    color: '#9aa4b2',
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  heroValue: {
    color: '#e5e7eb',
    fontSize: 36,
    fontWeight: '600',
    marginTop: 4,
  },
  heroSubtle: {
    color: '#9aa4b2',
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2f3a',
    marginVertical: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statLabel: {
    color: '#cbd5f5',
    fontSize: 14,
    letterSpacing: 0.4,
  },
  statValue: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
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
    borderColor: '#2a2f3a',
    backgroundColor: '#10141b',
  },
  habitChipSelected: {
    borderColor: '#60a5fa',
    backgroundColor: '#0b1b33',
  },
  habitChipDisabled: {
    opacity: 0.5,
  },
  habitText: {
    color: '#e5e7eb',
    fontSize: 15,
  },
  habitToggle: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#2a2f3a',
  },
  habitToggleText: {
    color: '#cbd5f5',
    fontSize: 12,
  },
  habitInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2a2f3a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    marginRight: 10,
    backgroundColor: '#10141b',
  },
  inputNote: {
    borderWidth: 1,
    borderColor: '#2a2f3a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    marginTop: 12,
    minHeight: 44,
    backgroundColor: '#10141b',
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
    borderColor: '#2a2f3a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#10141b',
  },
  effortChipSelected: {
    borderColor: '#60a5fa',
    backgroundColor: '#0b1b33',
  },
  effortText: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
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
    borderColor: '#3b82f6',
  },
  buttonGhostText: {
    color: '#93c5fd',
    fontWeight: '600',
    fontSize: 16,
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
    borderColor: '#2a2f3a',
    backgroundColor: '#10141b',
    padding: 12,
  },
  gridTitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  gridSubtle: {
    color: '#9aa4b2',
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
    borderColor: '#2a2f3a',
    backgroundColor: '#10141b',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  filterChipSelected: {
    borderColor: '#60a5fa',
    backgroundColor: '#0b1b33',
  },
  filterChipDisabled: {
    opacity: 0.5,
  },
  filterText: {
    color: '#cbd5f5',
    fontSize: 12,
  },
  effortRowCompact: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2f3a',
  },
  effortTitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
  },
  effortMeta: {
    color: '#9aa4b2',
    fontSize: 12,
    marginTop: 2,
  },
  effortNote: {
    color: '#cbd5f5',
    fontSize: 12,
    marginTop: 4,
  },
});
