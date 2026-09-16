import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import { ExerciseSet, ExerciseWithSets } from '../types/database';

// ─── Feedback types ─────────────────────────────────────────
type PlanAdjustment = {
  date: string;
  workout_type: string;
  suggestion: string;
};

type WorkoutFeedback = {
  performance_summary: string;
  progression_notes: string;
  recovery_note: string;
  plan_adjustments: PlanAdjustment[];
  coach_tip: string;
};

// ─── Set Row ────────────────────────────────────────────────
function SetRow({
  set,
  onUpdate,
  onDelete,
}: {
  set: ExerciseSet;
  onUpdate: (field: 'weight' | 'reps' | 'rpe', value: string) => void;
  onDelete: () => void;
}) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');

  return (
    <View style={styles.setRow}>
      <Text style={styles.setNumber}>{set.set_number}</Text>
      <TextInput
        style={styles.setInput}
        value={weight}
        onChangeText={setWeight}
        onEndEditing={() => onUpdate('weight', weight)}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
      />
      <TextInput
        style={styles.setInput}
        value={reps}
        onChangeText={setReps}
        onEndEditing={() => onUpdate('reps', reps)}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
      />
      <TextInput
        style={[styles.setInput, styles.setInputSmall]}
        value={rpe}
        onChangeText={setRpe}
        onEndEditing={() => onUpdate('rpe', rpe)}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
        selectTextOnFocus
      />
      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.deleteSet}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Cardio Fields ──────────────────────────────────────────
function CardioFields({
  exerciseId,
  cardio,
  onSaved,
}: {
  exerciseId: string;
  cardio?: ExerciseWithSets['cardio'];
  onSaved: () => void;
}) {
  const [duration, setDuration] = useState(
    cardio?.duration_minutes?.toString() ?? '',
  );
  const [distance, setDistance] = useState(
    cardio?.distance?.toString() ?? '',
  );
  const [pace, setPace] = useState(cardio?.pace ?? '');
  const [hr, setHr] = useState(cardio?.heart_rate?.toString() ?? '');
  const [notes, setNotes] = useState(cardio?.notes ?? '');

  const save = async (field: string, value: string) => {
    const isText = field === 'pace' || field === 'notes';
    const parsed = isText ? value : value === '' ? null : parseFloat(value);
    if (cardio?.id) {
      await supabase
        .from('cardio_entries')
        .update({ [field]: parsed })
        .eq('id', cardio.id);
    } else {
      await supabase.from('cardio_entries').insert({
        exercise_id: exerciseId,
        [field]: parsed,
      });
      onSaved();
    }
  };

  const row = (
    label: string,
    value: string,
    setter: (v: string) => void,
    field: string,
    numeric: boolean,
  ) => (
    <View style={styles.cardioRow}>
      <Text style={styles.cardioLabel}>{label}</Text>
      <TextInput
        style={styles.cardioInput}
        value={value}
        onChangeText={setter}
        onEndEditing={() => save(field, value)}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  );

  return (
    <View style={styles.cardioFields}>
      {row('Duration (min)', duration, setDuration, 'duration_minutes', true)}
      {row('Distance', distance, setDistance, 'distance', true)}
      {row('Pace', pace, setPace, 'pace', false)}
      {row('Heart Rate', hr, setHr, 'heart_rate', true)}
      {row('Notes', notes, setNotes, 'notes', false)}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────
export default function WorkoutScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const { workoutId, mode = 'log' } = route.params as {
    workoutId: string;
    mode?: 'log' | 'plan';
  };
  const isPlanning = mode === 'plan';

  const [exercises, setExercises] = useState<ExerciseWithSets[]>([]);
  const [workoutType, setWorkoutType] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [workoutStatus, setWorkoutStatus] = useState('');
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseType, setNewExerciseType] = useState<
    'strength' | 'cardio'
  >('strength');
  const [feedback, setFeedback] = useState<WorkoutFeedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const fetchExercises = useCallback(async () => {
    const { data: workout } = await supabase
      .from('workouts')
      .select('type, status')
      .eq('id', workoutId)
      .single();
    if (workout) {
      setWorkoutType(workout.type ?? '');
      setWorkoutStatus(workout.status);
    }

    const { data } = await supabase
      .from('workout_exercises')
      .select('*, exercise_sets(*), cardio_entries(*)')
      .eq('workout_id', workoutId)
      .eq('is_planned', isPlanning)
      .order('exercise_order');

    if (data) {
      setExercises(
        data.map((e: any) => ({
          ...e,
          sets: (e.exercise_sets ?? []).sort(
            (a: ExerciseSet, b: ExerciseSet) => a.set_number - b.set_number,
          ),
          cardio: e.cardio_entries?.[0] ?? undefined,
        })),
      );
    }
  }, [workoutId, isPlanning]);

  useFocusEffect(
    useCallback(() => {
      fetchExercises();
    }, [fetchExercises]),
  );

  const addExercise = async () => {
    if (!newExerciseName.trim()) return;

    const { error } = await supabase.from('workout_exercises').insert({
      workout_id: workoutId,
      name: newExerciseName.trim(),
      exercise_type: newExerciseType,
      exercise_order: exercises.length,
      is_planned: isPlanning,
    });

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setNewExerciseName('');
    setShowAddExercise(false);
    fetchExercises();
  };

  const addSet = async (exercise: ExerciseWithSets) => {
    const last = exercise.sets[exercise.sets.length - 1];
    const { error } = await supabase.from('exercise_sets').insert({
      exercise_id: exercise.id,
      set_number: exercise.sets.length + 1,
      weight: last?.weight ?? null,
      reps: last?.reps ?? null,
    });
    if (error) Alert.alert('Error', error.message);
    else fetchExercises();
  };

  const updateSet = async (
    setId: string,
    field: 'weight' | 'reps' | 'rpe',
    value: string,
  ) => {
    const numValue = value === '' ? null : parseFloat(value);
    await supabase
      .from('exercise_sets')
      .update({ [field]: numValue })
      .eq('id', setId);
  };

  const deleteSet = async (setId: string) => {
    await supabase.from('exercise_sets').delete().eq('id', setId);
    fetchExercises();
  };

  const removeExercise = (exercise: ExerciseWithSets) => {
    Alert.alert('Remove Exercise', `Remove ${exercise.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase
            .from('workout_exercises')
            .delete()
            .eq('id', exercise.id);
          fetchExercises();
        },
      },
    ]);
  };

  const finishWorkout = async () => {
    const { error } = await supabase
      .from('workouts')
      .update({ status: 'completed' })
      .eq('id', workoutId);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setFeedbackLoading(true);
    setShowFeedback(true);

    try {
      const { data, error: fbError } = await supabase.functions.invoke(
        'workout-feedback',
        { body: { workoutId } },
      );
      if (fbError) throw fbError;
      setFeedback(data);
    } catch (err: any) {
      console.warn('Feedback failed:', err.message);
      setFeedback(null);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const dismissFeedback = () => {
    setShowFeedback(false);
    setFeedback(null);
    navigation.goBack();
  };

  const savePlan = () => {
    Alert.alert('Plan Saved', 'Your workout plan has been updated.');
    navigation.goBack();
  };

  const saveTitle = async (title: string) => {
    const trimmed = title.trim();
    setWorkoutType(trimmed);
    setEditingTitle(false);
    await supabase
      .from('workouts')
      .update({ type: trimmed || null })
      .eq('id', workoutId);
  };

  const headerTitle = isPlanning
    ? `Plan — ${workoutType || 'Workout'}`
    : workoutType || 'Workout';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      {/* Feedback Modal */}
      <Modal
        visible={showFeedback}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={dismissFeedback}
      >
        <View style={styles.feedbackModal}>
          <ScrollView
            contentContainerStyle={styles.feedbackContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.feedbackTitle}>Workout Complete 🎯</Text>

            {feedbackLoading && (
              <View style={styles.feedbackLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.feedbackLoadingText}>
                  Analyzing your workout…
                </Text>
              </View>
            )}

            {!feedbackLoading && feedback && (
              <>
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackLabel}>Performance</Text>
                  <Text style={styles.feedbackText}>
                    {feedback.performance_summary}
                  </Text>
                </View>

                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackLabel}>Progression</Text>
                  <Text style={styles.feedbackText}>
                    {feedback.progression_notes}
                  </Text>
                </View>

                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackLabel}>Recovery</Text>
                  <Text style={styles.feedbackText}>
                    {feedback.recovery_note}
                  </Text>
                </View>

                {feedback.plan_adjustments.length > 0 && (
                  <View style={styles.feedbackCard}>
                    <Text style={styles.feedbackLabel}>
                      Plan Adjustments
                    </Text>
                    {feedback.plan_adjustments.map((adj, i) => (
                      <View key={i} style={styles.adjustmentRow}>
                        <Text style={styles.adjustmentDate}>
                          {adj.date} — {adj.workout_type}
                        </Text>
                        <Text style={styles.adjustmentText}>
                          {adj.suggestion}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={[styles.feedbackCard, styles.tipCard]}>
                  <Text style={styles.feedbackLabel}>💡 Coach Tip</Text>
                  <Text style={styles.feedbackText}>
                    {feedback.coach_tip}
                  </Text>
                </View>
              </>
            )}

            {!feedbackLoading && !feedback && (
              <Text style={styles.feedbackFallback}>
                Workout saved! Feedback is unavailable right now.
              </Text>
            )}

            <TouchableOpacity
              style={styles.feedbackDoneButton}
              onPress={dismissFeedback}
              activeOpacity={0.8}
            >
              <Text style={styles.feedbackDoneText}>Done</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {editingTitle ? (
          <TextInput
            style={styles.titleInput}
            value={workoutType}
            onChangeText={setWorkoutType}
            onEndEditing={() => saveTitle(workoutType)}
            onSubmitEditing={() => saveTitle(workoutType)}
            autoFocus
            placeholder="Workout title…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingTitle(true)} activeOpacity={0.6}>
            <Text style={styles.title}>
              {headerTitle || 'Tap to name workout'}
              <Text style={styles.titleEditHint}> ✎</Text>
            </Text>
          </TouchableOpacity>
        )}
        {isPlanning && (
          <Text style={styles.planningHint}>
            Edit exercises and sets for this plan. Changes save automatically.
          </Text>
        )}

        {exercises.map((exercise) => (
          <View key={exercise.id} style={styles.exerciseCard}>
            <TouchableOpacity
              onLongPress={() => removeExercise(exercise)}
              activeOpacity={0.7}
            >
              <Text style={styles.exerciseName}>{exercise.name}</Text>
            </TouchableOpacity>

            {exercise.exercise_type === 'strength' ? (
              <>
                <View style={styles.setHeader}>
                  <Text style={styles.setHeaderNum}>#</Text>
                  <Text style={styles.setHeaderText}>WEIGHT</Text>
                  <Text style={styles.setHeaderText}>REPS</Text>
                  <Text style={[styles.setHeaderText, styles.setHeaderSmall]}>
                    RPE
                  </Text>
                  <View style={{ width: 28 }} />
                </View>

                {exercise.sets.map((set) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    onUpdate={(field, value) => updateSet(set.id, field, value)}
                    onDelete={() => deleteSet(set.id)}
                  />
                ))}

                <TouchableOpacity
                  style={styles.addSetButton}
                  onPress={() => addSet(exercise)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.addSetText}>+ Add Set</Text>
                </TouchableOpacity>
              </>
            ) : (
              <CardioFields
                exerciseId={exercise.id}
                cardio={exercise.cardio}
                onSaved={fetchExercises}
              />
            )}
          </View>
        ))}

        {showAddExercise ? (
          <View style={styles.addExerciseForm}>
            <TextInput
              style={styles.addExerciseInput}
              value={newExerciseName}
              onChangeText={setNewExerciseName}
              placeholder="Exercise name"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addExercise}
            />
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  newExerciseType === 'strength' && styles.typeButtonActive,
                ]}
                onPress={() => setNewExerciseType('strength')}
              >
                <Text
                  style={[
                    styles.typeButtonText,
                    newExerciseType === 'strength' &&
                      styles.typeButtonTextActive,
                  ]}
                >
                  Strength
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  newExerciseType === 'cardio' && styles.typeButtonActive,
                ]}
                onPress={() => setNewExerciseType('cardio')}
              >
                <Text
                  style={[
                    styles.typeButtonText,
                    newExerciseType === 'cardio' && styles.typeButtonTextActive,
                  ]}
                >
                  Cardio
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.addExerciseActions}>
              <TouchableOpacity onPress={() => setShowAddExercise(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addButton} onPress={addExercise}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addExerciseButton}
            onPress={() => setShowAddExercise(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.addExerciseButtonText}>+ Add Exercise</Text>
          </TouchableOpacity>
        )}

        {/* Bottom action */}
        {isPlanning ? (
          <TouchableOpacity
            style={styles.savePlanButton}
            onPress={savePlan}
            activeOpacity={0.8}
          >
            <Text style={styles.savePlanButtonText}>Done Editing Plan</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.finishButton}
            onPress={finishWorkout}
            activeOpacity={0.8}
          >
            <Text style={styles.finishButtonText}>Finish Workout</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  titleEditHint: {
    fontSize: 16,
    color: colors.textTertiary,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
    padding: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingBottom: spacing.xs,
  },
  planningHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  setHeaderNum: {
    width: 28,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  setHeaderText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  setHeaderSmall: { flex: 0.6 },

  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  setNumber: {
    width: 28,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  setInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginHorizontal: 3,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  setInputSmall: { flex: 0.6 },
  deleteSet: {
    width: 28,
    textAlign: 'center',
    fontSize: 14,
    color: colors.textTertiary,
  },

  addSetButton: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  addSetText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },

  cardioFields: { marginTop: spacing.xs },
  cardioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardioLabel: {
    width: 110,
    fontSize: 14,
    color: colors.textSecondary,
  },
  cardioInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },

  addExerciseButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  addExerciseButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  addExerciseForm: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  addExerciseInput: {
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  typeToggle: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  typeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.background,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeButtonText: { fontSize: 14, color: colors.textSecondary },
  typeButtonTextActive: { color: '#fff', fontWeight: '600' },
  addExerciseActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancelText: { color: colors.textSecondary, fontSize: 15 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  finishButton: {
    backgroundColor: colors.success,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  finishButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  savePlanButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  savePlanButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Feedback modal
  feedbackModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  feedbackContent: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl * 2,
  },
  feedbackTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  feedbackLoading: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  feedbackLoadingText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  feedbackCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tipCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  feedbackLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  feedbackText: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  adjustmentRow: {
    marginBottom: spacing.sm,
  },
  adjustmentDate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 2,
  },
  adjustmentText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  feedbackFallback: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  feedbackDoneButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  feedbackDoneText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
