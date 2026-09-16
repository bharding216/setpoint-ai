import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  Animated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import { Workout, ExerciseSet, DAY_NAMES } from '../types/database';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type ExerciseDetail = {
  id: string;
  name: string;
  exercise_type: string;
  is_planned: boolean;
  exercise_order: number;
  sets: { weight: number | null; reps: number | null; rpe: number | null }[];
  cardio: {
    duration_minutes: number | null;
    distance: number | null;
    pace: string | null;
    heart_rate: number | null;
    notes: string | null;
  } | null;
};

type WorkoutRow = Workout & {
  exercise_summary: string;
  exercises: ExerciseDetail[];
};

type Section = {
  title: string;
  data: WorkoutRow[];
};

export default function HistoryScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const todayStr = new Date().toISOString().split('T')[0];

  const fetchWorkouts = useCallback(async () => {
    if (!user) return;

    const { data } = await supabase
      .from('workouts')
      .select(
        `
        *,
        workout_exercises (
          id,
          name,
          is_planned,
          exercise_type,
          exercise_order,
          exercise_sets ( weight, reps, rpe, set_number ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `,
      )
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) {
      const rows: WorkoutRow[] = data.map((w: any) => {
        const allExercises: ExerciseDetail[] = (w.workout_exercises ?? [])
          .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
          .map((e: any) => ({
            id: e.id,
            name: e.name,
            exercise_type: e.exercise_type,
            is_planned: e.is_planned,
            exercise_order: e.exercise_order,
            sets: (e.exercise_sets ?? [])
              .sort(
                (a: ExerciseSet, b: ExerciseSet) =>
                  a.set_number - b.set_number,
              )
              .map((s: any) => ({
                weight: s.weight,
                reps: s.reps,
                rpe: s.rpe,
              })),
            cardio: e.cardio_entries?.[0] ?? null,
          }));

        const actual = allExercises.filter((e) => !e.is_planned);
        const planned = allExercises.filter((e) => e.is_planned);
        const display = actual.length > 0 ? actual : planned;
        const names = display.map((e) => e.name).slice(0, 3);
        const summary =
          names.length > 0
            ? names.join(', ') +
              (display.length > 3 ? ` +${display.length - 3} more` : '')
            : '';

        return { ...w, exercise_summary: summary, exercises: allExercises };
      });

      const upcoming = rows
        .filter((w) => w.status === 'planned' && w.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date));

      const past = rows.filter(
        (w) => !(w.status === 'planned' && w.date >= todayStr),
      );

      const newSections: Section[] = [];
      if (upcoming.length > 0) {
        newSections.push({ title: 'Upcoming Plans', data: upcoming });
      }
      if (past.length > 0) {
        newSections.push({ title: 'Past Workouts', data: past });
      }
      setSections(newSections);
    }
    setLoading(false);
  }, [user, todayStr]);

  useFocusEffect(
    useCallback(() => {
      fetchWorkouts();
    }, [fetchWorkouts]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWorkouts();
    setRefreshing(false);
  };

  const deleteWorkout = (item: WorkoutRow) => {
    swipeableRefs.current.get(item.id)?.close();
    Alert.alert(
      'Delete Workout',
      `Delete this ${item.type ?? 'workout'} from ${formatDate(item.date)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            LayoutAnimation.configureNext(
              LayoutAnimation.Presets.easeInEaseOut,
            );
            await supabase.from('workouts').delete().eq('id', item.id);
            setSections((prev) =>
              prev
                .map((s) => ({
                  ...s,
                  data: s.data.filter((w) => w.id !== item.id),
                }))
                .filter((s) => s.data.length > 0),
            );
            if (expandedId === item.id) setExpandedId(null);
          },
        },
      ],
    );
  };

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const startPlannedWorkout = async (item: WorkoutRow) => {
    await supabase
      .from('workouts')
      .update({ status: 'in_progress' })
      .eq('id', item.id);

    const planned = item.exercises.filter((e) => e.is_planned);
    for (const p of planned) {
      const { data: actual } = await supabase
        .from('workout_exercises')
        .insert({
          workout_id: item.id,
          name: p.name,
          exercise_type: p.exercise_type,
          exercise_order: p.exercise_order,
          is_planned: false,
        })
        .select()
        .single();

      if (actual && p.sets.length > 0) {
        const setInserts = p.sets.map((s, i) => ({
          exercise_id: actual.id,
          set_number: i + 1,
          weight: s.weight,
          reps: s.reps,
        }));
        await supabase.from('exercise_sets').insert(setInserts);
      }
    }

    navigation.getParent()?.navigate('WorkoutScreen', {
      workoutId: item.id,
      mode: 'log',
    });
  };

  const editPlan = (item: WorkoutRow) => {
    navigation.getParent()?.navigate('WorkoutScreen', {
      workoutId: item.id,
      mode: 'plan',
    });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const dayName = DAY_NAMES[d.getDay()];
    return `${dayName}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'in_progress':
        return colors.warning;
      default:
        return colors.primary;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return null;
      case 'in_progress':
        return 'In Progress';
      default:
        return 'Planned';
    }
  };

  const formatSetLine = (set: {
    weight: number | null;
    reps: number | null;
    rpe: number | null;
  }) => {
    const parts: string[] = [];
    if (set.weight != null) parts.push(`${set.weight}`);
    if (set.reps != null) parts.push(`${set.reps}`);
    const main = parts.join(' × ');
    return set.rpe != null ? `${main} @${set.rpe}` : main;
  };

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
    item: WorkoutRow,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    });

    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => deleteWorkout(item)}
        activeOpacity={0.8}
      >
        <Animated.View
          style={{ transform: [{ scale }], alignItems: 'center' }}
        >
          <SymbolView
            name="trash.fill"
            tintColor="#fff"
            style={{ width: 22, height: 22 }}
            type="monochrome"
          />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderExerciseDetail = (exercise: ExerciseDetail, index: number) => (
    <View
      key={`${exercise.id}-${index}`}
      style={styles.detailExercise}
    >
      <Text style={styles.detailExerciseName}>{exercise.name}</Text>

      {exercise.exercise_type === 'strength' && exercise.sets.length > 0 && (
        <View style={styles.detailSets}>
          {exercise.sets.map((set, i) => (
            <Text key={i} style={styles.detailSetLine}>
              Set {i + 1} — {formatSetLine(set) || '—'}
            </Text>
          ))}
        </View>
      )}

      {exercise.exercise_type === 'cardio' && exercise.cardio && (
        <View style={styles.detailSets}>
          {exercise.cardio.duration_minutes != null && (
            <Text style={styles.detailSetLine}>
              {exercise.cardio.duration_minutes} min
            </Text>
          )}
          {exercise.cardio.distance != null && (
            <Text style={styles.detailSetLine}>
              {exercise.cardio.distance} mi
            </Text>
          )}
          {exercise.cardio.pace && (
            <Text style={styles.detailSetLine}>
              Pace: {exercise.cardio.pace}
            </Text>
          )}
          {exercise.cardio.heart_rate != null && (
            <Text style={styles.detailSetLine}>
              HR: {exercise.cardio.heart_rate}
            </Text>
          )}
          {exercise.cardio.notes && (
            <Text style={styles.detailSetLine}>{exercise.cardio.notes}</Text>
          )}
        </View>
      )}
    </View>
  );

  const renderWorkout = ({ item }: { item: WorkoutRow }) => {
    const isExpanded = expandedId === item.id;
    const actual = item.exercises.filter((e) => !e.is_planned);
    const planned = item.exercises.filter((e) => e.is_planned);
    const isUpcomingPlan = item.status === 'planned' && item.date >= todayStr;
    const label = statusLabel(item.status);

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(item.id, ref);
          else swipeableRefs.current.delete(item.id);
        }}
        renderRightActions={(progress, dragX) =>
          renderRightActions(progress, dragX, item)
        }
        overshootRight={false}
        friction={2}
      >
        <TouchableOpacity
          style={[
            styles.card,
            isUpcomingPlan && styles.cardPlanned,
          ]}
          activeOpacity={0.7}
          onPress={() => {
            if (item.status === 'in_progress') {
              navigation.getParent()?.navigate('WorkoutScreen', {
                workoutId: item.id,
                mode: 'log',
              });
            } else {
              toggleExpand(item.id);
            }
          }}
        >
          {/* Summary row */}
          <View style={styles.cardHeader}>
            <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
            <View style={styles.cardHeaderRight}>
              {label && (
                <Text
                  style={[
                    styles.cardStatus,
                    { color: statusColor(item.status) },
                  ]}
                >
                  {label}
                </Text>
              )}
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: statusColor(item.status) },
                ]}
              />
            </View>
          </View>

          {item.type && <Text style={styles.cardType}>{item.type}</Text>}

          {!isExpanded && item.exercise_summary ? (
            <Text style={styles.cardExercises} numberOfLines={2}>
              {item.exercise_summary}
            </Text>
          ) : null}

          {/* Expanded detail drawer */}
          {isExpanded && (
            <View style={styles.detailDrawer}>
              {item.ai_summary && (
                <View style={styles.detailSummary}>
                  <Text style={styles.detailSummaryText}>
                    {item.ai_summary}
                  </Text>
                </View>
              )}

              {/* Show planned/actual sections */}
              {planned.length > 0 && actual.length > 0 && (
                <Text style={styles.detailSectionLabel}>Planned</Text>
              )}
              {planned.length > 0 &&
                planned.map((e, i) => renderExerciseDetail(e, i))}

              {actual.length > 0 && planned.length > 0 && (
                <Text
                  style={[
                    styles.detailSectionLabel,
                    { marginTop: spacing.md },
                  ]}
                >
                  Actual
                </Text>
              )}
              {actual.length > 0 &&
                actual.map((e, i) => renderExerciseDetail(e, i))}

              {/* Only planned exercises, no actual yet — show them without label */}
              {planned.length > 0 && actual.length === 0 && item.status === 'planned' && null}

              {actual.length === 0 && planned.length === 0 && (
                <Text style={styles.detailEmpty}>No exercises logged.</Text>
              )}

              {/* Action buttons for planned workouts */}
              {isUpcomingPlan && (
                <View style={styles.planActions}>
                  <TouchableOpacity
                    style={styles.editPlanButton}
                    onPress={() => editPlan(item)}
                    activeOpacity={0.8}
                  >
                    <SymbolView
                      name="pencil"
                      tintColor={colors.primary}
                      style={{ width: 16, height: 16 }}
                      type="monochrome"
                    />
                    <Text style={styles.editPlanText}>Edit Plan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.startWorkoutButton}
                    onPress={() => startPlannedWorkout(item)}
                    activeOpacity={0.8}
                  >
                    <SymbolView
                      name="play.fill"
                      tintColor="#fff"
                      style={{ width: 14, height: 14 }}
                      type="monochrome"
                    />
                    <Text style={styles.startWorkoutText}>Start Workout</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: { title: string };
  }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isEmpty = sections.every((s) => s.data.length === 0);

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={
        isEmpty ? styles.emptyContainer : styles.listContent
      }
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={renderWorkout}
      renderSectionHeader={renderSectionHeader}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textTertiary} colors={[colors.primary]} />
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Workouts Yet</Text>
          <Text style={styles.emptySubtitle}>
            Start by asking Setpoint what you should do next.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
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
  },

  // Section header
  sectionHeader: {
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardPlanned: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardType: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.xs,
  },
  cardExercises: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  cardStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  chevron: {
    textAlign: 'center',
    color: colors.textTertiary,
    fontSize: 10,
    marginTop: spacing.sm,
  },

  // Delete swipe action
  deleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 12,
    marginBottom: spacing.sm,
    marginLeft: spacing.sm,
  },

  // Detail drawer
  detailDrawer: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  detailSummary: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  detailSummaryText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  detailSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  detailExercise: {
    marginBottom: spacing.sm,
  },
  detailExerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  detailSets: {
    marginTop: 2,
  },
  detailSetLine: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingLeft: spacing.sm,
  },
  detailEmpty: {
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },

  // Plan action buttons
  planActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  editPlanButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary + '12',
    borderRadius: 10,
    paddingVertical: spacing.sm + 2,
  },
  editPlanText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  startWorkoutButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.sm + 2,
  },
  startWorkoutText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
