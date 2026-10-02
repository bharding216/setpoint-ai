import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Animated,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { maybeRequestReviewAfterImport } from '../lib/storeReview';
import { colors, spacing } from '../theme';
import { DAY_NAMES } from '../types/database';
import { formatWeight } from '../lib/formatWeight';

// ─── Types ──────────────────────────────────────────────────

type ImportSet = {
  set_number: number;
  weight: number | null;
  reps: number | null;
};

type ImportExercise = {
  name: string;
  exercise_type: 'strength' | 'cardio';
  equipment_count?: number | null;
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

// ─── CSV Parsing Helpers ────────────────────────────────────

/** Split CSV text into records, handling quoted fields that span lines */
function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') i++;
      if (current.trim().length > 0) records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) records.push(current);
  return records;
}

/** Parse a CSV record into fields, respecting quoted values */
function parseCsvFields(record: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of record) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Deterministic Workout Parser ───────────────────────────

const CARDIO_KEYWORDS = /\b(run|swim|bike|ride|row|yoga|mobility|recovery|conditioning|walk|jog|sprint|stride|5k|10k|trial|cooldown|warmup|warm.up)\b/i;
const TIME_PATTERN = /(\d+)\s*min/i;
const BODYWEIGHT_PATTERN = /^(bodyweight|bw|body\s*weight)$/i;

/** Parse the date column: "Thursday, August 20, 2026" → "2026-08-20" */
function parseDate(raw: string): string | null {
  const cleaned = raw.replace(/^"(.*)"$/, '$1').trim();
  if (!cleaned) return null;

  // Strip leading day name: "Thursday, August 20, 2026" → "August 20, 2026"
  const withoutDay = cleaned.replace(/^\w+day,\s*/i, '');

  const d = new Date(withoutDay || cleaned);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse the Weight/Duration field into a numeric weight or null */
function parseWeight(raw: string): { weight: number | null; isDescriptive: boolean; isDumbbellPair: boolean } {
  const val = raw.trim();
  if (!val) return { weight: null, isDescriptive: false, isDumbbellPair: false };
  if (BODYWEIGHT_PATTERN.test(val)) return { weight: null, isDescriptive: false, isDumbbellPair: false };

  // "40s" → 40 (dumbbell per hand, pair)
  const dbMatch = val.match(/^(\d+(?:\.\d+)?)s$/i);
  if (dbMatch) return { weight: parseFloat(dbMatch[1]), isDescriptive: false, isDumbbellPair: true };

  // "185-195" range → take higher value
  const rangeMatch = val.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) return { weight: Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2])), isDescriptive: false, isDumbbellPair: false };

  // Plain number
  const num = parseFloat(val);
  if (!isNaN(num) && /^\d+(?:\.\d+)?$/.test(val)) return { weight: num, isDescriptive: false, isDumbbellPair: false };

  // Descriptive text (e.g. "30 mins", "Conditioning style", "for forearm strength")
  return { weight: null, isDescriptive: true, isDumbbellPair: false };
}

/** Parse a rep value — handles "x", empty, and non-numeric */
function parseReps(raw: string): number | null {
  const val = raw.trim();
  if (!val || val.toLowerCase() === 'x') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

/** Parse duration from the Weight/Duration field */
function parseDuration(raw: string): number | null {
  const match = raw.match(TIME_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse all CSV rows into ImportWorkout[], grouping by date.
 *
 * Expected columns:
 *   Date, Category, Exercise, Weight/Duration, Set 1 Reps, Set 2 Reps, Set 3 Reps, Notes
 */
function parseCsvToWorkouts(csvText: string): ImportWorkout[] {
  const records = splitCsvRecords(csvText);
  if (records.length < 2) return [];

  // Skip header row
  const dataRows = records.slice(1);

  // Group rows by date
  const grouped = new Map<string, { type: string; rows: string[][] }>();

  for (const record of dataRows) {
    const fields = parseCsvFields(record);
    const date = parseDate(fields[0] ?? '');
    if (!date) continue;

    const category = (fields[1] ?? '').trim();
    const exercise = (fields[2] ?? '').trim();

    // Skip rows with no category and no exercise
    if (!category && !exercise) continue;

    if (!grouped.has(date)) {
      grouped.set(date, { type: category || 'Workout', rows: [] });
    }

    const group = grouped.get(date)!;
    // Combine category if different (e.g. "Recovery, yoga")
    if (category && !group.type.includes(category)) {
      group.type = `${group.type}, ${category}`;
    }

    if (exercise) {
      group.rows.push(fields);
    }
  }

  // Convert groups to ImportWorkout[]
  const workouts: ImportWorkout[] = [];

  for (const [date, { type, rows }] of grouped) {
    if (rows.length === 0) continue;

    const exercises: ImportExercise[] = [];

    for (const fields of rows) {
      const exerciseName = (fields[2] ?? '').trim();
      const weightRaw = (fields[3] ?? '').trim();
      const rep1 = parseReps(fields[4] ?? '');
      const rep2 = parseReps(fields[5] ?? '');
      const rep3 = parseReps(fields[6] ?? '');
      const notesRaw = (fields[7] ?? '').trim();

      const hasReps = rep1 !== null || rep2 !== null || rep3 !== null;
      const { weight, isDescriptive, isDumbbellPair } = parseWeight(weightRaw);
      const isCardio = !hasReps && (CARDIO_KEYWORDS.test(exerciseName) || CARDIO_KEYWORDS.test(type));

      if (isCardio || (!hasReps && isDescriptive && !weight)) {
        // Cardio / descriptive exercise
        const duration = parseDuration(weightRaw);
        const notes = [exerciseName !== type ? '' : '', weightRaw, notesRaw]
          .filter(Boolean)
          .join(' — ') || null;

        exercises.push({
          name: exerciseName,
          exercise_type: 'cardio',
          duration_minutes: duration,
          distance: null,
          pace: null,
          heart_rate: null,
          notes: isDescriptive ? (notesRaw || weightRaw || null) : (notesRaw || null),
        });
      } else {
        // Strength exercise
        const sets: ImportSet[] = [];
        const reps = [rep1, rep2, rep3];
        for (let i = 0; i < reps.length; i++) {
          if (reps[i] !== null) {
            sets.push({ set_number: i + 1, weight, reps: reps[i] });
          }
        }

        exercises.push({
          name: exerciseName,
          exercise_type: 'strength',
          equipment_count: isDumbbellPair ? 2 : 1,
          sets: sets.length > 0 ? sets : undefined,
          notes: notesRaw || null,
        });
      }
    }

    workouts.push({
      date,
      type,
      exercises,
      notes: null,
      selected: true,
    });
  }

  return workouts;
}

// ─── Main Screen ────────────────────────────────────────────

export default function ImportScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState<ImportWorkout[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [step, setStep] = useState<'pick' | 'review' | 'done'>('pick');
  const [showFormat, setShowFormat] = useState(false);
  const formatAnim = useRef(new Animated.Value(0)).current;
  const formatHeight = useRef(0);

  const toggleFormat = useCallback(() => {
    const opening = !showFormat;
    setShowFormat(opening);
    Animated.timing(formatAnim, {
      toValue: opening ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [showFormat, formatAnim]);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.uri) return;

      setParsing(true);
      setStep('review');

      const response = await fetch(file.uri);
      let csvText: string;

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b;

      if (isXlsx) {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(firstSheet);
      } else {
        csvText = new TextDecoder().decode(bytes);
      }

      if (!csvText.trim()) {
        throw new Error('The file appears to be empty. Please check your export and try again.');
      }

      const parsed = parseCsvToWorkouts(csvText);

      if (parsed.length === 0) {
        throw new Error(
          'No workouts found. Make sure your file has columns:\n' +
          'Date, Category, Exercise, Weight/Duration, Set 1 Reps, Set 2 Reps, Set 3 Reps, Notes',
        );
      }

      setWorkouts(parsed);
    } catch (err: any) {
      Alert.alert('Import Error', err.message || 'Failed to parse file');
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
              equipment_count: ex.equipment_count ?? null,
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

      maybeRequestReviewAfterImport();
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
      const w = first.weight != null ? formatWeight(first.weight, ex.equipment_count) : 'BW';
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
      <ScrollView
        contentContainerStyle={styles.centered}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.pickTitle}>Import Workout History</Text>
        <Text style={styles.pickSubtitle}>
          Upload a CSV or Excel (.xlsx) file from your spreadsheet.
        </Text>
        <TouchableOpacity
          style={styles.pickButton}
          onPress={pickFile}
          activeOpacity={0.8}
        >
          <Text style={styles.pickButtonText}>Select File</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.formatToggle}
          onPress={toggleFormat}
          activeOpacity={0.7}
        >
          <Text style={styles.formatToggleText}>
            {showFormat ? 'Hide format details' : 'What format do I need?'}
          </Text>
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.formatWrapper,
            {
              maxHeight: formatAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 500],
              }),
              opacity: formatAnim,
            },
          ]}
        >
          <View
            style={styles.formatCard}
            onLayout={(e) => {
              formatHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <Text style={styles.formatHeading}>Required Columns</Text>
            <View style={styles.formatTable}>
              {[
                ['Date', '"Thursday, August 20, 2026"'],
                ['Category', 'Upper, Lower, Easy Run, etc.'],
                ['Exercise', 'Bench, Squat, etc.'],
                ['Weight/Duration', '175, 40s, bodyweight, 30 mins'],
                ['Set 1 Reps', '6'],
                ['Set 2 Reps', '6'],
                ['Set 3 Reps', '6'],
                ['Notes', '(optional)'],
              ].map(([col, example]) => (
                <View key={col} style={styles.formatRow}>
                  <Text style={styles.formatCol}>{col}</Text>
                  <Text style={styles.formatExample}>{example}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.formatHeading}>Tips</Text>
            <Text style={styles.formatTip}>
              • Each row is one exercise. Rows on the same date are grouped into one workout.
            </Text>
            <Text style={styles.formatTip}>
              • Use "40s" for dumbbell weight per hand (e.g. 40 lb DBs).
            </Text>
            <Text style={styles.formatTip}>
              • Leave Set columns empty for cardio or descriptive entries.
            </Text>
            <Text style={styles.formatTip}>
              • Runs, swims, yoga, and conditioning are detected as cardio automatically.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
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
                          true: colors.primary,
                        }}
                        thumbColor="#fff"
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
                          {ex.notes && (
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
                styles.importBtn,
                (importing || selectedCount === 0) && styles.importBtnDisabled,
              ]}
              onPress={importSelected}
              disabled={importing || selectedCount === 0}
              activeOpacity={0.8}
            >
              {importing ? (
                <View style={styles.importingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={[styles.importBtnText, { marginLeft: spacing.sm }]}>
                    Importing…
                  </Text>
                </View>
              ) : (
                <Text style={styles.importBtnText}>
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

  // Format info
  formatToggle: {
    marginTop: spacing.lg,
  },
  formatToggleText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  formatWrapper: {
    overflow: 'hidden',
    width: '100%',
  },
  formatCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.md,
    width: '100%',
  },
  formatHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  formatTable: {
    marginBottom: spacing.md,
  },
  formatRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  formatCol: {
    width: 120,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  formatExample: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  formatTip: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.xs,
  },

  // Parsing
  parsingText: {
    fontSize: 16,
    color: colors.text,
    marginTop: spacing.lg,
    fontWeight: '500',
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
  importBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  importingRow: { flexDirection: 'row', alignItems: 'center' },
});
