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
  getHabitEffortForName,
  deleteHabit,
} from '../db/db';

export default function StatusScreen() {
  const SHOW_TRUST_TESTS = true;
  const NAV_TABS = [
    'Tasks',
    'Inventory',
    'Shops',
    'Party',
    'Group',
    'Challenges',
    'Help',
  ];
  const STAT_KEYS = ['Strength', 'Endurance', 'Nutrition', 'Sleep', 'Focus', 'Mobility', 'Mood'];
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [habits, setHabits] = useState([]);
  const [habitId, setHabitId] = useState(null);
  const [lastAction, setLastAction] = useState('');
  const [inactivityDays, setInactivityDays] = useState(0);
  const [newHabitName, setNewHabitName] = useState('');
  const [effortNote] = useState('');
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
  const [activeTab, setActiveTab] = useState('Tasks');

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

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      await initDb();
      await getOrCreateIdentity();
      await touchLastActive();
      if (!alive) return;
      await refresh();
      setLoading(false);
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

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

  const isQuietMode = inactivityDays >= 3;

  async function handleLogEffort(customHabitId, customHabitName) {
    if (!habitId) return;
    const targetHabitId = customHabitId || habitId;
    const targetHabit = customHabitName
      ? { name: customHabitName, isActive: true }
      : selectedHabit;
    if (!targetHabit || !targetHabit.isActive) {
      setLastAction('Select an active habit.');
      return;
    }
    const note = effortNote.trim();
    const effortInfo = await getHabitEffortForName(targetHabit.name);
    const result = await logEffort({
      habitId: targetHabitId,
      effortValue: effortInfo.effort,
      note: note.length ? note : null,
    });
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
    setLastAction(`Habit created: ${created.name}`);
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

  const statScores = STAT_KEYS.reduce((acc, stat) => {
    acc[stat] = 0;
    return acc;
  }, {});

  const effortCounts = efforts.reduce((acc, effort) => {
    acc[effort.habitName] = (acc[effort.habitName] || 0) + 1;
    return acc;
  }, {});

  habits.forEach((habit) => {
    const tags = getHabitTags(habit.name);
    const base = habit.isActive ? 1 : 0;
    const recent = effortCounts[habit.name] || 0;
    tags.forEach((tag) => {
      statScores[tag] += base + recent;
    });
  });

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
          <View style={styles.statsWheel}>
            {STAT_KEYS.map((label) => (
              <View key={label} style={styles.statBadge}>
                <Text style={styles.statBadgeLabel}>{label}</Text>
                <Text style={styles.statBadgeValue}>{statScores[label]}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.subtle}>Stats reflect tagged habits + recent effort logs.</Text>
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
          <Text style={styles.subtle}>Mode: Guest (local-first)</Text>
          <Pressable
            style={styles.buttonGhost}
            onPress={() => setAccountMessage('Account linking is not enabled in this build.')}
          >
            <Text style={styles.buttonGhostText}>Link account (placeholder)</Text>
          </Pressable>
          {accountMessage ? <Text style={styles.subtle}>{accountMessage}</Text> : null}
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
          <Text style={styles.brandIcon}>LM</Text>
        </Pressable>
        <View style={styles.navRow}>
          {NAV_TABS.map((tab) => (
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
    height: 56,
    backgroundColor: '#0a1222',
    borderBottomWidth: 1,
    borderBottomColor: '#21406d',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  brandBox: {
    width: 38,
    height: 38,
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
    fontSize: 11,
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
  statsWheel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBadge: {
    width: '30%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b4a78',
    backgroundColor: '#0a152c',
    paddingVertical: 10,
    alignItems: 'center',
  },
  statBadgeLabel: {
    color: '#9fd0ff',
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  statBadgeValue: {
    color: '#eaf4ff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
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
  inputNote: {
    borderWidth: 1,
    borderColor: '#2b4a78',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eaf4ff',
    marginTop: 12,
    minHeight: 44,
    backgroundColor: '#0a152c',
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
});
