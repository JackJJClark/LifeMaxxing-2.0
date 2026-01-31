import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DB_NAME = 'lifemaxing.db';
const isWeb = Platform.OS === 'web';
const db = isWeb ? null : SQLite.openDatabase(DB_NAME);
const WEB_STORE_KEY = 'lifemaxing.webstore.v1';
const DEVICE_ID_KEY = 'lifemaxing.deviceId.v1';
const SCHEMA_VERSION = 1;
const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || '';

const webStore = {
  identity: null,
  habits: [],
  effortLogs: [],
  chests: [],
  items: [],
  cards: [],
  chestRewards: [],
  chestMeta: [],
  arcQuestProgress: [],
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
    webStore.cards = Array.isArray(data.cards) ? data.cards : [];
    webStore.chestRewards = Array.isArray(data.chestRewards) ? data.chestRewards : [];
    webStore.chestMeta = Array.isArray(data.chestMeta) ? data.chestMeta : [];
    webStore.arcQuestProgress = Array.isArray(data.arcQuestProgress)
      ? data.arcQuestProgress
      : [];
    webStore.combatEncounters = Array.isArray(data.combatEncounters)
      ? data.combatEncounters
      : [];
    webStore.mercyEvents = Array.isArray(data.mercyEvents) ? data.mercyEvents : [];
    if (Array.isArray(data.habitEffortCache)) {
      webStore.habitEffortCache = Object.fromEntries(
        data.habitEffortCache
          .filter((record) => record && record.habitKey)
          .map((record) => [record.habitKey, record])
      );
    } else if (data.habitEffortCache && typeof data.habitEffortCache === 'object') {
      webStore.habitEffortCache = data.habitEffortCache;
    } else {
      webStore.habitEffortCache = {};
    }
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
      cards: webStore.cards,
      chestRewards: webStore.chestRewards,
      chestMeta: webStore.chestMeta,
      arcQuestProgress: webStore.arcQuestProgress,
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
const RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'relic'];
const CHEST_TIERS = ['weathered', 'sealed', 'engraved', 'runed', 'ancient'];
const CHEST_TIER_LABELS = {
  weathered: 'Weathered',
  sealed: 'Sealed',
  engraved: 'Engraved',
  runed: 'Runed',
  ancient: 'Ancient',
};

const ITEM_CATALOG = [
  {
    key: 'worn_compass',
    name: 'Worn Compass',
    rarity: 'uncommon',
    effect: 'Slightly improves chest quality after long inactivity.',
  },
  {
    key: 'fractured_hourglass',
    name: 'Fractured Hourglass',
    rarity: 'rare',
    effect: 'Long encounters can pause safely without friction.',
  },
  {
    key: 'quiet_token',
    name: 'Quiet Token',
    rarity: 'common',
    effect: 'UI noise softens after missed days.',
  },
  {
    key: 'ember_thread',
    name: 'Ember Thread',
    rarity: 'uncommon',
    effect: 'Low-effort actions feel more impactful in combat expression.',
  },
  {
    key: 'old_journal_page',
    name: 'Old Journal Page',
    rarity: 'rare',
    effect: 'Effort memory reflections appear more often.',
  },
  {
    key: 'rusty_key',
    name: 'Rusty Key',
    rarity: 'epic',
    effect: 'Unlocks one locked chest reward without combat (rare use).',
  },
  {
    key: 'anchor_stone',
    name: 'Anchor Stone',
    rarity: 'epic',
    effect: 'Stabilizes consistency-based rarity rolls.',
  },
];

const CARD_CATALOG = [
  {
    key: 'return_signal',
    name: 'Return Signal',
    rarity: 'uncommon',
    effect: 'When you log effort after inactivity, gain a small combat bonus.',
  },
  {
    key: 'first_loss_mercy',
    name: 'First Loss Mercy',
    rarity: 'rare',
    effect: 'Your first combat loss each day has no effect on reward unlocking.',
  },
  {
    key: 'quiet_stability',
    name: 'Quiet Stability',
    rarity: 'common',
    effect: 'Low-effort actions slightly improve chest stability.',
  },
  {
    key: 'return_slot',
    name: 'Return Slot',
    rarity: 'epic',
    effect: 'When returning after a break, unlock one additional reward slot.',
  },
  {
    key: 'steady_encounters',
    name: 'Steady Encounters',
    rarity: 'uncommon',
    effect: 'Combat encounters feel slightly easier when effort is logged consistently.',
  },
];

const ARC_QUESTS = [
  {
    id: 'arc_echoes',
    title: 'Show Up Again',
    theme: 'Identity',
    summary: 'This arc tracks your general effort and reminds you that returning counts.',
    milestones: [15, 35, 70, 120],
    fragments: [
      'You logged effort again after a break.',
      'You have shown up on multiple days.',
      'Your effort is becoming a pattern you can trust.',
      'You have built a stable rhythm over time.',
    ],
  },
  {
    id: 'arc_stillwater',
    title: 'Keep the Thread',
    theme: 'Consistency',
    summary: 'This arc advances whenever you log effort, no deadlines, no streaks.',
    milestones: [10, 28, 60, 100],
    fragments: [
      'You logged effort on multiple days.',
      'You are building a baseline of consistency.',
      'You returned after gaps without losing progress.',
      'Your consistency is now a long-term habit.',
    ],
  },
  {
    id: 'arc_vigil',
    title: 'Care for Energy',
    theme: 'Vitality',
    summary: 'This arc reflects effort and recovery without pressure.',
    milestones: [20, 45, 85, 130],
    fragments: [
      'You kept going without forcing a streak.',
      'You made progress even when energy was low.',
      'You returned after rest and kept moving.',
      'You have built a steady relationship with effort.',
    ],
  },
];

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

async function getOrCreateDeviceId() {
  if (isWeb) {
    if (!canUseWebStorage()) return makeId('device');
    try {
      const existing = window.localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const created = makeId('device');
      window.localStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    } catch (error) {
      return makeId('device');
    }
  }
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = makeId('device');
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch (error) {
    return makeId('device');
  }
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

async function ensureColumn(table, column, definition) {
  try {
    await execSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    // Column likely exists; ignore.
  }
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

function generateItemLegacy(rarity) {
  const type = randomFrom(ITEM_TYPES);
  const modifiers = generateModifiers();
  const tag = rarity === 'relic' ? 'radiant' : rarity === 'rare' ? 'glow' : 'quiet';
  return { type, modifiers, tag };
}

function pickCatalogByRarity(catalog, rarity) {
  const index = RARITY_TIERS.indexOf(rarity);
  if (index === -1) return randomFrom(catalog);
  const eligible = catalog.filter((item) => RARITY_TIERS.indexOf(item.rarity) <= index);
  if (eligible.length === 0) return randomFrom(catalog);
  return randomFrom(eligible);
}

function generateItem(rarity) {
  const item = pickCatalogByRarity(ITEM_CATALOG, rarity);
  return {
    name: item.name,
    rarity: item.rarity,
    effect: item.effect,
    meta: { key: item.key },
  };
}

function generateCard(rarity) {
  const card = pickCatalogByRarity(CARD_CATALOG, rarity);
  return {
    name: card.name,
    rarity: card.rarity,
    effect: card.effect,
    key: card.key,
  };
}

function bumpRarity(rarity) {
  const index = RARITY_TIERS.indexOf(rarity);
  if (index === -1) return rarity;
  return RARITY_TIERS[Math.min(index + 1, RARITY_TIERS.length - 1)];
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
    source: 'cdc_aerobic_guidelines_2022',
  },
  {
    key: 'sleep',
    keywords: ['sleep', 'bed', 'rest'],
    prevalence: 65.0,
    source: 'cdc_sleep_2020_inferred',
  },
  {
    key: 'water',
    keywords: ['water', 'hydrate', 'hydration'],
    prevalence: 81.4,
    source: 'nhanes_plain_water_2011_2014',
  },
  {
    key: 'meditation',
    keywords: ['meditate', 'meditation', 'mindfulness'],
    prevalence: 14.2,
    source: 'nchs_meditation_2017',
  },
  {
    key: 'yoga',
    keywords: ['yoga'],
    prevalence: 14.3,
    source: 'nchs_yoga_2017',
  },
  {
    key: 'vegetables',
    keywords: ['vegetable', 'veggies', 'greens', 'salad'],
    prevalence: 10.0,
    source: 'cdc_veg_recommendation_2019',
  },
  {
    key: 'fruit',
    keywords: ['fruit', 'berries', 'apple', 'banana'],
    prevalence: 12.3,
    source: 'cdc_fruit_recommendation_2019',
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

function deriveChestTheme(habitName) {
  const text = normalizeHabitKey(habitName || '');
  if (!text) return 'resolve';
  if (text.includes('sleep') || text.includes('rest')) return 'restore';
  if (text.includes('water') || text.includes('hydrate')) return 'clarity';
  if (text.includes('meditate') || text.includes('mind')) return 'calm';
  if (text.includes('walk') || text.includes('run') || text.includes('cardio')) return 'stride';
  if (text.includes('gym') || text.includes('lift') || text.includes('strength')) return 'vigor';
  if (text.includes('yoga')) return 'balance';
  if (text.includes('read')) return 'insight';
  if (text.includes('meal') || text.includes('protein') || text.includes('nutrition')) return 'nourish';
  return 'resolve';
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
      tier TEXT,
      earnedAt TEXT NOT NULL,
      unlockedRewardCount INTEGER NOT NULL DEFAULT 0
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      modifiersJson TEXT NOT NULL,
      name TEXT,
      rarity TEXT,
      effect TEXT,
      metaJson TEXT,
      createdAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS chest_rewards (
      id TEXT PRIMARY KEY NOT NULL,
      chestId TEXT NOT NULL,
      itemId TEXT,
      rewardType TEXT,
      rewardId TEXT,
      locked INTEGER NOT NULL,
      FOREIGN KEY (chestId) REFERENCES chests (id),
      FOREIGN KEY (itemId) REFERENCES items (id)
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      cardKey TEXT NOT NULL,
      rarity TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      chestId TEXT
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS arc_quest_progress (
      arcId TEXT PRIMARY KEY NOT NULL,
      progress INTEGER NOT NULL,
      unlockedCount INTEGER NOT NULL,
      updatedAt TEXT NOT NULL
    )`
  );

  await execSql(
    `CREATE TABLE IF NOT EXISTS chest_meta (
      chestId TEXT PRIMARY KEY NOT NULL,
      habitId TEXT,
      habitName TEXT,
      effortValue INTEGER,
      consistencyCount INTEGER,
      theme TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (chestId) REFERENCES chests (id)
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

  await ensureColumn('chests', 'tier', 'TEXT');
  await ensureColumn('items', 'name', 'TEXT');
  await ensureColumn('items', 'rarity', 'TEXT');
  await ensureColumn('items', 'effect', 'TEXT');
  await ensureColumn('items', 'metaJson', 'TEXT');
  await ensureColumn('chest_rewards', 'rewardType', 'TEXT');
  await ensureColumn('chest_rewards', 'rewardId', 'TEXT');
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
      habitKey,
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
    habitKey,
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

async function getHabitNameById(habitId) {
  if (!habitId) return '';
  if (isWeb) {
    const habit = webStore.habits.find((item) => item.id === habitId);
    return habit ? habit.name : '';
  }
  const result = await execSql('SELECT name FROM habits WHERE id = ? LIMIT 1', [habitId]);
  if (result.rows.length === 0) return '';
  return result.rows.item(0).name || '';
}

async function resolveEffortValue(habitId, fallbackName) {
  const habitName = fallbackName || (await getHabitNameById(habitId));
  if (!habitName) return 5;
  const info = await getHabitEffortForName(habitName);
  return info?.effort || 5;
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
  const createdAt = nowIso();
  const legacyFallback = generateItemLegacy(item.rarity || 'common');
  const name = item.name || legacyFallback.type;
  const rarity = item.rarity || 'common';
  const effect = item.effect || legacyFallback.modifiers.join(' ');
  const metaJson = JSON.stringify(item.meta || {});
  const modifiersJson = JSON.stringify(
    item.modifiersJson
      ? item.modifiersJson
      : { modifiers: legacyFallback.modifiers, tag: legacyFallback.tag }
  );
  if (isWeb) {
    const id = makeId('item');
    webStore.items.push({
      id,
      type: item.type || legacyFallback.type,
      modifiersJson,
      name,
      rarity,
      effect,
      metaJson,
      createdAt,
    });
    return id;
  }
  const id = makeId('item');
  await execSql(
    'INSERT INTO items (id, type, modifiersJson, name, rarity, effect, metaJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, item.type || legacyFallback.type, modifiersJson, name, rarity, effect, metaJson, createdAt]
  );
  return id;
}

async function createCardRecord(card, chestId = null) {
  const id = makeId('card');
  const createdAt = nowIso();
  if (isWeb) {
    webStore.cards.push({
      id,
      cardKey: card.key,
      rarity: card.rarity,
      createdAt,
      chestId,
    });
    return id;
  }
  await execSql(
    'INSERT INTO cards (id, cardKey, rarity, createdAt, chestId) VALUES (?, ?, ?, ?, ?)',
    [id, card.key, card.rarity, createdAt, chestId]
  );
  return id;
}

function rewardCountForTier(tier) {
  switch (tier) {
    case 'ancient':
      return 3;
    case 'runed':
      return 3;
    case 'engraved':
      return 2;
    case 'sealed':
      return Math.random() < 0.5 ? 1 : 2;
    default:
      return 1;
  }
}

function pickRewardType(tier) {
  if (tier === 'ancient' && Math.random() < 0.6) return 'card';
  if (tier === 'runed' && Math.random() < 0.5) return 'card';
  if (tier === 'engraved' && Math.random() < 0.4) return 'card';
  return Math.random() < 0.25 ? 'card' : 'item';
}

async function createChestRewards(chestId, rarity, consistencyCount = 0, tier = 'weathered') {
  const rewardCount = rewardCountForTier(tier);
  let bonus = 0;
  if (consistencyCount >= 7 && Math.random() < 0.5) {
    bonus += 1;
  }
  if (consistencyCount >= 5 && Math.random() < 0.35) {
    bonus += 1;
  }
  const totalRewards = rewardCount + bonus;

  for (let i = 0; i < totalRewards; i += 1) {
    const rewardId = makeId('reward');
    const rewardType = pickRewardType(tier);
    let rewardRef = null;
    let itemId = null;
    if (rewardType === 'card') {
      const card = generateCard(rarity);
      rewardRef = await createCardRecord(card, chestId);
    } else {
      const item = generateItem(rarity);
      itemId = await createItemRecord(item);
      rewardRef = itemId;
    }
    if (isWeb) {
      webStore.chestRewards.push({
        id: rewardId,
        chestId,
        itemId,
        rewardType,
        rewardId: rewardRef,
        locked: true,
      });
    } else {
      await execSql(
        'INSERT INTO chest_rewards (id, chestId, itemId, rewardType, rewardId, locked) VALUES (?, ?, ?, ?, ?, 1)',
        [rewardId, chestId, itemId, rewardType, rewardRef]
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
  if (count >= 7) return 'relic';
  if (count >= 6) return 'epic';
  if (count >= 5) return 'rare';
  if (count >= 3) return 'uncommon';
  return 'common';
}

function chestTierFromConsistency(count) {
  if (count >= 7) return 'ancient';
  if (count >= 6) return 'runed';
  if (count >= 5) return 'engraved';
  if (count >= 3) return 'sealed';
  return 'weathered';
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

function unlockedCountForQuest(quest, progress) {
  return quest.milestones.filter((threshold) => progress >= threshold).length;
}

async function ensureArcQuestProgress() {
  if (isWeb) {
    const map = new Map(webStore.arcQuestProgress.map((row) => [row.arcId, row]));
    ARC_QUESTS.forEach((quest) => {
      if (!map.has(quest.id)) {
        const record = {
          arcId: quest.id,
          progress: 0,
          unlockedCount: 0,
          updatedAt: nowIso(),
        };
        webStore.arcQuestProgress.push(record);
        map.set(quest.id, record);
      }
    });
    return map;
  }

  const rows = await fetchAllRows('SELECT arcId, progress, unlockedCount, updatedAt FROM arc_quest_progress');
  const map = new Map(rows.map((row) => [row.arcId, row]));
  for (const quest of ARC_QUESTS) {
    if (!map.has(quest.id)) {
      const record = {
        arcId: quest.id,
        progress: 0,
        unlockedCount: 0,
        updatedAt: nowIso(),
      };
      await execSql(
        'INSERT INTO arc_quest_progress (arcId, progress, unlockedCount, updatedAt) VALUES (?, ?, ?, ?)',
        [record.arcId, record.progress, record.unlockedCount, record.updatedAt]
      );
      map.set(quest.id, record);
    }
  }
  return map;
}

export async function listArcQuestStatus() {
  const progressMap = await ensureArcQuestProgress();
  return ARC_QUESTS.map((quest) => {
    const record = progressMap.get(quest.id);
    const progress = record ? record.progress : 0;
    const unlockedCount = record ? record.unlockedCount : 0;
    const nextMilestone = quest.milestones.find((value) => value > progress) || null;
    return {
      id: quest.id,
      title: quest.title,
      theme: quest.theme,
      summary: quest.summary,
      progress,
      unlockedCount,
      totalFragments: quest.fragments.length,
      nextMilestone,
      fragments: quest.fragments.slice(0, unlockedCount),
    };
  });
}

async function updateArcQuestProgress(delta) {
  const progressMap = await ensureArcQuestProgress();
  const unlocked = [];
  for (const quest of ARC_QUESTS) {
    const record = progressMap.get(quest.id);
    if (!record) continue;
    const prevUnlocked = record.unlockedCount;
    const nextProgress = record.progress + delta;
    const nextUnlocked = unlockedCountForQuest(quest, nextProgress);
    if (isWeb) {
      record.progress = nextProgress;
      record.unlockedCount = nextUnlocked;
      record.updatedAt = nowIso();
    } else {
      await execSql(
        'UPDATE arc_quest_progress SET progress = ?, unlockedCount = ?, updatedAt = ? WHERE arcId = ?',
        [nextProgress, nextUnlocked, nowIso(), quest.id]
      );
    }
    if (nextUnlocked > prevUnlocked) {
      unlocked.push({
        arcId: quest.id,
        title: quest.title,
        fragment: quest.fragments[nextUnlocked - 1] || null,
      });
    }
  }
  return unlocked;
}

export async function logEffort({ habitId, note }) {
  const id = makeId('effort');
  const timestamp = nowIso();
  const inactivityDays = await getInactivityDays();
  const resolvedEffort = await resolveEffortValue(habitId);
  const habitName = await getHabitNameById(habitId);

  if (isWeb) {
    webStore.effortLogs.push({
      id,
      habitId,
      effortValue: resolvedEffort,
      note: note || null,
      timestamp,
      createdAt: timestamp,
    });
  } else {
    await execSql(
      'INSERT INTO effort_logs (id, habitId, effortValue, note, timestamp, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [id, habitId, resolvedEffort, note || null, timestamp, timestamp]
    );
  }

  await updateIdentityTotals(resolvedEffort);
  const arcUnlocks = await updateArcQuestProgress(resolvedEffort);

  const consistency = await getConsistencyScore();
  const chestId = makeId('chest');
  const baseRarity = rarityFromConsistency(consistency);
  const mercy = await applyMercyIfEligible(baseRarity, inactivityDays);
  const rarity = mercy.rarity;
  const chestTier = chestTierFromConsistency(consistency);
  if (isWeb) {
    webStore.chests.push({
      id: chestId,
      rarity,
      tier: chestTier,
      earnedAt: timestamp,
      unlockedRewardCount: 0,
    });
  } else {
    await execSql(
      'INSERT INTO chests (id, rarity, tier, earnedAt, unlockedRewardCount) VALUES (?, ?, ?, ?, 0)',
      [chestId, rarity, chestTier, timestamp]
    );
  }
  const chestTheme = deriveChestTheme(habitName);
  if (isWeb) {
    webStore.chestMeta.push({
      chestId,
      habitId,
      habitName: habitName || null,
      effortValue: resolvedEffort,
      consistencyCount: consistency,
      theme: chestTheme,
      createdAt: timestamp,
    });
  } else {
    await execSql(
      'INSERT INTO chest_meta (chestId, habitId, habitName, effortValue, consistencyCount, theme, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [chestId, habitId, habitName || null, resolvedEffort, consistency, chestTheme, timestamp]
    );
  }
  await createChestRewards(chestId, rarity, consistency, chestTier);
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
  return {
    effortId: id,
    chestId,
    rarity,
    chestTier,
    mercyUsed: mercy.mercyUsed,
    mercyBypass: mercy.bypassUnlock,
    arcUnlocks,
  };
}

export async function listChests(limit = 5) {
  if (isWeb) {
    const sorted = [...webStore.chests].sort(
      (a, b) => new Date(b.earnedAt) - new Date(a.earnedAt)
    );
    return sorted.slice(0, limit).map((chest) => {
      const rewards = webStore.chestRewards.filter((item) => item.chestId === chest.id);
      const locked = rewards.filter((item) => item.locked);
      const meta = webStore.chestMeta.find((item) => item.chestId === chest.id) || null;
      const computedTier = chest.tier || chestTierFromConsistency(meta?.consistencyCount || 0);
      return {
        id: chest.id,
        rarity: chest.rarity,
        tier: computedTier,
        tierLabel: CHEST_TIER_LABELS[computedTier] || CHEST_TIER_LABELS.weathered,
        earnedAt: chest.earnedAt,
        unlockedRewardCount: chest.unlockedRewardCount,
        rewardCount: rewards.length,
        lockedCount: locked.length,
        theme: meta?.theme || null,
        habitName: meta?.habitName || null,
      };
    });
  }
  const result = await execSql(
    `SELECT c.id, c.rarity, c.earnedAt, c.unlockedRewardCount,
      c.tier as tier,
      (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id) as rewardCount,
      (SELECT COUNT(*) FROM chest_rewards cr WHERE cr.chestId = c.id AND cr.locked = 1) as lockedCount,
      m.theme as theme,
      m.habitName as habitName
     FROM chests c
     LEFT JOIN chest_meta m ON m.chestId = c.id
     ORDER BY c.earnedAt DESC
     LIMIT ?`,
    [limit]
  );
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const row = result.rows.item(i);
    items.push({
      ...row,
      tier: row.tier || 'weathered',
      tierLabel: CHEST_TIER_LABELS[row.tier] || CHEST_TIER_LABELS.weathered,
    });
  }
  return items;
}

export async function listItems(limit = 20) {
  if (isWeb) {
    const items = webStore.items
      .map((item) => {
        const reward = webStore.chestRewards.find(
          (cr) => cr.rewardId === item.id || cr.itemId === item.id
        );
        if (!reward) return null;
        const chest = webStore.chests.find((c) => c.id === reward.chestId);
        if (!chest) return null;
        return {
          id: item.id,
          type: item.type,
          modifiersJson: item.modifiersJson,
          name: item.name,
          effect: item.effect,
          rarity: item.rarity || chest.rarity,
          metaJson: item.metaJson,
          locked: reward.locked,
          chestId: reward.chestId,
          earnedAt: chest.earnedAt,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
    return items.slice(0, limit);
  }
  const result = await execSql(
    `SELECT i.id, i.type, i.modifiersJson, i.name, i.effect, i.rarity, i.metaJson,
      cr.locked, cr.chestId, c.rarity as chestRarity, c.earnedAt
     FROM items i
     JOIN chest_rewards cr ON cr.itemId = i.id
     JOIN chests c ON c.id = cr.chestId
     ORDER BY c.earnedAt DESC
     LIMIT ?`,
    [limit]
  );
  const items = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const row = result.rows.item(i);
    items.push({
      id: row.id,
      type: row.type,
      modifiersJson: row.modifiersJson,
      name: row.name,
      effect: row.effect,
      rarity: row.rarity || row.chestRarity,
      metaJson: row.metaJson,
      locked: row.locked,
      chestId: row.chestId,
      earnedAt: row.earnedAt,
    });
  }
  return items;
}

function cardInfoByKey(cardKey) {
  return CARD_CATALOG.find((card) => card.key === cardKey) || null;
}

export async function listCards(limit = 20) {
  if (isWeb) {
    const cards = webStore.cards
      .map((card) => {
        const reward = webStore.chestRewards.find((cr) => cr.rewardId === card.id);
        const chest = reward ? webStore.chests.find((c) => c.id === reward.chestId) : null;
        const info = cardInfoByKey(card.cardKey);
        return {
          id: card.id,
          cardKey: card.cardKey,
          name: info?.name || card.cardKey,
          effect: info?.effect || '',
          rarity: card.rarity,
          locked: reward ? reward.locked : false,
          chestId: reward ? reward.chestId : card.chestId,
          earnedAt: chest ? chest.earnedAt : card.createdAt,
        };
      })
      .sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
    return cards.slice(0, limit);
  }
  const result = await execSql(
    `SELECT c.id, c.cardKey, c.rarity, c.createdAt, c.chestId,
      cr.locked, cr.chestId as rewardChestId
     FROM cards c
     LEFT JOIN chest_rewards cr ON cr.rewardId = c.id
     ORDER BY c.createdAt DESC
     LIMIT ?`,
    [limit]
  );
  const cards = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    const row = result.rows.item(i);
    const info = cardInfoByKey(row.cardKey);
    cards.push({
      id: row.id,
      cardKey: row.cardKey,
      name: info?.name || row.cardKey,
      effect: info?.effect || '',
      rarity: row.rarity,
      locked: row.locked ? true : false,
      chestId: row.rewardChestId || row.chestId,
      earnedAt: row.createdAt,
    });
  }
  return cards;
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
      chest.rarity === 'relic' || chest.rarity === 'epic'
        ? 'hard'
        : chest.rarity === 'rare'
        ? 'standard'
        : 'light';
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
    chest.rarity === 'relic' || chest.rarity === 'epic'
      ? 'hard'
      : chest.rarity === 'rare'
      ? 'standard'
      : 'light';
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
  const deviceId = await getOrCreateDeviceId();
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(),
    deviceId,
    appVersion: APP_VERSION || null,
  };
  if (isWeb) {
    return {
      meta,
      identity: webStore.identity,
      habits: [...webStore.habits],
      effortLogs: [...webStore.effortLogs],
      chests: [...webStore.chests],
      items: [...webStore.items],
      cards: [...webStore.cards],
      chestRewards: [...webStore.chestRewards],
      chestMeta: [...webStore.chestMeta],
      arcQuestProgress: [...webStore.arcQuestProgress],
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
  const cards = await fetchAllRows('SELECT * FROM cards');
  const chestRewards = await fetchAllRows('SELECT * FROM chest_rewards');
  const chestMeta = await fetchAllRows('SELECT * FROM chest_meta');
  const arcQuestProgress = await fetchAllRows('SELECT * FROM arc_quest_progress');
  const combatEncounters = await fetchAllRows('SELECT * FROM combat_encounters');
  const mercyEvents = await fetchAllRows('SELECT * FROM mercy_events');
  const habitEffortCache = await fetchAllRows('SELECT * FROM habit_effort_cache');

  return {
    meta,
    identity: identityRows.length ? identityRows[0] : null,
    habits,
    effortLogs,
    chests,
    items,
    cards,
    chestRewards,
    chestMeta,
    arcQuestProgress,
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
    webStore.cards = [];
    webStore.chestRewards = [];
    webStore.chestMeta = [];
    webStore.arcQuestProgress = [];
    webStore.combatEncounters = [];
    webStore.mercyEvents = [];
    webStore.habitEffortCache = {};
    saveWebStore();
    return;
  }
  await execSql('DELETE FROM chest_rewards');
  await execSql('DELETE FROM chest_meta');
  await execSql('DELETE FROM combat_encounters');
  await execSql('DELETE FROM effort_logs');
  await execSql('DELETE FROM cards');
  await execSql('DELETE FROM items');
  await execSql('DELETE FROM chests');
  await execSql('DELETE FROM habits');
  await execSql('DELETE FROM mercy_events');
  await execSql('DELETE FROM habit_effort_cache');
  await execSql('DELETE FROM arc_quest_progress');
  await execSql('DELETE FROM identity');
}

export async function importAllData(payload) {
  if (!payload) return;
  const meta = payload.meta || null;
  if (isWeb) {
    webStore.identity = payload.identity || null;
    webStore.habits = payload.habits ? [...payload.habits] : [];
    webStore.effortLogs = payload.effortLogs ? [...payload.effortLogs] : [];
    webStore.chests = payload.chests ? [...payload.chests] : [];
    webStore.items = payload.items ? [...payload.items] : [];
    webStore.cards = payload.cards ? [...payload.cards] : [];
    webStore.chestRewards = payload.chestRewards ? [...payload.chestRewards] : [];
    webStore.chestMeta = payload.chestMeta ? [...payload.chestMeta] : [];
    webStore.arcQuestProgress = payload.arcQuestProgress
      ? [...payload.arcQuestProgress]
      : [];
    webStore.combatEncounters = payload.combatEncounters
      ? [...payload.combatEncounters]
      : [];
    webStore.mercyEvents = payload.mercyEvents ? [...payload.mercyEvents] : [];
    const cache = payload.habitEffortCache ? [...payload.habitEffortCache] : [];
    webStore.habitEffortCache = Object.fromEntries(
      cache
        .filter((record) => record && record.habitKey)
        .map((record) => [record.habitKey, record])
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
      'INSERT INTO chests (id, rarity, tier, earnedAt, unlockedRewardCount) VALUES (?, ?, ?, ?, ?)',
      [chest.id, chest.rarity, chest.tier || null, chest.earnedAt, chest.unlockedRewardCount || 0]
    );
  }

  for (const metaRow of payload.chestMeta || []) {
    await execSql(
      'INSERT INTO chest_meta (chestId, habitId, habitName, effortValue, consistencyCount, theme, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        metaRow.chestId,
        metaRow.habitId || null,
        metaRow.habitName || null,
        metaRow.effortValue || null,
        metaRow.consistencyCount || null,
        metaRow.theme || null,
        metaRow.createdAt || nowIso(),
      ]
    );
  }

  for (const item of payload.items || []) {
    await execSql(
      'INSERT INTO items (id, type, modifiersJson, name, rarity, effect, metaJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        item.id,
        item.type,
        item.modifiersJson,
        item.name || null,
        item.rarity || null,
        item.effect || null,
        item.metaJson || null,
        item.createdAt,
      ]
    );
  }

  for (const reward of payload.chestRewards || []) {
    await execSql(
      'INSERT INTO chest_rewards (id, chestId, itemId, rewardType, rewardId, locked) VALUES (?, ?, ?, ?, ?, ?)',
      [
        reward.id,
        reward.chestId,
        reward.itemId || null,
        reward.rewardType || null,
        reward.rewardId || null,
        reward.locked ? 1 : 0,
      ]
    );
  }

  for (const card of payload.cards || []) {
    await execSql(
      'INSERT INTO cards (id, cardKey, rarity, createdAt, chestId) VALUES (?, ?, ?, ?, ?)',
      [card.id, card.cardKey, card.rarity, card.createdAt, card.chestId || null]
    );
  }

  for (const arc of payload.arcQuestProgress || []) {
    await execSql(
      'INSERT INTO arc_quest_progress (arcId, progress, unlockedCount, updatedAt) VALUES (?, ?, ?, ?)',
      [arc.arcId, arc.progress, arc.unlockedCount || 0, arc.updatedAt || nowIso()]
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
