import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import {
  Workout,
  WorkoutExercise,
  ExerciseSet,
  WeeklyScheduleEntry,
  DAY_NAMES,
} from '../types/database';

type PlannedExercise = WorkoutExercise & { sets: ExerciseSet[] };

export default function TodayScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [todayWorkout, setTodayWorkout] = useState<Workout | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExercise[]>(
    [],
  );
  const [actualExercises, setActualExercises] = useState<PlannedExercise[]>([]);
  const [schedule, setSchedule] = useState<WeeklyScheduleEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const today = new Date();
  const dayOfWeek = today.getDay();
  const dateStr = today.toISOString().split('T')[0];

  const fetchData = useCallback(async () => {
    if (!user) return;

    const { data: scheduleData } = await supabase
      .from('weekly_schedule')
      .select('*')
      .eq('user_id', user.id)
      .eq('day_of_week', dayOfWeek)
      .single();

    setSchedule(scheduleData);

    const { data: workoutData } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', dateStr)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setTodayWorkout(workoutData);

    if (workoutData) {
      const { data: planned } = await supabase
        .from('workout_exercises')
        .select('*, exercise_sets(*)')
        .eq('workout_id', workoutData.id)
        .eq('is_planned', true)
        .order('exercise_order');

      setPlannedExercises(
        (planned ?? []).map((e: any) => ({
          ...e,
          sets: (e.exercise_sets ?? []).sort(
            (a: ExerciseSet, b: ExerciseSet) => a.set_number - b.set_number,
          ),
        })),
      );

      const { data: actual } = await supabase
        .from('workout_exercises')
        .select('*, exercise_sets(*)')
        .eq('workout_id', workoutData.id)
        .eq('is_planned', false)
        .order('exercise_order');

      setActualExercises(
        (actual ?? []).map((e: any) => ({
          ...e,
          sets: (e.exercise_sets ?? []).sort(
            (a: ExerciseSet, b: ExerciseSet) => a.set_number - b.set_number,
          ),
        })),
      );
    } else {
      setPlannedExercises([]);
      setActualExercises([]);
    }

    setLoading(false);
  }, [user, dayOfWeek, dateStr]);

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

  const askAI = async () => {
    if (!user) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'recommend-workout',
        { body: { date: dateStr } },
      );
      if (error) throw error;
      if (!data?.workout) throw new Error('No workout returned from AI');

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          user_id: user.id,
          date: dateStr,
          type: data.workout.type,
          status: 'planned' as const,
          ai_summary: data.summary,
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      for (let i = 0; i < data.workout.exercises.length; i++) {
        const ex = data.workout.exercises[i];
        const { data: exercise, error: exError } = await supabase
          .from('workout_exercises')
          .insert({
            workout_id: workout.id,
            name: ex.name,
            exercise_type: ex.exercise_type ?? 'strength',
            exercise_order: i,
            is_planned: true,
          })
          .select()
          .single();

        if (exError) throw exError;

        if (
          ex.exercise_type !== 'cardio' &&
          ex.sets != null &&
          ex.reps != null
        ) {
          const setInserts = Array.from({ length: ex.sets }, (_, s) => ({
            exercise_id: exercise.id,
            set_number: s + 1,
            weight: ex.weight ?? null,
            reps: ex.reps,
          }));
          const { error: setErr } = await supabase
            .from('exercise_sets')
            .insert(setInserts);
          if (setErr) throw setErr;
        }

        if (ex.exercise_type === 'cardio') {
          await supabase.from('cardio_entries').insert({
            exercise_id: exercise.id,
            duration_minutes: ex.duration_minutes ?? null,
            distance: ex.distance ?? null,
            pace: ex.pace ?? null,
          });
        }
      }

      await fetchData();
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.message || 'Failed to get AI recommendation.',
      );
    } finally {
      setAiLoading(false);
    }
  };

  const startWorkout = async () => {
    if (!todayWorkout) return;

    await supabase
      .from('workouts')
      .update({ status: 'in_progress' })
      .eq('id', todayWorkout.id);

    for (const planned of plannedExercises) {
      const { data: actual } = await supabase
        .from('workout_exercises')
        .insert({
          workout_id: todayWorkout.id,
          name: planned.name,
          exercise_type: planned.exercise_type,
          exercise_order: planned.exercise_order,
          is_planned: false,
        })
        .select()
        .single();

      if (actual && planned.sets.length > 0) {
        const setInserts = planned.sets.map((s) => ({
          exercise_id: actual.id,
          set_number: s.set_number,
          weight: s.weight,
          reps: s.reps,
        }));
        await supabase.from('exercise_sets').insert(setInserts);
      }
    }

    navigation.getParent()?.navigate('WorkoutScreen', { workoutId: todayWorkout.id });
  };

  const startBlankWorkout = async () => {
    if (!user) return;

    const { data: workout, error } = await supabase
      .from('workouts')
      .insert({
        user_id: user.id,
        date: dateStr,
        type: schedule?.session_type ?? null,
        status: 'in_progress' as const,
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    navigation.getParent()?.navigate('WorkoutScreen', { workoutId: workout.id });
  };

  const formatSets = (exercise: PlannedExercise) => {
    if (exercise.sets.length === 0) return '';
    const first = exercise.sets[0];
    const weight = first.weight != null ? `${first.weight}` : '';
    const reps = first.reps != null ? `${first.reps}` : '';
    const count = exercise.sets.length;

    if (weight && reps) {
      return count > 1 ? `${weight} × ${reps} × ${count}` : `${weight} × ${reps}`;
    }
    if (reps) return count > 1 ? `${reps} reps × ${count}` : `${reps} reps`;
    return '';
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const showCompleted =
    todayWorkout?.status === 'completed' && actualExercises.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textTertiary} colors={[colors.primary]} />
      }
    >
      <Text style={styles.dateText}>{DAY_NAMES[dayOfWeek]}</Text>
      <Text style={styles.dateSubtext}>
        {today.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
      </Text>

      {schedule && (
        <View style={styles.scheduleChip}>
          <Text style={styles.scheduleText}>{schedule.session_type}</Text>
        </View>
      )}

      {todayWorkout?.ai_summary && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryText}>{todayWorkout.ai_summary}</Text>
        </View>
      )}

      {/* Planned exercises */}
      {plannedExercises.length > 0 && (
        <View style={styles.planCard}>
          <Text style={styles.planTitle}>
            Planned — {todayWorkout?.type ?? 'Workout'}
          </Text>
          {plannedExercises.map((exercise) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <Text style={styles.exerciseName}>{exercise.name}</Text>
              <Text style={styles.exerciseSets}>{formatSets(exercise)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Actual exercises (shown for completed workouts) */}
      {showCompleted && (
        <View style={[styles.planCard, { borderLeftWidth: 3, borderLeftColor: colors.success }]}>
          <Text style={styles.planTitle}>
            Actual — {todayWorkout?.type ?? 'Workout'}
          </Text>
          {actualExercises.map((exercise) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <Text style={styles.exerciseName}>{exercise.name}</Text>
              {exercise.sets.map((set) => (
                <Text key={set.id} style={styles.setDetail}>
                  {set.weight != null ? `${set.weight} × ` : ''}
                  {set.reps ?? '—'}
                  {set.rpe != null ? ` @${set.rpe}` : ''}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        {todayWorkout?.status === 'planned' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startWorkout}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Start Workout</Text>
          </TouchableOpacity>
        )}

        {todayWorkout?.status === 'in_progress' && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() =>
              navigation.getParent()?.navigate('WorkoutScreen', {
                workoutId: todayWorkout.id,
              })
            }
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Continue Workout</Text>
          </TouchableOpacity>
        )}

        {!todayWorkout && (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, aiLoading && styles.buttonDisabled]}
              onPress={askAI}
              disabled={aiLoading}
              activeOpacity={0.8}
            >
              {aiLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={[styles.primaryButtonText, { marginLeft: spacing.sm }]}>
                    Thinking…
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>
                  What should I do next?
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={startBlankWorkout}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>
                Start Blank Workout
              </Text>
            </TouchableOpacity>
          </>
        )}

        {todayWorkout?.status === 'completed' && (
          <>
            <View style={styles.completedBadge}>
              <Text style={styles.completedText}>✓ Workout Complete</Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: spacing.md }, aiLoading && styles.buttonDisabled]}
              onPress={askAI}
              disabled={aiLoading}
              activeOpacity={0.8}
            >
              {aiLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={[styles.primaryButtonText, { marginLeft: spacing.sm }]}>
                    Thinking…
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>
                  What should I do next?
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, { marginTop: spacing.sm }]}
              onPress={startBlankWorkout}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>
                Start Blank Workout
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  dateText: { fontSize: 28, fontWeight: '700', color: colors.text },
  dateSubtext: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  scheduleChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  scheduleText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  summaryText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  exerciseRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  exerciseName: { fontSize: 15, color: colors.text, fontWeight: '500' },
  exerciseSets: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  setDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  actions: { marginTop: spacing.xl },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.text, fontSize: 16, fontWeight: '500' },
  completedBadge: {
    backgroundColor: colors.success + '15',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  completedText: { color: colors.success, fontSize: 16, fontWeight: '600' },
});
