import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDay(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function fmtMd(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildWeek() {
  const days = [];
  const now = startOfDay(new Date());
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d);
  }
  return days;
}

export default function HabitSpaceOverlay({
  habit,
  habitId,
  habits,
  efforts,
  arcQuests,
  onClose,
  onLog,
  onRest,
  onAcceptArc,
  onIgnoreArc,
}) {
  const resolvedHabit = useMemo(() => {
    if (habit) return habit;
    if (!habitId) return null;
    return (habits || []).find((h) => h.id === habitId) || null;
  }, [habit, habitId, habits]);
  const [arcOpen, setArcOpen] = useState(false);

  const scopedArcs = useMemo(() => {
    if (!resolvedHabit) return [];
    return (arcQuests || []).filter((q) => {
      const pid = q.primaryHabitId || q.habitId || null;
      const ptype = q.primaryHabitType || q.habitType || null;

      if (pid && pid === resolvedHabit.id) return true;
      if (ptype && ptype === resolvedHabit.type) return true;

      return false;
    });
  }, [resolvedHabit, arcQuests]);

  const week = useMemo(() => buildWeek(), []);

  const weekMarks = useMemo(() => {
    if (!resolvedHabit) return {};
    const marks = {};
    for (const d of week) {
      marks[d.toISOString().slice(0, 10)] = null;
    }

    for (const e of efforts || []) {
      if (e.habitId !== resolvedHabit.id) continue;
      const key = String(e.timestamp || '').slice(0, 10);
      if (!marks[key]) marks[key] = 'done';
      else marks[key] = 'done';
    }
    return marks;
  }, [resolvedHabit, efforts, week]);

  if (!resolvedHabit) return null;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0b0b0f',
        paddingTop: 18,
      }}
    >
      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Pressable onPress={onClose}>
          <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
            ← Back
          </Text>
        </Pressable>

        <View style={{ marginTop: 10 }}>
          <Text style={{ color: 'rgba(255,255,255,0.95)', fontSize: 20 }}>
            {resolvedHabit.iconEmoji ? `${resolvedHabit.iconEmoji} ` : ''}{resolvedHabit.name}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
            A quiet space for this habit.
          </Text>
        </View>

        <View style={{ marginTop: 12 }}>
          <Pressable
            onPress={() => setArcOpen((v) => !v)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.9)' }}>
              Arc Quest ▾
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
              {scopedArcs.length === 0
                ? 'No arcs for this habit yet.'
                : 'Choose an arc inside this habit.'}
            </Text>
          </Pressable>

          {arcOpen && scopedArcs.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {scopedArcs.map((q) => (
                <View
                  key={q.id}
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.10)',
                    borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    marginTop: 8,
                  }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.92)' }}>
                    {q.title || 'Arc'}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                    {q.description || ''}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.04)',
            padding: 14,
          }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.90)', fontSize: 16 }}>
            Today
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
            One small action still counts.
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable
              onPress={onLog}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.14)',
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.92)', textAlign: 'center' }}>
                Log
              </Text>
            </Pressable>

            <Pressable
              onPress={onRest}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.14)',
              }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
                Rest
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)', marginBottom: 8 }}>
            This week
          </Text>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {week.map((d) => {
              const key = d.toISOString().slice(0, 10);
              const mark = weekMarks[key];

              return (
                <View
                  key={key}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.10)',
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.65)' }}>
                    {fmtDay(d)}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    {fmtMd(d)}
                  </Text>

                  <View
                    style={{
                      marginTop: 8,
                      width: 10,
                      height: 10,
                      borderRadius: 99,
                      backgroundColor: mark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.18)',
                    }}
                  />
                </View>
              );
            })}
          </View>

          <Text style={{ color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>
            No red. Absence is neutral.
          </Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
            Recent evidence
          </Text>

          {(efforts || [])
            .filter((e) => e.habitId === resolvedHabit.id)
            .slice(0, 10)
            .map((e) => (
              <View
                key={e.id || e.timestamp}
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.10)',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.80)' }}>
                  {String(e.label || 'Effort')}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                  {String(e.timestamp || '')}
                </Text>
              </View>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}
