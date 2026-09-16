import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import { DAY_NAMES } from '../types/database';

// ─── Types ──────────────────────────────────────────────────

type ImportSet = {
  set_number: number;
  weight: number | null;
  reps: number | null;
};

type ImportExercise = {
  name: string;
  exercise_type: 'strength' | 'cardio';
  sets?: ImportSet[];
  duration_minutes?: number | null;
  distance?: number | null;
  pace?: string | null;
  heart_rate?: number | null;
  notes?: string | null;
};

type ImportWorkout = {
  date: string;
  type: string;
  exercises: ImportExercise[];
  notes: string | null;
  selected: boolean;
};

// ─── Main Screen ────────────────────────────────────────────

export default function ImportScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState<ImportWorkout[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [step, setStep] = useState<'pick' | 'review' | 'done'>('pick');

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.uri) return;

      setParsing(true);
      setStep('review');

      const response = await fetch(file.uri);
      const csvText = await response.text();

      const { data, error } = await supabase.functions.invoke(
        'import-workouts',
        { body: { csv: csvText } },
      );

      if (error) throw error;
      if (!data?.workouts) throw new Error('No workouts returned');

      const parsed: ImportWorkout[] = data.workouts.map((w: any) => ({
        ...w,
        selected: true,
      }));

      setWorkouts(parsed);
    } catch (err: any) {
      Alert.alert('Parse Error', err.message || 'Failed to parse CSV');
      setStep('pick');
    } finally {
      setParsing(false);
    }
  };

  const toggleWorkout = (idx: number) => {
    setWorkouts((prev) =>
      prev.map((w, i) =>
        i === idx ? { ...w, selected: !w.selected } : w,
      ),
    );
  };

  const toggleAll = (selected: boolean) => {
    setWorkouts((prev) => prev.map((w) => ({ ...w, selected })));
  };

  const toggleExpand = (idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  };

  const importSelected = async () => {
    if (!user) return;
    const selected = workouts.filter((w) => w.selected);
    if (selected.length === 0) {
      Alert.alert('Nothing Selected', 'Select at least one workout to import.');
      return;
    }

    setImporting(true);

    try {
      let imported = 0;

      for (const w of selected) {
        const { data: workout, error: wErr } = await supabase
          .from('workouts')
          .insert({
            user_id: user.id,
            date: w.date,
            type: w.type,
            status: 'completed',
            notes: w.notes,
          })
          .select()
          .single();

        if (wErr) {
          console.warn(`Failed to import ${w.date}:`, wErr.message);
          continue;
        }

        for (let i = 0; i < w.exercises.length; i++) {
          const ex = w.exercises[i];
          const { data: exercise, error: exErr } = await supabase
            .from('workout_exercises')
            .insert({
              workout_id: workout.id,
              name: ex.name,
              exercise_type: ex.exercise_type,
              exercise_order: i,
              is_planned: false,
            })
            .select()
            .single();

          if (exErr) continue;

          if (ex.exercise_type === 'strength' && ex.sets && ex.sets.length > 0) {
            const setInserts = ex.sets.map((s) => ({
              exercise_id: exercise.id,
              set_number: s.set_number,
              weight: s.weight,
              reps: s.reps,
            }));
            await supabase.from('exercise_sets').insert(setInserts);
          }

          if (ex.exercise_type === 'cardio') {
            await supabase.from('cardio_entries').insert({
              exercise_id: exercise.id,
              duration_minutes: ex.duration_minutes ?? null,
              distance: ex.distance ?? null,
              pace: ex.pace ?? null,
              heart_rate: ex.heart_rate ?? null,
              notes: ex.notes ?? null,
            });
          }
        }

        imported++;
      }

      setStep('done');
      Alert.alert(
        'Import Complete',
        `Successfully imported ${imported} workout${imported !== 1 ? 's' : ''}.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } catch (err: any) {
      Alert.alert('Import Error', err.message || 'Failed to import workouts');
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    const dayName = DAY_NAMES[d.getDay()];
    return `${dayName}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const formatExerciseSummary = (ex: ImportExercise) => {
    if (ex.exercise_type === 'cardio') {
      const parts: string[] = [];
      if (ex.duration_minutes) parts.push(`${ex.duration_minutes} min`);
      if (ex.distance) parts.push(`${ex.distance} mi`);
      if (ex.pace) parts.push(ex.pace);
      return parts.length > 0 ? parts.join(', ') : ex.notes ?? '';
    }
    if (ex.sets && ex.sets.length > 0) {
      const first = ex.sets[0];
      const w = first.weight != null ? `${first.weight}` : 'BW';
      const r = first.reps != null ? `${first.reps}` : '—';
      return ex.sets.length > 1
        ? `${w} × ${r} × ${ex.sets.length}`
        : `${w} × ${r}`;
    }
    return '';
  };

  const selectedCount = workouts.filter((w) => w.selected).length;

  // ─── Pick step ────────────────────────────────────────────

  if (step === 'pick') {
    return (
      <View style={styles.centered}>
        <Text style={styles.pickTitle}>Import Workout History</Text>
        <Text style={styles.pickSubtitle}>
          Select a CSV file from your device. Setpoint will use AI to parse
          your data into structured workout records.
        </Text>
        <TouchableOpacity
          style={styles.pickButton}
          onPress={pickFile}
          activeOpacity={0.8}
        >
          <Text style={styles.pickButtonText}>Select CSV File</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Review step ──────────────────────────────────────────

  return (
    <View style={styles.container}>
      {parsing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.parsingText}>
            Parsing your workout history…
          </Text>
          <Text style={styles.parsingSubtext}>
            This may take a moment for large files.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scrollContainer}
            contentContainerStyle={styles.reviewContent}
          >
            {/* Header */}
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>
                {workouts.length} Workout{workouts.length !== 1 ? 's' : ''}{' '}
                Found
              </Text>
              <View style={styles.selectAllRow}>
                <TouchableOpacity onPress={() => toggleAll(true)}>
                  <Text style={styles.selectAllText}>Select All</Text>
                </TouchableOpacity>
                <Text style={styles.selectAllDivider}> / </Text>
                <TouchableOpacity onPress={() => toggleAll(false)}>
                  <Text style={styles.selectAllText}>None</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Workout list */}
            {workouts.map((w, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <View key={`${w.date}-${idx}`} style={styles.importCard}>
                  <TouchableOpacity
                    style={styles.importCardHeader}
                    onPress={() => toggleExpand(idx)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.importCardLeft}>
                      <Switch
                        value={w.selected}
                        onValueChange={() => toggleWorkout(idx)}
                        trackColor={{
                          false: colors.border,
                          true: colors.primary + '60',
                        }}
                        thumbColor={
                          w.selected ? colors.primary : colors.textTertiary
                        }
                      />
                      <View style={styles.importCardInfo}>
                        <Text style={styles.importCardDate}>
                          {formatDate(w.date)}
                        </Text>
                        <Text style={styles.importCardType}>{w.type}</Text>
                      </View>
                    </View>
                    <Text style={styles.importCardCount}>
                      {w.exercises.length} exercise
                      {w.exercises.length !== 1 ? 's' : ''}
                    </Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.importCardDetail}>
                      {w.exercises.map((ex, i) => (
                        <View key={i} style={styles.importExercise}>
                          <Text style={styles.importExerciseName}>
                            {ex.name}
                          </Text>
                          <Text style={styles.importExerciseSummary}>
                            {formatExerciseSummary(ex)}
                          </Text>
                          {ex.exercise_type === 'cardio' && ex.notes && (
                            <Text style={styles.importExerciseNotes}>
                              {ex.notes}
                            </Text>
                          )}
                        </View>
                      ))}
                      {w.notes && (
                        <Text style={styles.importWorkoutNotes}>
                          {w.notes}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Bottom bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[
                styles.importButton,
                (importing || selectedCount === 0) && styles.importButtonDisabled,
              ]}
              onPress={importSelected}
              disabled={importing || selectedCount === 0}
              activeOpacity={0.8}
            >
              {importing ? (
                <View style={styles.importingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={[styles.importButtonText, { marginLeft: spacing.sm }]}>
                    Importing…
                  </Text>
                </View>
              ) : (
                <Text style={styles.importButtonText}>
                  Import {selectedCount} Workout
                  {selectedCount !== 1 ? 's' : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContainer: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },

  // Pick step
  pickTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  pickSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  pickButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  pickButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Parsing
  parsingText: {
    fontSize: 16,
    color: colors.text,
    marginTop: spacing.lg,
    fontWeight: '500',
  },
  parsingSubtext: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  // Review
  reviewContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 3,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  selectAllRow: { flexDirection: 'row', alignItems: 'center' },
  selectAllText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  selectAllDivider: { fontSize: 13, color: colors.textTertiary },

  // Import card
  importCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  importCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  importCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  importCardInfo: { marginLeft: spacing.sm, flex: 1 },
  importCardDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  importCardType: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  importCardCount: { fontSize: 12, color: colors.textTertiary },

  // Detail
  importCardDetail: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  importExercise: {
    marginBottom: spacing.xs,
  },
  importExerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  importExerciseSummary: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  importExerciseNotes: {
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  importWorkoutNotes: {
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },

  // Bottom bar
  bottomBar: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  importButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  importButtonDisabled: { opacity: 0.5 },
  importButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  importingRow: { flexDirection: 'row', alignItems: 'center' },
});
