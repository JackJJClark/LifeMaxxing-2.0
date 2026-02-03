import React from 'react';
import { Text } from 'react-native';

const DEFAULT_DAILY_TARGET = 8;
const NEUTRAL_ICON_GLYPH = '□';

function getHabitTypeFromName(name, explicitType = 'generic') {
  const hintedType = (explicitType || '').toString().toLowerCase();
  if (['gym', 'water', 'supplement', 'generic'].includes(hintedType)) {
    return hintedType;
  }
  const text = (name || '').toLowerCase();
  if (text.includes('water') || text.includes('hydrate') || text.includes('cup')) {
    return 'water';
  }
  if (
    text.includes('creatine') ||
    text.includes('supplement') ||
    text.includes('vitamin')
  ) {
    return 'supplement';
  }
  if (
    text.includes('gym') ||
    text.includes('lift') ||
    text.includes('train') ||
    text.includes('workout') ||
    text.includes('strength')
  ) {
    return 'gym';
  }
  return 'generic';
}

function iconGlyphForKey(iconKey) {
  switch (iconKey) {
    case 'gym':
      return '\u{1F4AA}';
    case 'water':
      return '\u{1F4A7}';
    case 'supplement':
      return '\u{1F48A}';
    default:
      return NEUTRAL_ICON_GLYPH;
  }
}

function HabitIcon({ habit, style }) {
  const iconKey = habit?.iconKey;
  const glyph = iconGlyphForKey(iconKey);
  return <Text style={style}>{`${glyph} `}</Text>;
}

function getHabitSpec(habit) {
  if (!habit || !habit.key) {
    return {
      id: habit?.id || '',
      name: habit?.name || '',
      iconKey: habit?.iconKey || '',
      template: 'binary_done',
      actions: [{ type: 'done', label: 'Log' }],
      getProgress: (entry) => (entry ? 1 : 0),
      getEvidenceKind: (entry) => (entry ? 'done' : 'none'),
      allowRest: false,
    };
  }

  switch (habit.key) {
    case 'gym':
      return {
        id: habit.id,
        name: habit.name,
        iconKey: habit.iconKey,
        template: 'binary_done_rest',
        allowRest: true,
        actions: [
          { type: 'done', label: 'Log' },
          { type: 'rest', label: 'Rest' },
        ],
        getProgress: (entry) => (entry ? 1 : 0),
        getEvidenceKind: (entry) =>
          entry?.kind === 'rest' ? 'rest' : entry ? 'done' : 'none',
      };

    case 'water':
      return {
        id: habit.id,
        name: habit.name,
        iconKey: habit.iconKey,
        template: 'counter_target',
        allowRest: false,
        target: habit.dailyTarget ?? DEFAULT_DAILY_TARGET,
        actions: [
          { type: 'increment', label: '+1 cup', amount: 1 },
          { type: 'edit', label: 'Edit' },
        ],
        getProgress: (entry) =>
          Math.min((entry?.amount ?? 0) / (habit.dailyTarget ?? DEFAULT_DAILY_TARGET), 1),
        getEvidenceKind: (entry) =>
          !entry
            ? 'none'
            : entry.amount >= (habit.dailyTarget ?? DEFAULT_DAILY_TARGET)
            ? 'done'
            : 'partial',
      };

    default:
      return {
        id: habit.id,
        name: habit.name,
        iconKey: habit.iconKey,
        template: 'binary_done',
        allowRest: false,
        actions: [{ type: 'done', label: 'Log' }],
        getProgress: (entry) => (entry ? 1 : 0),
        getEvidenceKind: (entry) => (entry ? 'done' : 'none'),
      };
  }
}

function getHabitActionConfig(habit) {
  const spec = getHabitSpec(habit);
  if (habit?.key === 'gym') {
    return {
      label: 'Log',
      actionType: 'gym_session',
      units: 1,
      summary: 'Gym session',
    };
  }
  if (habit?.key === 'water') {
    return {
      label: '+1 cup',
      actionType: 'water_cup',
      units: 1,
      summary: 'Hydration cup',
    };
  }
  if (habit?.key === 'supplement') {
    return {
      label: 'Taken',
      actionType: 'supplement_taken',
      units: 1,
      summary: 'Supplement',
    };
  }
  const primary = spec.actions?.[0];
  return {
    label: primary?.label || 'Log',
    actionType: 'custom',
    units: 1,
    summary: 'Action',
  };
}

export {
  HabitIcon,
  getHabitActionConfig,
  getHabitSpec,
  getHabitTypeFromName,
};
