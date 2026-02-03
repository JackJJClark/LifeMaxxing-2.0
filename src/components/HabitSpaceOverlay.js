import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { HabitIcon, getHabitSpec } from '../utils/getHabitActionConfig';

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
  onEdit,
}) {
  const resolvedHabit = useMemo(() => {
    if (habit) return habit;
    if (!habitId) return null;
    return (habits || []).find((h) => h.id === habitId) || null;
  }, [habit, habitId, habits]);
  const [arcOpen, setArcOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

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

  const spec = useMemo(
    () => (resolvedHabit ? getHabitSpec(resolvedHabit) : null),
    [resolvedHabit]
  );

  const week = useMemo(() => buildWeek(), []);

  const weekMarks = useMemo(() => {
    if (!resolvedHabit || !spec) return {};
    const marks = {};
    for (const d of week) {
      marks[d.toISOString().slice(0, 10)] = null;
    }

    const totalsByDay = {};
    for (const e of efforts || []) {
      if (e.habitId !== resolvedHabit.id) continue;
      const key = String(e.timestamp || '').slice(0, 10);
      totalsByDay[key] = (totalsByDay[key] || 0) + (e.units || 1);
    }

    for (const key of Object.keys(marks)) {
      const total = totalsByDay[key] || 0;
      const entry =
        spec.template === 'counter_target'
          ? { amount: total }
          : total > 0
          ? { kind: 'done' }
          : undefined;
      marks[key] = spec.getEvidenceKind(entry);
    }
    return marks;
  }, [resolvedHabit, efforts, week, spec]);

  if (!resolvedHabit || !spec) return null;

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
            <HabitIcon habit={resolvedHabit} />
            {resolvedHabit.name}
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
            {(spec.actions || []).map((action) => {
              const label = action.label;
              const handler = () => {
                if (action.type === 'done' || action.type === 'increment') {
                  onLog?.(action);
                  const message =
                    action.type === 'increment' ? label : 'Logged';
                  setFeedback(message);
                  setTimeout(() => setFeedback(''), 1200);
                  return;
                }
                if (action.type === 'rest') {
                  onRest?.(action);
                  return;
                }
                if (action.type === 'edit') {
                  onEdit?.(action);
                }
              };
              const isSecondary = action.type === 'rest' || action.type === 'edit';
              return (
                <Pressable
                  key={action.type}
                  onPress={handler}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: isSecondary
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(255,255,255,0.10)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.14)',
                  }}
                >
                  <Text
                    style={{
                      color: isSecondary ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.92)',
                      textAlign: 'center',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {feedback ? (
            <Text style={{ color: 'rgba(255,255,255,0.65)', marginTop: 10 }}>
              {feedback}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)', marginBottom: 8 }}>
            This week
          </Text>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {week.map((d) => {
              const key = d.toISOString().slice(0, 10);
              const kind = weekMarks[key];
              let dotColor = 'rgba(255,255,255,0.18)';
              if (kind === 'done') dotColor = 'rgba(255,255,255,0.85)';
              if (kind === 'partial') dotColor = 'rgba(255,255,255,0.55)';
              if (kind === 'rest') dotColor = 'rgba(165,210,255,0.85)';

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
                      backgroundColor: dotColor,
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
