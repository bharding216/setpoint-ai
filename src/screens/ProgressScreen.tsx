import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { CartesianChart, Line, Bar, useChartPressState } from 'victory-native';
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

type ExerciseHistory = {
  name: string;
  data: ChartPoint[];
};

type VolumePoint = {
  x: number;
  volume: number;
  label: string;
};

type FrequencyPoint = {
  x: number;
  count: number;
  label: string;
};

function ToolTip({ x, y }: { x: number; y: number }) {
  return <Circle cx={x} cy={y} r={6} color={colors.primary} />;
}

export default function ProgressScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exerciseHistories, setExerciseHistories] = useState<ExerciseHistory[]>([]);
  const [weeklyVolume, setWeeklyVolume] = useState<VolumePoint[]>([]);
  const [weeklyFrequency, setWeeklyFrequency] = useState<FrequencyPoint[]>([]);
  const [selectedExercise, setSelectedExercise] = useState(0);

  const { state: pressState, isActive: isPressActive } = useChartPressState({
    x: 0,
    y: { y: 0 },
  });

  const fetchData = useCallback(async () => {
    if (!user) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 60);
    const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

    const { data: workouts } = await supabase
      .from('workouts')
      .select(
        `
        id,
        date,
        status,
        workout_exercises (
          name,
          exercise_type,
          is_planned,
          exercise_sets ( weight, reps )
        )
      `,
      )
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .gte('date', cutoff)
      .order('date', { ascending: true });

    if (!workouts) {
      setLoading(false);
      return;
    }

    // Build exercise strength progressions (best set per workout)
    const exerciseMap = new Map<
      string,
      { date: string; bestWeight: number; bestVolume: number }[]
    >();

    for (const w of workouts) {
      const exercises = (w.workout_exercises ?? []).filter(
        (e: any) => !e.is_planned && e.exercise_type === 'strength',
      );
      for (const ex of exercises) {
        const sets = ex.exercise_sets ?? [];
        if (sets.length === 0) continue;

        let bestWeight = 0;
        let bestVolume = 0;
        for (const s of sets) {
          const weight = s.weight ?? 0;
          const reps = s.reps ?? 0;
          if (weight > bestWeight) bestWeight = weight;
          bestVolume += weight * reps;
        }

        const name = (ex as any).name as string;
        if (!exerciseMap.has(name)) exerciseMap.set(name, []);
        exerciseMap.get(name)!.push({
          date: w.date,
          bestWeight,
          bestVolume,
        });
      }
    }

    // Convert to chart data — pick exercises with at least 3 data points
    const histories: ExerciseHistory[] = [];
    exerciseMap.forEach((entries, name) => {
      if (entries.length >= 3) {
        histories.push({
          name,
          data: entries.map((e, i) => ({
            x: i,
            y: e.bestWeight,
            label: formatShortDate(e.date),
          })),
        });
      }
    });

    histories.sort((a, b) => b.data.length - a.data.length);
    setExerciseHistories(histories.slice(0, 10));

    // Weekly volume (total weight × reps)
    const weekMap = new Map<string, { volume: number; count: number }>();
    for (const w of workouts) {
      const weekStart = getWeekStart(w.date);
      if (!weekMap.has(weekStart)) weekMap.set(weekStart, { volume: 0, count: 0 });
      const entry = weekMap.get(weekStart)!;
      entry.count++;

      const exercises = (w.workout_exercises ?? []).filter(
        (e: any) => !e.is_planned,
      );
      for (const ex of exercises) {
        for (const s of (ex as any).exercise_sets ?? []) {
          entry.volume += (s.weight ?? 0) * (s.reps ?? 0);
        }
      }
    }

    const weeks = Array.from(weekMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8);

    setWeeklyVolume(
      weeks.map(([week, data], i) => ({
        x: i,
        volume: Math.round(data.volume),
        label: formatShortDate(week),
      })),
    );

    setWeeklyFrequency(
      weeks.map(([week, data], i) => ({
        x: i,
        count: data.count,
        label: formatShortDate(week),
      })),
    );

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

  const noData =
    exerciseHistories.length === 0 &&
    weeklyVolume.length === 0;

  const currentExercise = exerciseHistories[selectedExercise];

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
      {noData ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Progress Data Yet</Text>
          <Text style={styles.emptySubtitle}>
            Complete a few workouts and your progress charts will appear here.
          </Text>
        </View>
      ) : (
        <>
          {/* Exercise Strength Progression */}
          {exerciseHistories.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Strength Progression</Text>
              <Text style={styles.sectionSubtitle}>Best weight per workout</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.exercisePicker}
              >
                {exerciseHistories.map((h, i) => (
                  <TouchableOpacity
                    key={h.name}
                    style={[
                      styles.exerciseChip,
                      selectedExercise === i && styles.exerciseChipActive,
                    ]}
                    onPress={() => setSelectedExercise(i)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.exerciseChipText,
                        selectedExercise === i && styles.exerciseChipTextActive,
                      ]}
                    >
                      {h.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {currentExercise && (
                <View style={styles.chartCard}>
                  <View style={styles.chartContainer}>
                    <CartesianChart
                      data={currentExercise.data}
                      xKey="x"
                      yKeys={['y']}
                      domainPadding={{ top: 20, bottom: 10, left: 10, right: 10 }}
                      axisOptions={{
                        font: null,
                        lineColor: colors.border,
                        labelColor: colors.textTertiary,
                        formatXLabel: (val) => {
                          const point = currentExercise.data[Math.round(val)];
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
                      {currentExercise.data.length} sessions tracked
                    </Text>
                    {currentExercise.data.length >= 2 && (
                      <Text
                        style={[
                          styles.chartMetaText,
                          {
                            color:
                              currentExercise.data[currentExercise.data.length - 1].y >=
                              currentExercise.data[0].y
                                ? colors.success
                                : colors.error,
                          },
                        ]}
                      >
                        {currentExercise.data[0].y} → {currentExercise.data[currentExercise.data.length - 1].y} lbs
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Weekly Volume */}
          {weeklyVolume.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Weekly Volume</Text>
              <Text style={styles.sectionSubtitle}>Total weight × reps</Text>
              <View style={styles.chartCard}>
                <View style={styles.chartContainer}>
                  <CartesianChart
                    data={weeklyVolume}
                    xKey="x"
                    yKeys={['volume']}
                    domainPadding={{ top: 20, bottom: 10, left: 10, right: 10 }}
                    axisOptions={{
                      font: null,
                      lineColor: colors.border,
                      labelColor: colors.textTertiary,
                      formatXLabel: (val) => {
                        const point = weeklyVolume[Math.round(val)];
                        return point?.label ?? '';
                      },
                      formatYLabel: (val) =>
                        val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`,
                    }}
                  >
                    {({ points, chartBounds }) => (
                      <Bar
                        points={points.volume}
                        chartBounds={chartBounds}
                        color={colors.primary}
                        roundedCorners={{ topLeft: 4, topRight: 4 }}
                      />
                    )}
                  </CartesianChart>
                </View>
              </View>
            </View>
          )}

          {/* Weekly Frequency */}
          {weeklyFrequency.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Weekly Frequency</Text>
              <Text style={styles.sectionSubtitle}>Workouts per week</Text>
              <View style={styles.chartCard}>
                <View style={styles.chartContainer}>
                  <CartesianChart
                    data={weeklyFrequency}
                    xKey="x"
                    yKeys={['count']}
                    domainPadding={{ top: 20, bottom: 10, left: 10, right: 10 }}
                    axisOptions={{
                      font: null,
                      lineColor: colors.border,
                      labelColor: colors.textTertiary,
                      formatXLabel: (val) => {
                        const point = weeklyFrequency[Math.round(val)];
                        return point?.label ?? '';
                      },
                      formatYLabel: (val) => `${val}`,
                    }}
                  >
                    {({ points, chartBounds }) => (
                      <Bar
                        points={points.count}
                        chartBounds={chartBounds}
                        color={colors.accent}
                        roundedCorners={{ topLeft: 4, topRight: 4 }}
                      />
                    )}
                  </CartesianChart>
                </View>
              </View>
            </View>
          )}
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

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
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

  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  exercisePicker: {
    marginBottom: spacing.md,
  },
  exerciseChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  exerciseChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  exerciseChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  chartContainer: {
    height: 200,
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
});
