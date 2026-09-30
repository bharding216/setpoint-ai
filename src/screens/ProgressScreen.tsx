import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { CartesianChart, Line, useChartPressState } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

type ChartPoint = {
  x: number;
  y: number;
  label: string;
};

type ExerciseOption = {
  name: string;
  type: 'strength' | 'cardio';
  metric: string;
  data: ChartPoint[];
};

type WorkoutTypeStat = {
  type: string;
  count: number;
};

type SummaryStats = {
  totalWorkouts: number;
  perWeek: number;
  currentStreak: number;
  workoutTypes: WorkoutTypeStat[];
  spanWeeks: number;
};

function ToolTip({ x, y }: { x: number; y: number }) {
  return <Circle cx={x} cy={y} r={6} color={colors.primary} />;
}

export default function ProgressScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exercises, setExercises] = useState<ExerciseOption[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPicker, setShowPicker] = useState(false);

  const { state: pressState, isActive: isPressActive } = useChartPressState({
    x: 0,
    y: { y: 0 },
  });

  const fetchData = useCallback(async () => {
    if (!user) return;

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = ninetyDaysAgo.toISOString().split('T')[0];

    const { data: workouts } = await supabase
      .from('workouts')
      .select(
        `
        id,
        date,
        type,
        status,
        workout_exercises (
          name,
          exercise_type,
          is_planned,
          exercise_sets ( weight, reps ),
          cardio_entries ( duration_minutes, distance )
        )
      `,
      )
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .gte('date', cutoff)
      .order('date', { ascending: true });

    if (!workouts || workouts.length === 0) {
      setSummary(null);
      setExercises([]);
      setLoading(false);
      return;
    }

    // ── Workout-level summary ─────────────────────────────────

    const totalWorkouts = workouts.length;

    // Workouts per week
    const dates = workouts.map((w) => new Date(w.date + 'T12:00:00'));
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    const spanMs = latest.getTime() - earliest.getTime();
    const spanWeeks = Math.max(1, Math.round(spanMs / (7 * 24 * 60 * 60 * 1000)));
    const perWeek = Math.round((totalWorkouts / spanWeeks) * 10) / 10;

    // Current streak: consecutive weeks (ending with current or last week) that have ≥1 workout
    const weekSet = new Set<string>();
    for (const d of dates) {
      const wStart = new Date(d);
      wStart.setDate(wStart.getDate() - wStart.getDay());
      weekSet.add(wStart.toISOString().split('T')[0]);
    }
    const sortedWeeks = Array.from(weekSet).sort().reverse();
    let currentStreak = 0;
    const now = new Date();
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    let checkWeek = new Date(thisWeekStart);
    for (let i = 0; i < sortedWeeks.length + 1; i++) {
      const key = checkWeek.toISOString().split('T')[0];
      if (weekSet.has(key)) {
        currentStreak++;
        checkWeek.setDate(checkWeek.getDate() - 7);
      } else if (i === 0) {
        // current week might not have a workout yet, skip to last week
        checkWeek.setDate(checkWeek.getDate() - 7);
      } else {
        break;
      }
    }

    // Workout type breakdown
    const typeMap = new Map<string, number>();
    for (const w of workouts) {
      const t = w.type || 'Workout';
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
    }
    const workoutTypes: WorkoutTypeStat[] = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    setSummary({ totalWorkouts, perWeek, currentStreak, workoutTypes, spanWeeks });

    // ── Per-exercise charts ──────────────────────────────────

    const exerciseMap = new Map<
      string,
      {
        type: 'strength' | 'cardio';
        entries: { date: string; value: number }[];
        metric: string;
      }
    >();

    for (const w of workouts) {
      const exs = (w.workout_exercises ?? []).filter(
        (e: any) => !e.is_planned,
      );

      for (const ex of exs) {
        const name = (ex as any).name as string;
        const exType = (ex as any).exercise_type as string;

        if (exType === 'strength') {
          const sets = (ex as any).exercise_sets ?? [];
          if (sets.length === 0) continue;

          let bestWeight = 0;
          let bestReps = 0;
          for (const s of sets) {
            if ((s.weight ?? 0) > bestWeight) bestWeight = s.weight ?? 0;
            if ((s.reps ?? 0) > bestReps) bestReps = s.reps ?? 0;
          }

          // Bodyweight exercises: track best reps instead of weight
          if (bestWeight === 0) {
            if (bestReps === 0) continue;

            if (!exerciseMap.has(name)) {
              exerciseMap.set(name, {
                type: 'strength',
                entries: [],
                metric: 'Best Reps',
              });
            }
            exerciseMap
              .get(name)!
              .entries.push({ date: w.date, value: bestReps });
          } else {
            if (!exerciseMap.has(name)) {
              exerciseMap.set(name, {
                type: 'strength',
                entries: [],
                metric: 'Weight (lbs)',
              });
            }
            exerciseMap
              .get(name)!
              .entries.push({ date: w.date, value: bestWeight });
          }
        } else {
          const cardio = ((ex as any).cardio_entries ?? [])[0];
          if (!cardio) continue;

          if (cardio.duration_minutes) {
            if (!exerciseMap.has(name)) {
              exerciseMap.set(name, {
                type: 'cardio',
                entries: [],
                metric: 'Duration (min)',
              });
            }
            exerciseMap
              .get(name)!
              .entries.push({ date: w.date, value: cardio.duration_minutes });
          } else if (cardio.distance) {
            if (!exerciseMap.has(name)) {
              exerciseMap.set(name, {
                type: 'cardio',
                entries: [],
                metric: 'Distance',
              });
            }
            exerciseMap
              .get(name)!
              .entries.push({ date: w.date, value: cardio.distance });
          }
        }
      }
    }

    const options: ExerciseOption[] = [];
    exerciseMap.forEach((data, name) => {
      if (data.entries.length >= 1) {
        options.push({
          name,
          type: data.type,
          metric: data.metric,
          data: data.entries.map((e, i) => ({
            x: i,
            y: e.value,
            label: formatShortDate(e.date),
          })),
        });
      }
    });

    options.sort((a, b) => b.data.length - a.data.length);
    setExercises(options);
    setSelectedIndex(0);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const current = exercises[selectedIndex];
  const hasAnyData = summary && summary.totalWorkouts > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textTertiary}
          colors={[colors.primary]}
        />
      }
    >
      {!hasAnyData ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Progress Data Yet</Text>
          <Text style={styles.emptySubtitle}>
            Complete a few workouts and your progress charts will appear here.
          </Text>
        </View>
      ) : (
        <>
          {/* ── Summary stats ────────────────────────────── */}
          {summary && (
            <>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{summary.totalWorkouts}</Text>
                  <Text style={styles.statLabel}>Workouts</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{summary.perWeek}</Text>
                  <Text style={styles.statLabel}>Per Week</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {summary.currentStreak > 0 ? `${summary.currentStreak}wk` : '—'}
                  </Text>
                  <Text style={styles.statLabel}>Streak</Text>
                </View>
              </View>

              {/* Workout type breakdown */}
              <View style={styles.typesCard}>
                <Text style={styles.typesTitle}>Activity Breakdown</Text>
                {summary.workoutTypes.map((wt) => {
                  const pct = Math.round(
                    (wt.count / summary.totalWorkouts) * 100,
                  );
                  return (
                    <View key={wt.type} style={styles.typeRow}>
                      <View style={styles.typeInfo}>
                        <Text style={styles.typeName}>{wt.type}</Text>
                        <Text style={styles.typeCount}>
                          {wt.count} session{wt.count !== 1 ? 's' : ''}
                        </Text>
                      </View>
                      <View style={styles.barBackground}>
                        <View
                          style={[styles.barFill, { width: `${pct}%` }]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Per-exercise charts ──────────────────────── */}
          {exercises.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Exercise Trends</Text>

              {/* Dropdown exercise picker */}
              <TouchableOpacity
                style={styles.dropdown}
                onPress={() => setShowPicker(true)}
                activeOpacity={0.7}
              >
                <View style={styles.dropdownInner}>
                  <Text style={styles.dropdownLabel}>
                    {current?.name ?? 'Select Exercise'}
                  </Text>
                  <Text style={styles.dropdownChevron}>▾</Text>
                </View>
              </TouchableOpacity>

              {/* Chart or single-entry state */}
              {current && (
                <>
                  <Text style={styles.metricLabel}>{current.metric}</Text>

                  {current.data.length >= 2 ? (
                    <View style={styles.chartCard}>
                      <View style={styles.chartContainer}>
                        <CartesianChart
                          data={current.data}
                          xKey="x"
                          yKeys={['y']}
                          domainPadding={{
                            top: 20,
                            bottom: 10,
                            left: 10,
                            right: 10,
                          }}
                          axisOptions={{
                            font: null,
                            lineColor: colors.border,
                            labelColor: colors.textTertiary,
                            formatXLabel: (val) => {
                              const point = current.data[Math.round(val)];
                              return point?.label ?? '';
                            },
                            formatYLabel: (val) => `${val}`,
                          }}
                          chartPressState={pressState}
                        >
                          {({ points }) => (
                            <>
                              <Line
                                points={points.y}
                                color={colors.primary}
                                strokeWidth={2.5}
                                curveType="natural"
                              />
                              {isPressActive && (
                                <ToolTip
                                  x={pressState.x.position.value}
                                  y={pressState.y.y.position.value}
                                />
                              )}
                            </>
                          )}
                        </CartesianChart>
                      </View>

                      <View style={styles.chartMeta}>
                        <Text style={styles.chartMetaText}>
                          {current.data.length} sessions
                        </Text>
                        {(() => {
                          const first = current.data[0].y;
                          const last = current.data[current.data.length - 1].y;
                          const diff = last - first;
                          const sign = diff >= 0 ? '+' : '';
                          return (
                            <Text
                              style={[
                                styles.chartMetaText,
                                {
                                  color:
                                    diff >= 0 ? colors.success : colors.error,
                                },
                              ]}
                            >
                              {first} → {last} ({sign}
                              {diff.toFixed(diff % 1 === 0 ? 0 : 1)})
                            </Text>
                          );
                        })()}
                      </View>
                    </View>
                  ) : (
                    <View style={styles.singleEntryCard}>
                      <Text style={styles.singleEntryValue}>
                        {current.data[0].y}
                      </Text>
                      <Text style={styles.singleEntryDate}>
                        {current.data[0].label}
                      </Text>
                      <Text style={styles.singleEntryHint}>
                        Log one more session to see your trend
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {/* Picker modal */}
          <Modal
            visible={showPicker}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setShowPicker(false)}
          >
            <View style={styles.pickerModal}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Exercise</Text>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={styles.pickerDone}>Done</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={exercises}
                keyExtractor={(item) => item.name}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={[
                      styles.pickerItem,
                      selectedIndex === index && styles.pickerItemActive,
                    ]}
                    onPress={() => {
                      setSelectedIndex(index);
                      setShowPicker(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerItemRow}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.pickerItemName,
                            selectedIndex === index &&
                              styles.pickerItemNameActive,
                          ]}
                        >
                          {item.name}
                        </Text>
                        <Text style={styles.pickerItemMetric}>
                          {item.metric}
                        </Text>
                      </View>
                      <View style={styles.pickerItemMeta}>
                        <Text style={styles.pickerItemType}>
                          {item.type === 'strength' ? '🏋️' : '🏃'}
                        </Text>
                        <Text style={styles.pickerItemSessions}>
                          {item.data.length} session
                          {item.data.length !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.pickerList}
              />
            </View>
          </Modal>
        </>
      )}
    </ScrollView>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function formatShortDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xl * 3,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Summary stats ──────────────────────────────────────────
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },

  // ── Workout type breakdown ─────────────────────────────────
  typesCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  typesTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  typeRow: {
    marginBottom: spacing.sm,
  },
  typeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  typeName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  typeCount: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  barBackground: {
    height: 6,
    backgroundColor: colors.background,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    backgroundColor: colors.primary,
    borderRadius: 3,
    minWidth: 6,
  },

  // ── Section title ──────────────────────────────────────────
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },

  // ── Dropdown ──────────────────────────────────────────────
  dropdown: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  dropdownInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  dropdownLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  dropdownChevron: {
    fontSize: 18,
    color: colors.textTertiary,
    marginLeft: spacing.sm,
  },

  metricLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Chart ─────────────────────────────────────────────────
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  chartContainer: {
    height: 220,
  },
  chartMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  chartMetaText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // ── Single entry (not enough data for a chart) ─────────────
  singleEntryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
  },
  singleEntryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
  },
  singleEntryDate: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  singleEntryHint: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },

  // ── Picker modal ──────────────────────────────────────────
  pickerModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  pickerDone: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  pickerList: {
    padding: spacing.md,
  },
  pickerItem: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickerItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  pickerItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerItemName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  pickerItemNameActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  pickerItemMetric: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  pickerItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  pickerItemType: {
    fontSize: 14,
    marginRight: spacing.xs,
  },
  pickerItemSessions: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
