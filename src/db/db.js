import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'lifemaxing.db';
const isWeb = Platform.OS === 'web';
const db = isWeb ? null : SQLite.openDatabase(DB_NAME);
const WEB_STORE_KEY = 'lifemaxing.webstore.v1';

const webStore = {
  identity: null,
  habits: [],
  effortLogs: [],
  chests: [],
  items: [],
  chestRewards: [],
  combatEncounters: [],
  mercyEvents: [],
  habitEffortCache: {},
};

function canUseWebStorage() {
  return typeof window !== 'undefined' && window.localStorage;
}

function loadWebStore() {
  if (!isWeb || !canUseWebStorage()) return;
  try {
    const raw = window.localStorage.getItem(WEB_STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    webStore.identity = data.identity || null;
    webStore.habits = Array.isArray(data.habits) ? data.habits : [];
    webStore.effortLogs = Array.isArray(data.effortLogs) ? data.effortLogs : [];
    webStore.chests = Array.isArray(data.chests) ? data.chests : [];
    webStore.items = Array.isArray(data.items) ? data.items : [];
    webStore.chestRewards = Array.isArray(data.chestRewards) ? data.chestRewards : [];
    webStore.combatEncounters = Array.isArray(data.combatEncounters)
      ? data.combatEncounters
      : [];
    webStore.mercyEvents = Array.isArray(data.mercyEvents) ? data.mercyEvents : [];
    webStore.habitEffortCache =
      data.habitEffortCache && typeof data.habitEffortCache === 'object'
        ? data.habitEffortCache
        : {};
  } catch (error) {
    // Ignore storage errors.
  }
}

function saveWebStore() {
  if (!isWeb || !canUseWebStorage()) return;
  try {
    const payload = {
      identity: webStore.identity,
      habits: webStore.habits,
      effortLogs: webStore.effortLogs,
      chests: webStore.chests,
      items: webStore.items,
      chestRewards: webStore.chestRewards,
      combatEncounters: webStore.combatEncounters,
      mercyEvents: webStore.mercyEvents,
      habitEffortCache: webStore.habitEffortCache,
    };
    window.localStorage.setItem(WEB_STORE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore storage errors.
  }
}

const EFFORT_UNITS_PER_LEVEL = 10;
const CONSISTENCY_WINDOW_DAYS = 7;
const ITEM_TYPES = ['sigil', 'token', 'relic', 'glyph', 'thread'];
const ITEM_MODIFIERS = ['calm', 'focus', 'resolve', 'patience', 'clarity', 'grit'];
const MERCY_COOLDOWN_DAYS = 30;
const MERCY_MIN_EFFORT_UNITS = 20;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function execSql(sql, params = []) {
  if (isWeb) {
    throw new Error('execSql should not be called on web');
  }
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result),
        (_, error) => {
          reject(error);
          return false;
        }
      );
    });
  });
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateModifiers() {
  const count = Math.random() < 0.7 ? 1 : 2;
  const picked = new Set();
  while (picked.size < count) {
    picked.add(randomFrom(ITEM_MODIFIERS));
  }
  return Array.from(picked).map((value) => `+${value}`);
}

function generateItem(rarity) {
  const type = randomFrom(ITEM_TYPES);
  const modifiers = generateModifiers();
  const tag = rarity === 'mythic' ? 'radiant' : rarity === 'rare' ? 'glow' : 'quiet';
  return { type, modifiers, tag };
}

function bumpRarity(rarity) {
  const tiers = ['common', 'uncommon', 'rare', 'mythic'];
  const index = tiers.indexOf(rarity);
  if (index === -1) return rarity;
  return tiers[Math.min(index + 1, tiers.length - 1)];
}

async function getLastMercyAt() {
  if (isWeb) {
    if (webStore.mercyEvents.length === 0) return null;
    return new Date(webStore.mercyEvents[webStore.mercyEvents.length - 1].createdAt);
  }
  const result = await execSql('SELECT createdAt FROM mercy_events ORDER BY createdAt DESC LIMIT 1');
  if (result.rows.length === 0) return null;
  return new Date(result.rows.item(0).createdAt);
}

function daysBetween(a, b) {
  const diffMs = a.getTime() - b.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function canUseMercy(inactivityDays) {
  if (inactivityDays < 7) return { eligible: false, cooldownDaysRemaining: 0 };
  let totalEffortUnits = 0;
  if (isWeb) {
    totalEffortUnits = webStore.identity ? webStore.identity.totalEffortUnits : 0;
  } else {
    const identityResult = await execSql('SELECT totalEffortUnits FROM identity LIMIT 1');
    if (identityResult.rows.length === 0) return { eligible: false, cooldownDaysRemaining: 0 };
    totalEffortUnits = identityResult.rows.item(0).totalEffortUnits || 0;
  }
  if (totalEffortUnits < MERCY_MIN_EFFORT_UNITS) {
    return { eligible: false, cooldownDaysRemaining: 0 };
  }

  const lastMercyAt = await getLastMercyAt();
  if (!lastMercyAt) return { eligible: true, cooldownDaysRemaining: 0 };
  const daysSince = daysBetween(new Date(), lastMercyAt);
  if (daysSince >= MERCY_COOLDOWN_DAYS) {
    return { eligible: true, cooldownDaysRemaining: 0 };
  }
  return { eligible: false, cooldownDaysRemaining: MERCY_COOLDOWN_DAYS - daysSince };
}

async function applyMercyIfEligible(rarity, inactivityDays) {
  const mercy = await canUseMercy(inactivityDays);
  if (!mercy.eligible) {
    return { rarity, mercyUsed: false, bypassUnlock: false };
  }
  const boosted = bumpRarity(rarity);
  const bypassUnlock = inactivityDays >= 14;
  if (isWeb) {
    webStore.mercyEvents.push({
      id: makeId('mercy'),
      reason: 'inactivity_boost',
      createdAt: nowIso(),
    });
  } else {
    await execSql('INSERT INTO mercy_events (id, reason, createdAt) VALUES (?, ?, ?)', [
      makeId('mercy'),
      'inactivity_boost',
      nowIso(),
    ]);
  }
  return { rarity: boosted, mercyUsed: true, bypassUnlock };
}

const HABIT_PREVALENCE = [
  {
    key: 'exercise',
    keywords: ['gym', 'lift', 'strength', 'weights', 'workout', 'exercise', 'cardio', 'run', 'cycle'],
    prevalence: 47.3,
    source: 'cdc_aerobic_2022',
  },
  {
    key: 'sleep',
    keywords: ['sleep', 'bed', 'rest'],
    prevalence: 65.0,
    source: 'cdc_sleep_2020',
  },
  {
    key: 'water',
    keywords: ['water', 'hydrate', 'hydration'],
    prevalence: 81.4,
    source: 'nhanes_water_2011_2014',
  },
  {
    key: 'meditation',
    keywords: ['meditate', 'meditation', 'mindfulness'],
    prevalence: 14.2,
    source: 'nccih_meditation_2017',
  },
  {
    key: 'yoga',
    keywords: ['yoga'],
    prevalence: 14.3,
    source: 'cdc_yoga_2017',
  },
  {
    key: 'vegetables',
    keywords: ['vegetable', 'veggies', 'greens', 'salad'],
    prevalence: 10.0,
    source: 'cdc_fruit_veg_2019',
  },
  {
    key: 'fruit',
    keywords: ['fruit', 'berries', 'apple', 'banana'],
    prevalence: 12.3,
    source: 'cdc_fruit_veg_2019',
  },
];

function normalizeHabitKey(name) {
  return name.trim().toLowerCase();
}

function effortFromPrevalence(prevalence) {
  if (prevalence >= 80) return 1;
  if (prevalence >= 65) return 2;
  if (prevalence >= 50) return 3;
  if (prevalence >= 35) return 4;
  if (prevalence >= 25) return 5;
  if (prevalence >= 15) return 6;
  if (prevalence >= 8) return 7;
  if (prevalence >= 4) return 8;
  if (prevalence >= 1) return 9;
  return 10;
}

function matchPrevalence(habitName) {
  const text = normalizeHabitKey(habitName);
  for (const entry of HABIT_PREVALENCE) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) {
      return entry;
    }
  }
  return { prevalence: 30, source: 'default_estimate' };
}

export async function initDb() {
  if (isWeb) {
    loadWebStore();
    return;
  }
  await execSql('PRAGMA foreign_keys = ON');

  await execSql(
    `CREATE TABLE IF NOT EXISTS identity (
      id TEXT PRIMARY KEY NOT NULL,
      level INTEGER NOT NULL,
      totalEffortUnits INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      lastActiveAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      isActive INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS effort_logs (
      id TEXT PRIMARY KEY NOT NULL,
      habitId TEXT NOT NULL,
      effortValue INTEGER NOT NULL,
      note TEXT,
      timestamp TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (habitId) REFERENCES habits (id)
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS chests (
      id TEXT PRIMARY KEY NOT NULL,
      rarity TEXT NOT NULL,
      earnedAt TEXT NOT NULL,
      unlockedRewardCount INTEGER NOT NULL DEFAULT 0
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      modifiersJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS chest_rewards (
      id TEXT PRIMARY KEY NOT NULL,
      chestId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      locked INTEGER NOT NULL,
      FOREIGN KEY (chestId) REFERENCES chests (id),
      FOREIGN KEY (itemId) REFERENCES items (id)
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS combat_encounters (
      id TEXT PRIMARY KEY NOT NULL,
      chestId TEXT NOT NULL,
      difficultyTier TEXT NOT NULL,
      completed INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (chestId) REFERENCES chests (id)
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS mercy_events (
      id TEXT PRIMARY KEY NOT NULL,
      reason TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS habit_effort_cache (
      habitKey TEXT PRIMARY KEY NOT NULL,
      effort INTEGER NOT NULL,
      prevalence REAL,
      source TEXT,
      updatedAt TEXT NOT NULL
    )`
  );
}

export async function getHabitEffortForName(habitName) {
  const habitKey = normalizeHabitKey(habitName);
  if (!habitKey) return { effort: 5, prevalence: 30, source: 'default_estimate' };

  if (isWeb) {
    const cached = webStore.habitEffortCache[habitKey];
    if (cached) return cached;
    const matched = matchPrevalence(habitName);
    const effort = effortFromPrevalence(matched.prevalence);
    const record = {
      effort,
      prevalence: matched.prevalence,
      source: matched.source,
      updatedAt: nowIso(),
    };
    webStore.habitEffortCache[habitKey] = record;
    return record;
  }

  const result = await execSql(
    'SELECT effort, prevalence, source, updatedAt FROM habit_effort_cache WHERE habitKey = ? LIMIT 1',
    [habitKey]
  );
  if (result.rows.length > 0) {
    return result.rows.item(0);
  }

  const matched = matchPrevalence(habitName);
  const effort = effortFromPrevalence(matched.prevalence);
  const record = {
    effort,
    prevalence: matched.prevalence,
    source: matched.source,
    updatedAt: nowIso(),
  };
  await execSql(
    'INSERT INTO habit_effort_cache (habitKey, effort, prevalence, source, updatedAt) VALUES (?, ?, ?, ?, ?)',
    [habitKey, record.effort, record.prevalence, record.source, record.updatedAt]
  );
  return record;
}

export async function getOrCreateIdentity() {
  if (isWeb) {
    if (webStore.identity) return webStore.identity;
    const id = makeId('identity');
    const createdAt = nowIso();
    webStore.identity = {
      id,
      level: 1,
      totalEffortUnits: 0,
      createdAt,
      lastActiveAt: createdAt,
    };
    saveWebStore();
    return webStore.identity;
  }
  const result = await execSql('SELECT * FROM identity LIMIT 1');
  if (result.rows.length > 0) {
    return result.rows.item(0);
  }

  const id = makeId('identity');
  const createdAt = nowIso();
  await execSql(
    'INSERT INTO identity (id, level, totalEffortUnits, createdAt, lastActiveAt) VALUES (?, ?, ?, ?, ?)',
    [id, 1, 0, createdAt, createdAt]
  );

  const created = await execSql('SELECT * FROM identity LIMIT 1');
  return created.rows.item(0);
}

export async function touchLastActive() {
  const timestamp = nowIso();
  if (isWeb) {
    if (webStore.identity) {
      webStore.identity.lastActiveAt = timestamp;
    }
    saveWebStore();
    return;
  }
  await execSql('UPDATE identity SET lastActiveAt = ? WHERE id IN (SELECT id FROM identity LIMIT 1)', [timestamp]);
}

export async function getInactivityDays() {
  if (isWeb) {
    const lastEffortAt = webStore.effortLogs.length
      ? webStore.effortLogs[webStore.effortLogs.length - 1].timestamp
      : null;
    const reference = lastEffortAt || webStore.identity?.createdAt || null;
    if (!reference) return 0;
    const diffMs = Date.now() - new Date(reference).getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }
  const lastEffortResult = await execSql(
    'SELECT timestamp FROM effort_logs ORDER BY timestamp DESC LIMIT 1'
  );
  const lastEffortAt = lastEffortResult.rows.length
    ? lastEffortResult.rows.item(0).timestamp
    : null;
  let reference = lastEffortAt;
  if (!reference) {
    const identityResult = await execSql('SELECT createdAt FROM identity LIMIT 1');
    reference = identityResult.rows.length ? identityResult.rows.item(0).createdAt : null;
  }
  if (!reference) return 0;
  const diffMs = Date.now() - new Date(reference).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export async function getMercyStatus(inactivityDays) {
  return canUseMercy(inactivityDays);
}

export async function getOrCreateDefaultHabit() {
  if (isWeb) {
    const existing = webStore.habits.find((habit) => habit.name === 'General');
    if (existing) return existing;
    const id = makeId('habit');
    const createdAt = nowIso();
    const habit = { id, name: 'General', isActive: true, createdAt };
    webStore.habits.push(habit);
    saveWebStore();
    return habit;
  }
  const result = await execSql('SELECT * FROM habits WHERE name = ? LIMIT 1', ['General']);
  if (result.rows.length > 0) return result.rows.item(0);

  const id = makeId('habit');
  const createdAt = nowIso();
  await execSql(
    'INSERT INTO habits (id, name, isActive, createdAt) VALUES (?, ?, ?, ?)',
    [id, 'General', 1, createdAt]
  );

  const created = await execSql('SELECT * FROM habits WHERE id = ?', [id]);
  return created.rows.item(0);
}

export async function listHabits() {
  if (isWeb) {
    return [...webStore.habits];
  }
  const result = await execSql('SELECT * FROM habits ORDER BY createdAt ASC');
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    items.push(result.rows.item(i));
  }
  return items;
}

export async function createHabit(name) {
  if (isWeb) {
    const id = makeId('habit');
    const createdAt = nowIso();
    const habit = { id, name, isActive: true, createdAt };
    webStore.habits.push(habit);
    saveWebStore();
    return habit;
  }
  const id = makeId('habit');
  const createdAt = nowIso();
  await execSql(
    'INSERT INTO habits (id, name, isActive, createdAt) VALUES (?, ?, ?, ?)',
    [id, name, 1, createdAt]
  );
  const created = await execSql('SELECT * FROM habits WHERE id = ?', [id]);
  return created.rows.item(0);
}

export async function setHabitActive(habitId, isActive) {
  if (isWeb) {
    const habit = webStore.habits.find((item) => item.id === habitId);
    if (habit) habit.isActive = !!isActive;
    saveWebStore();
    return;
  }
  await execSql('UPDATE habits SET isActive = ? WHERE id = ?', [isActive ? 1 : 0, habitId]);
}

export async function deleteHabit(habitId) {
  if (isWeb) {
    webStore.effortLogs = webStore.effortLogs.filter((log) => log.habitId !== habitId);
    webStore.habits = webStore.habits.filter((habit) => habit.id !== habitId);
    saveWebStore();
    return;
  }
  await execSql('DELETE FROM effort_logs WHERE habitId = ?', [habitId]);
  await execSql('DELETE FROM habits WHERE id = ?', [habitId]);
}

async function createItemRecord(item) {
  if (isWeb) {
    const id = makeId('item');
    const createdAt = nowIso();
    webStore.items.push({
      id,
      type: item.type,
      modifiersJson: JSON.stringify({ modifiers: item.modifiers, tag: item.tag }),
      createdAt,
    });
    return id;
  }
  const id = makeId('item');
  const createdAt = nowIso();
  await execSql(
    'INSERT INTO items (id, type, modifiersJson, createdAt) VALUES (?, ?, ?, ?)',
    [id, item.type, JSON.stringify({ modifiers: item.modifiers, tag: item.tag }), createdAt]
  );
  return id;
}

async function createChestRewards(chestId, rarity) {
  const rewardCount =
    rarity === 'mythic'
      ? 3
      : rarity === 'rare'
      ? 2
      : rarity === 'uncommon'
      ? Math.random() < 0.5
        ? 1
        : 2
      : 1;

  for (let i = 0; i < rewardCount; i += 1) {
    const item = generateItem(rarity);
    const itemId = await createItemRecord(item);
    const rewardId = makeId('reward');
    if (isWeb) {
      webStore.chestRewards.push({
        id: rewardId,
        chestId,
        itemId,
        locked: true,
      });
    } else {
      await execSql(
        'INSERT INTO chest_rewards (id, chestId, itemId, locked) VALUES (?, ?, ?, 1)',
        [rewardId, chestId, itemId]
      );
    }
  }
}

async function getConsistencyScore() {
  const since = new Date();
  since.setDate(since.getDate() - CONSISTENCY_WINDOW_DAYS);
  if (isWeb) {
    const activeDays = new Set(
      webStore.effortLogs
        .filter((log) => new Date(log.timestamp) >= since)
        .map((log) => log.timestamp.slice(0, 10))
    );
    return activeDays.size;
  }
  const result = await execSql(
    'SELECT COUNT(DISTINCT DATE(timestamp)) as count FROM effort_logs WHERE timestamp >= ?',
    [since.toISOString()]
  );
  return result.rows.item(0).count || 0;
}

function rarityFromConsistency(count) {
  if (count >= 7) return 'mythic';
  if (count >= 5) return 'rare';
  if (count >= 3) return 'uncommon';
  return 'common';
}

async function fetchAllRows(sql, params = []) {
  const result = await execSql(sql, params);
  const rows = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    rows.push(result.rows.item(i));
  }
  return rows;
}

async function updateIdentityTotals(effortValue) {
  if (isWeb) {
    if (!webStore.identity) return;
    const nextTotal = webStore.identity.totalEffortUnits + effortValue;
    const computedLevel = Math.floor(nextTotal / EFFORT_UNITS_PER_LEVEL) + 1;
    webStore.identity.totalEffortUnits = nextTotal;
    webStore.identity.level = Math.max(webStore.identity.level, computedLevel);
    webStore.identity.lastActiveAt = nowIso();
    return;
  }
  const result = await execSql('SELECT id, totalEffortUnits, level FROM identity LIMIT 1');
  if (result.rows.length === 0) return;

  const identity = result.rows.item(0);
  const nextTotal = identity.totalEffortUnits + effortValue;
  const computedLevel = Math.floor(nextTotal / EFFORT_UNITS_PER_LEVEL) + 1;
  const nextLevel = Math.max(identity.level, computedLevel);

  await execSql(
    'UPDATE identity SET totalEffortUnits = ?, level = ?, lastActiveAt = ? WHERE id = ?',
    [nextTotal, nextLevel, nowIso(), identity.id]
  );
}

export async function logEffort({ habitId, effortValue, note }) {
  const id = makeId('effort');
  const timestamp = nowIso();
  const inactivityDays = await getInactivityDays();

  if (isWeb) {
    webStore.effortLogs.push({
      id,
      habitId,
      effortValue,
      note: note || null,
      timestamp,
      createdAt: timestamp,
    });
  } else {
    await execSql(
      'INSERT INTO effort_logs (id, habitId, effortValue, note, timestamp, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, habitId, effortValue, note || null, timestamp, timestamp]
    );
  }

  await updateIdentityTotals(effortValue);

  const consistency = await getConsistencyScore();
  const chestId = makeId('chest');
  const baseRarity = rarityFromConsistency(consistency);
  const mercy = await applyMercyIfEligible(baseRarity, inactivityDays);
  const rarity = mercy.rarity;
  if (isWeb) {
    webStore.chests.push({
      id: chestId,
      rarity,
      earnedAt: timestamp,
      unlockedRewardCount: 0,
    });
  } else {
    await execSql(
      'INSERT INTO chests (id, rarity, earnedAt, unlockedRewardCount) VALUES (?, ?, ?, 0)',
      [chestId, rarity, timestamp]
    );
  }
  await createChestRewards(chestId, rarity);
  if (mercy.bypassUnlock) {
    if (isWeb) {
      const reward = webStore.chestRewards.find(
        (item) => item.chestId === chestId && item.locked
      );
      if (reward) {
        reward.locked = false;
        const chest = webStore.chests.find((item) => item.id === chestId);
        if (chest) chest.unlockedRewardCount += 1;
      }
    } else {
      const reward = await execSql(
        'SELECT id FROM chest_rewards WHERE chestId = ? AND locked = 1 LIMIT 1',
        [chestId]
      );
      if (reward.rows.length > 0) {
        const rewardId = reward.rows.item(0).id;
        await execSql('UPDATE chest_rewards SET locked = 0 WHERE id = ?', [rewardId]);
        await execSql(
          'UPDATE chests SET unlockedRewardCount = unlockedRewardCount + 1 WHERE id = ?',
          [chestId]
        );
      }
    }
  }

  if (isWeb) saveWebStore();
  return { effortId: id, chestId, rarity, mercyUsed: mercy.mercyUsed, mercyBypass: mercy.bypassUnlock };
}

export async function listChests(limit = 5) {
  if (isWeb) {
    const sorted = [...webStore.chests].sort(
      (a, b) => new Date(b.earnedAt) - new Date(a.earnedAt)
    );
    return sorted.slice(0, limit).map((chest) => {
      const rewards = webStore.chestRewards.filter((item) => item.chestId === chest.id);
      const locked = rewards.filter((item) => item.locked);
      return {
        id: chest.id,
        rarity: chest.rarity,
        earnedAt: chest.earnedAt,
        unlockedRewardCount: chest.unlockedRewardCount,
        rewardCount: rewards.length,
        lockedCount: locked.length,
      };
    });
  }
  const result = await execSql(
    `SELECT c.id, c.rarity, c.earnedAt, c.unlockedRewardCount,
      (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id) as rewardCount,
      (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id AND cr.locked = 1) as lockedCount
     FROM chests c
     ORDER BY c.earnedAt DESC
     LIMIT ?`,
    [limit]
  );
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    items.push(result.rows.item(i));
  }
  return items;
}

export async function listItems(limit = 20) {
  if (isWeb) {
    const items = webStore.items
      .map((item) => {
        const reward = webStore.chestRewards.find((cr) => cr.itemId === item.id);
        if (!reward) return null;
        const chest = webStore.chests.find((c) => c.id === reward.chestId);
        if (!chest) return null;
        return {
          id: item.id,
          type: item.type,
          modifiersJson: item.modifiersJson,
          locked: reward.locked,
          chestId: reward.chestId,
          rarity: chest.rarity,
          earnedAt: chest.earnedAt,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
    return items.slice(0, limit);
  }
  const result = await execSql(
    `SELECT i.id, i.type, i.modifiersJson, cr.locked, cr.chestId, c.rarity, c.earnedAt
     FROM items i
     JOIN chest_rewards cr ON cr.itemId = i.id
     JOIN chests c ON c.id = cr.chestId
     ORDER BY c.earnedAt DESC
     LIMIT ?`,
    [limit]
  );
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    items.push(result.rows.item(i));
  }
  return items;
}

export async function listRecentEfforts({ limit = 5, habitId = null } = {}) {
  if (isWeb) {
    const filtered = habitId
      ? webStore.effortLogs.filter((item) => item.habitId === habitId)
      : webStore.effortLogs;
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    return sorted.slice(0, limit).map((item) => {
      const habit = webStore.habits.find((h) => h.id === item.habitId);
      return {
        id: item.id,
        effortValue: item.effortValue,
        note: item.note,
        timestamp: item.timestamp,
        habitName: habit ? habit.name : 'Unknown',
      };
    });
  }
  const whereClause = habitId ? 'WHERE e.habitId = ?' : '';
  const params = habitId ? [habitId, limit] : [limit];
  const result = await execSql(
    `SELECT e.id, e.effortValue, e.note, e.timestamp, h.name as habitName
     FROM effort_logs e
     JOIN habits h ON h.id = e.habitId
     ${whereClause}
     ORDER BY e.timestamp DESC
     LIMIT ?`,
    params
  );
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    items.push(result.rows.item(i));
  }
  return items;
}

export async function getEvidenceSummary() {
  if (isWeb) {
    const lastEffortAt = webStore.effortLogs.length
      ? webStore.effortLogs[webStore.effortLogs.length - 1].timestamp
      : null;
    const lastChestAt = webStore.chests.length
      ? webStore.chests[webStore.chests.length - 1].earnedAt
      : null;
    const totalEffort = webStore.effortLogs.reduce((sum, item) => sum + item.effortValue, 0);
    const activeDaySet = new Set(
      webStore.effortLogs.map((item) => item.timestamp.slice(0, 10))
    );
    return {
      lastEffortAt,
      lastChestAt,
      totalEffort,
      activeDays: activeDaySet.size,
    };
  }
  const lastEffortResult = await execSql(
    'SELECT timestamp FROM effort_logs ORDER BY timestamp DESC LIMIT 1'
  );
  const lastEffortAt = lastEffortResult.rows.length
    ? lastEffortResult.rows.item(0).timestamp
    : null;
  const lastChestResult = await execSql('SELECT earnedAt FROM chests ORDER BY earnedAt DESC LIMIT 1');
  const lastChestAt = lastChestResult.rows.length ? lastChestResult.rows.item(0).earnedAt : null;
  const effortSumResult = await execSql('SELECT SUM(effortValue) as total FROM effort_logs');
  const totalEffort = effortSumResult.rows.item(0).total || 0;
  const daysActiveResult = await execSql(
    'SELECT COUNT(DISTINCT DATE(timestamp)) as count FROM effort_logs'
  );
  const activeDays = daysActiveResult.rows.item(0).count || 0;
  return { lastEffortAt, lastChestAt, totalEffort, activeDays };
}

export async function getLatestLockedChest() {
  if (isWeb) {
    const sorted = [...webStore.chests].sort(
      (a, b) => new Date(b.earnedAt) - new Date(a.earnedAt)
    );
    for (const chest of sorted) {
      const lockedCount = webStore.chestRewards.filter(
        (reward) => reward.chestId === chest.id && reward.locked
      ).length;
      if (lockedCount > 0) {
        return {
          id: chest.id,
          rarity: chest.rarity,
          earnedAt: chest.earnedAt,
          lockedCount,
        };
      }
    }
    return null;
  }
  const result = await execSql(
    `SELECT c.id, c.rarity, c.earnedAt,
      (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id AND cr.locked = 1) as lockedCount
     FROM chests c
     WHERE (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id AND cr.locked = 1) > 0
     ORDER BY c.earnedAt DESC
     LIMIT 1`
  );
  return result.rows.length ? result.rows.item(0) : null;
}

export async function createCombatEncounter(chestId) {
  if (isWeb) {
    const chest = webStore.chests.find((item) => item.id === chestId);
    if (!chest) return null;
    const difficultyTier =
      chest.rarity === 'mythic' ? 'hard' : chest.rarity === 'rare' ? 'standard' : 'light';
    const id = makeId('combat');
    const createdAt = nowIso();
    webStore.combatEncounters.push({
      id,
      chestId,
      difficultyTier,
      completed: false,
      createdAt,
    });
    return { id, chestId, difficultyTier };
  }
  const chestResult = await execSql('SELECT rarity FROM chests WHERE id = ?', [chestId]);
  if (chestResult.rows.length === 0) return null;
  const chest = chestResult.rows.item(0);
  const difficultyTier =
    chest.rarity === 'mythic' ? 'hard' : chest.rarity === 'rare' ? 'standard' : 'light';
  const id = makeId('combat');
  const createdAt = nowIso();
  await execSql(
    'INSERT INTO combat_encounters (id, chestId, difficultyTier, completed, createdAt) VALUES (?, ?, ?, ?, ?)',
    [id, chestId, difficultyTier, 0, createdAt]
  );
  return { id, chestId, difficultyTier };
}

export async function resolveCombatEncounter({ encounterId, chestId, outcome }) {
  if (!encounterId || !chestId) return { unlocked: 0, remaining: 0 };
  if (isWeb) {
    const encounter = webStore.combatEncounters.find((item) => item.id === encounterId);
    if (encounter) encounter.completed = true;
  } else {
    await execSql('UPDATE combat_encounters SET completed = 1 WHERE id = ?', [encounterId]);
  }

  if (outcome !== 'win') {
    if (isWeb) {
      const remaining = webStore.chestRewards.filter(
        (item) => item.chestId === chestId && item.locked
      ).length;
      return { unlocked: 0, remaining };
    }
    const remaining = await execSql(
      'SELECT COUNT(*) as count FROM chest_rewards WHERE chestId = ? AND locked = 1',
      [chestId]
    );
    return { unlocked: 0, remaining: remaining.rows.item(0).count || 0 };
  }

  let lockedIds = [];
  if (isWeb) {
    lockedIds = webStore.chestRewards
      .filter((item) => item.chestId === chestId && item.locked)
      .map((item) => item.id);
  } else {
    const lockedResult = await execSql(
      'SELECT id FROM chest_rewards WHERE chestId = ? AND locked = 1',
      [chestId]
    );
    for (let i = 0; i < lockedResult.rows.length; i += 1) {
      lockedIds.push(lockedResult.rows.item(i).id);
    }
  }

  const unlockCount = Math.max(1, Math.ceil(lockedIds.length * 0.6));
  const shuffled = lockedIds.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, unlockCount);
  for (const rewardId of selected) {
    if (isWeb) {
      const reward = webStore.chestRewards.find((item) => item.id === rewardId);
      if (reward) reward.locked = false;
    } else {
      await execSql('UPDATE chest_rewards SET locked = 0 WHERE id = ?', [rewardId]);
    }
  }
  if (isWeb) {
    const chest = webStore.chests.find((item) => item.id === chestId);
    if (chest) chest.unlockedRewardCount += selected.length;
  } else {
    await execSql(
      'UPDATE chests SET unlockedRewardCount = unlockedRewardCount + ? WHERE id = ?',
      [selected.length, chestId]
    );
  }
  if (isWeb) saveWebStore();
  const remaining = lockedIds.length - selected.length;
  return { unlocked: selected.length, remaining };
}

export async function getStatusSnapshot() {
  if (isWeb) {
    return {
      identity: webStore.identity,
      counts: {
        habits: webStore.habits.length,
        efforts: webStore.effortLogs.length,
        chests: webStore.chests.length,
      },
    };
  }
  const identityResult = await execSql('SELECT * FROM identity LIMIT 1');
  const identity = identityResult.rows.length ? identityResult.rows.item(0) : null;

  const habitCount = await execSql('SELECT COUNT(*) as count FROM habits');
  const effortCount = await execSql('SELECT COUNT(*) as count FROM effort_logs');
  const chestCount = await execSql('SELECT COUNT(*) as count FROM chests');

  return {
    identity,
    counts: {
      habits: habitCount.rows.item(0).count || 0,
      efforts: effortCount.rows.item(0).count || 0,
      chests: chestCount.rows.item(0).count || 0,
    },
  };
}

export async function exportAllData() {
  if (isWeb) {
    return {
      identity: webStore.identity,
      habits: [...webStore.habits],
      effortLogs: [...webStore.effortLogs],
      chests: [...webStore.chests],
      items: [...webStore.items],
      chestRewards: [...webStore.chestRewards],
      combatEncounters: [...webStore.combatEncounters],
      mercyEvents: [...webStore.mercyEvents],
      habitEffortCache: Object.values(webStore.habitEffortCache),
    };
  }

  const identityRows = await fetchAllRows('SELECT * FROM identity');
  const habits = await fetchAllRows('SELECT * FROM habits');
  const effortLogs = await fetchAllRows('SELECT * FROM effort_logs');
  const chests = await fetchAllRows('SELECT * FROM chests');
  const items = await fetchAllRows('SELECT * FROM items');
  const chestRewards = await fetchAllRows('SELECT * FROM chest_rewards');
  const combatEncounters = await fetchAllRows('SELECT * FROM combat_encounters');
  const mercyEvents = await fetchAllRows('SELECT * FROM mercy_events');
  const habitEffortCache = await fetchAllRows('SELECT * FROM habit_effort_cache');

  return {
    identity: identityRows.length ? identityRows[0] : null,
    habits,
    effortLogs,
    chests,
    items,
    chestRewards,
    combatEncounters,
    mercyEvents,
    habitEffortCache,
  };
}

export async function clearAllData() {
  if (isWeb) {
    webStore.identity = null;
    webStore.habits = [];
    webStore.effortLogs = [];
    webStore.chests = [];
    webStore.items = [];
    webStore.chestRewards = [];
    webStore.combatEncounters = [];
    webStore.mercyEvents = [];
    webStore.habitEffortCache = {};
    saveWebStore();
    return;
  }
  await execSql('DELETE FROM chest_rewards');
  await execSql('DELETE FROM combat_encounters');
  await execSql('DELETE FROM effort_logs');
  await execSql('DELETE FROM items');
  await execSql('DELETE FROM chests');
  await execSql('DELETE FROM habits');
  await execSql('DELETE FROM mercy_events');
  await execSql('DELETE FROM habit_effort_cache');
  await execSql('DELETE FROM identity');
}

export async function importAllData(payload) {
  if (!payload) return;
  if (isWeb) {
    webStore.identity = payload.identity || null;
    webStore.habits = payload.habits ? [...payload.habits] : [];
    webStore.effortLogs = payload.effortLogs ? [...payload.effortLogs] : [];
    webStore.chests = payload.chests ? [...payload.chests] : [];
    webStore.items = payload.items ? [...payload.items] : [];
    webStore.chestRewards = payload.chestRewards ? [...payload.chestRewards] : [];
    webStore.combatEncounters = payload.combatEncounters
      ? [...payload.combatEncounters]
      : [];
    webStore.mercyEvents = payload.mercyEvents ? [...payload.mercyEvents] : [];
    const cache = payload.habitEffortCache ? [...payload.habitEffortCache] : [];
    webStore.habitEffortCache = Object.fromEntries(
      cache.map((record) => [record.habitKey, record])
    );
    saveWebStore();
    return;
  }

  if (payload.identity) {
    await execSql(
      'INSERT INTO identity (id, level, totalEffortUnits, createdAt, lastActiveAt) VALUES (?, ?, ?, ?, ?)',
      [
        payload.identity.id,
        payload.identity.level,
        payload.identity.totalEffortUnits,
        payload.identity.createdAt,
        payload.identity.lastActiveAt,
      ]
    );
  }

  for (const habit of payload.habits || []) {
    await execSql(
      'INSERT INTO habits (id, name, isActive, createdAt) VALUES (?, ?, ?, ?)',
      [habit.id, habit.name, habit.isActive ? 1 : 0, habit.createdAt]
    );
  }

  for (const log of payload.effortLogs || []) {
    await execSql(
      'INSERT INTO effort_logs (id, habitId, effortValue, note, timestamp, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [log.id, log.habitId, log.effortValue, log.note || null, log.timestamp, log.createdAt]
    );
  }

  for (const chest of payload.chests || []) {
    await execSql(
      'INSERT INTO chests (id, rarity, earnedAt, unlockedRewardCount) VALUES (?, ?, ?, ?)',
      [chest.id, chest.rarity, chest.earnedAt, chest.unlockedRewardCount || 0]
    );
  }

  for (const item of payload.items || []) {
    await execSql(
      'INSERT INTO items (id, type, modifiersJson, createdAt) VALUES (?, ?, ?, ?)',
      [item.id, item.type, item.modifiersJson, item.createdAt]
    );
  }

  for (const reward of payload.chestRewards || []) {
    await execSql(
      'INSERT INTO chest_rewards (id, chestId, itemId, locked) VALUES (?, ?, ?, ?)',
      [reward.id, reward.chestId, reward.itemId, reward.locked ? 1 : 0]
    );
  }

  for (const encounter of payload.combatEncounters || []) {
    await execSql(
      'INSERT INTO combat_encounters (id, chestId, difficultyTier, completed, createdAt) VALUES (?, ?, ?, ?, ?)',
      [
        encounter.id,
        encounter.chestId,
        encounter.difficultyTier,
        encounter.completed ? 1 : 0,
        encounter.createdAt,
      ]
    );
  }

  for (const event of payload.mercyEvents || []) {
    await execSql('INSERT INTO mercy_events (id, reason, createdAt) VALUES (?, ?, ?)', [
      event.id,
      event.reason,
      event.createdAt,
    ]);
  }

  for (const record of payload.habitEffortCache || []) {
    await execSql(
      'INSERT INTO habit_effort_cache (habitKey, effort, prevalence, source, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [
        record.habitKey,
        record.effort,
        record.prevalence || null,
        record.source || null,
        record.updatedAt,
      ]
    );
  }
}
