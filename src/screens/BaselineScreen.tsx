import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import {
  EXERCISE_PRESETS,
  EXERCISE_CATEGORIES,
  searchExercises,
  type ExerciseCategory,
} from '../constants/exercises';

// ─── Config ─────────────────────────────────────────────────

const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

const STRENGTH_EXERCISES = [
  { key: 'bench_press', label: 'Bench Press' },
  { key: 'squat', label: 'Squat' },
  { key: 'deadlift', label: 'Deadlift' },
  { key: 'overhead_press', label: 'Overhead Press' },
] as const;

type LiftEntry = { weight: string; reps: string };
type CustomLift = { name: string; weight: string; reps: string };

const DEFAULT_STRENGTH_KEYS = new Set<string>(
  STRENGTH_EXERCISES.map((e) => e.key),
);

// ─── Main Screen ────────────────────────────────────────────

export default function BaselineScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | null>(null);
  const [lifts, setLifts] = useState<Record<string, LiftEntry>>(() =>
    Object.fromEntries(
      STRENGTH_EXERCISES.map((e) => [e.key, { weight: '', reps: '' }]),
    ),
  );
  const [customLifts, setCustomLifts] = useState<CustomLift[]>([]);
  const [runPace, setRunPace] = useState('');
  const [swimPace, setSwimPace] = useState('');
  const [bikePace, setBikePace] = useState('');
  const [cardioNotes, setCardioNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [showLevelInfo, setShowLevelInfo] = useState(false);
  const [focusedCustomIdx, setFocusedCustomIdx] = useState<number | null>(null);
  const [browseCategory, setBrowseCategory] = useState<ExerciseCategory | null>(null);

  // ─── Load existing baseline ────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      (async () => {
        setLoading(true);
        try {
          const { data } = await supabase
            .from('fitness_baselines')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

          if (data) {
            setExperienceLevel(data.experience_level ?? null);
            setNotes(data.notes ?? '');

            const bm = (data.benchmarks as any) ?? {};

            if (bm.strength) {
              setLifts((prev) => {
                const updated = { ...prev };
                for (const [key, val] of Object.entries(bm.strength) as [
                  string,
                  any,
                ][]) {
                  if (DEFAULT_STRENGTH_KEYS.has(key) && updated[key]) {
                    updated[key] = {
                      weight: val.weight?.toString() ?? '',
                      reps: val.reps?.toString() ?? '',
                    };
                  }
                }
                return updated;
              });

              const custom = (
                Object.entries(bm.strength) as [string, any][]
              )
                .filter(([key]) => !DEFAULT_STRENGTH_KEYS.has(key))
                .map(([key, val]) => ({
                  name: key
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c: string) => c.toUpperCase()),
                  weight: val.weight?.toString() ?? '',
                  reps: val.reps?.toString() ?? '',
                }));
              setCustomLifts(custom);
            }

            if (bm.cardio) {
              setRunPace(bm.cardio.run_pace ?? '');
              setSwimPace(bm.cardio.swim_pace ?? '');
              setBikePace(bm.cardio.bike_pace ?? '');
              setCardioNotes(bm.cardio.notes ?? '');
            }
          }
        } catch (err) {
          console.error('[Baseline] Load error:', err);
        } finally {
          setLoading(false);
        }
      })();
    }, [user]),
  );

  // ─── Helpers ────────────────────────────────────────────────

  const updateLift = (key: string, field: 'weight' | 'reps', value: string) => {
    setLifts((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const addCustomLift = () => {
    setCustomLifts((prev) => [...prev, { name: '', weight: '', reps: '' }]);
  };

  const updateCustomLift = (
    idx: number,
    field: 'name' | 'weight' | 'reps',
    value: string,
  ) => {
    setCustomLifts((prev) =>
      prev.map((cl, i) => (i === idx ? { ...cl, [field]: value } : cl)),
    );
  };

  const removeCustomLift = (idx: number) => {
    setCustomLifts((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const strength: Record<string, { weight?: number; reps?: number }> = {};
      for (const [key, val] of Object.entries(lifts)) {
        const w = parseFloat(val.weight);
        const r = parseInt(val.reps, 10);
        if (!isNaN(w) || !isNaN(r)) {
          strength[key] = {
            ...(isNaN(w) ? {} : { weight: w }),
            ...(isNaN(r) ? {} : { reps: r }),
          };
        }
      }
      for (const cl of customLifts) {
        const key = cl.name.trim().toLowerCase().replace(/\s+/g, '_');
        if (!key) continue;
        const w = parseFloat(cl.weight);
        const r = parseInt(cl.reps, 10);
        if (!isNaN(w) || !isNaN(r)) {
          strength[key] = {
            ...(isNaN(w) ? {} : { weight: w }),
            ...(isNaN(r) ? {} : { reps: r }),
          };
        }
      }

      const cardio: Record<string, string> = {};
      if (runPace.trim()) cardio.run_pace = runPace.trim();
      if (swimPace.trim()) cardio.swim_pace = swimPace.trim();
      if (bikePace.trim()) cardio.bike_pace = bikePace.trim();
      if (cardioNotes.trim()) cardio.notes = cardioNotes.trim();

      const benchmarks = { strength, cardio };

      const { error } = await supabase.from('fitness_baselines').upsert(
        {
          user_id: user.id,
          experience_level: experienceLevel,
          benchmarks,
          notes: notes.trim() || null,
        },
        { onConflict: 'user_id' },
      );

      if (error) throw error;

      supabase.functions
        .invoke('rebuild-ai-profile', { body: {} })
        .catch(() => {});

      Alert.alert('Saved', 'Your fitness baseline has been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      console.error('[Baseline] Save error:', err);
      Alert.alert('Error', err.message || 'Failed to save baseline.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>Your Starting Point</Text>
        <Text style={styles.subtitle}>
          Tell the AI where you're at so it can calibrate your workouts from day
          one. All fields are optional — fill in what you know.
        </Text>

        {/* Experience Level */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Experience Level</Text>
            <TouchableOpacity
              onPress={() => setShowLevelInfo(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.6}
            >
              <View style={styles.infoIcon}>
                <Text style={styles.infoIconText}>?</Text>
              </View>
            </TouchableOpacity>
          </View>
          <View style={styles.pillRow}>
            {EXPERIENCE_LEVELS.map((level) => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.pill,
                  experienceLevel === level && styles.pillActive,
                ]}
                onPress={() =>
                  setExperienceLevel(
                    experienceLevel === level ? null : level,
                  )
                }
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.pillText,
                    experienceLevel === level && styles.pillTextActive,
                  ]}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Experience Level Info Modal */}
        <Modal
          visible={showLevelInfo}
          transparent
          animationType="fade"
          onRequestClose={() => setShowLevelInfo(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowLevelInfo(false)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Experience Levels</Text>

              <View style={styles.modalLevelBlock}>
                <Text style={styles.modalLevelName}>Beginner</Text>
                <Text style={styles.modalLevelDesc}>
                  New to structured training, or returning after a long break
                  (6+ months off). Still learning form on the main lifts.
                  The AI will start conservative and ramp up gradually.
                </Text>
              </View>

              <View style={styles.modalLevelBlock}>
                <Text style={styles.modalLevelName}>Intermediate</Text>
                <Text style={styles.modalLevelDesc}>
                  Consistent training for 1–3 years. Comfortable with compound
                  lifts and progressing steadily. The AI will push progressive
                  overload and introduce more variation.
                </Text>
              </View>

              <View style={styles.modalLevelBlock}>
                <Text style={styles.modalLevelName}>Advanced</Text>
                <Text style={styles.modalLevelDesc}>
                  3+ years of consistent training. Strong command of form,
                  periodization, and your own body. The AI will program
                  heavier loads, advanced techniques, and nuanced
                  periodization.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.modalDismiss}
                onPress={() => setShowLevelInfo(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalDismissText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Strength */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Strength</Text>
          <Text style={styles.sectionHint}>
            Current working weights (a typical set, not your 1RM)
          </Text>

          {STRENGTH_EXERCISES.map(({ key, label }) => (
            <View key={key} style={styles.liftRow}>
              <Text style={styles.liftLabel}>{label}</Text>
              <View style={styles.liftInputs}>
                <TextInput
                  style={styles.liftInput}
                  value={lifts[key].weight}
                  onChangeText={(v) => updateLift(key, 'weight', v)}
                  placeholder="—"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
                <Text style={styles.liftUnit}>lbs</Text>
                <Text style={styles.liftSep}>×</Text>
                <TextInput
                  style={[styles.liftInput, styles.liftInputSmall]}
                  value={lifts[key].reps}
                  onChangeText={(v) => updateLift(key, 'reps', v)}
                  placeholder="—"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
                <Text style={styles.liftUnit}>reps</Text>
              </View>
            </View>
          ))}

          {customLifts.map((cl, idx) => {
            const isFocused = focusedCustomIdx === idx;
            const results = isFocused && cl.name.trim()
              ? searchExercises(cl.name).filter((e) => e.type === 'strength').slice(0, 5)
              : [];
            const showBrowse = isFocused && !cl.name.trim();
            const categoryPresets = browseCategory
              ? EXERCISE_PRESETS.filter(
                  (e) => e.category === browseCategory && e.type === 'strength',
                )
              : [];

            return (
              <View key={`custom-${idx}`} style={styles.customLiftRow}>
                <View style={styles.customLiftTop}>
                  <TextInput
                    style={styles.customLiftName}
                    value={cl.name}
                    onChangeText={(v) => {
                      updateCustomLift(idx, 'name', v);
                      setBrowseCategory(null);
                    }}
                    onFocus={() => {
                      setFocusedCustomIdx(idx);
                      setBrowseCategory(null);
                    }}
                    onBlur={() =>
                      setTimeout(() => {
                        setFocusedCustomIdx((prev) =>
                          prev === idx ? null : prev,
                        );
                        setBrowseCategory(null);
                      }, 200)
                    }
                    placeholder="Search or type exercise…"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="next"
                  />
                  <TouchableOpacity
                    onPress={() => removeCustomLift(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Search results */}
                {results.length > 0 && (
                  <View style={styles.searchResults}>
                    {results.map((preset) => (
                      <TouchableOpacity
                        key={preset.name}
                        style={[
                          styles.searchResultItem,
                          preset.name === cl.name && styles.searchResultItemActive,
                        ]}
                        onPress={() => {
                          updateCustomLift(idx, 'name', preset.name);
                          setFocusedCustomIdx(null);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.searchResultName,
                            preset.name === cl.name && styles.searchResultNameActive,
                          ]}
                        >
                          {preset.name}
                        </Text>
                        <Text style={styles.searchResultCategory}>
                          {preset.category}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Category browsing when input is empty */}
                {showBrowse && (
                  <View style={styles.browseSection}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.categoryChipScroll}
                      contentContainerStyle={styles.categoryChipContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      {EXERCISE_CATEGORIES.filter((c) => c !== 'Cardio').map(
                        (cat) => (
                          <TouchableOpacity
                            key={cat}
                            style={[
                              styles.categoryChip,
                              browseCategory === cat &&
                                styles.categoryChipActive,
                            ]}
                            onPress={() =>
                              setBrowseCategory((prev) =>
                                prev === cat ? null : cat,
                              )
                            }
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.categoryChipText,
                                browseCategory === cat &&
                                  styles.categoryChipTextActive,
                              ]}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        ),
                      )}
                    </ScrollView>

                    {browseCategory && categoryPresets.length > 0 && (
                      <View style={styles.categoryExercises}>
                        {categoryPresets.map((preset) => (
                          <TouchableOpacity
                            key={preset.name}
                            style={styles.presetChip}
                            onPress={() => {
                              updateCustomLift(idx, 'name', preset.name);
                              setFocusedCustomIdx(null);
                              setBrowseCategory(null);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.presetChipText}>
                              {preset.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.liftInputs}>
                  <TextInput
                    style={styles.liftInput}
                    value={cl.weight}
                    onChangeText={(v) => updateCustomLift(idx, 'weight', v)}
                    placeholder="—"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                  <Text style={styles.liftUnit}>lbs</Text>
                  <Text style={styles.liftSep}>×</Text>
                  <TextInput
                    style={[styles.liftInput, styles.liftInputSmall]}
                    value={cl.reps}
                    onChangeText={(v) => updateCustomLift(idx, 'reps', v)}
                    placeholder="—"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                  <Text style={styles.liftUnit}>reps</Text>
                </View>
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.addExerciseBtn}
            onPress={addCustomLift}
            activeOpacity={0.7}
          >
            <Text style={styles.addExerciseBtnText}>+ Add Exercise</Text>
          </TouchableOpacity>
        </View>

        {/* Cardio */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cardio</Text>

          <View style={styles.cardioRow}>
            <Text style={styles.cardioLabel}>🏃  Running</Text>
            <View style={styles.cardioInputWrap}>
              <TextInput
                style={styles.cardioInput}
                value={runPace}
                onChangeText={setRunPace}
                placeholder="e.g. 8:30"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="next"
              />
              <Text style={styles.liftUnit}>/mi</Text>
            </View>
          </View>

          <View style={styles.cardioRow}>
            <Text style={styles.cardioLabel}>🏊  Swimming</Text>
            <TextInput
              style={[styles.cardioInput, { flex: 1 }]}
              value={swimPace}
              onChangeText={setSwimPace}
              placeholder="e.g. 1:45/100yd, 1500m in 28 min"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />
          </View>

          <View style={styles.cardioRow}>
            <Text style={styles.cardioLabel}>🚴  Cycling</Text>
            <TextInput
              style={[styles.cardioInput, { flex: 1 }]}
              value={bikePace}
              onChangeText={setBikePace}
              placeholder="e.g. 18 mph avg, FTP 220W"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />
          </View>

          <View style={styles.cardioRow}>
            <Text style={styles.cardioLabel}>Other</Text>
            <TextInput
              style={[styles.cardioInput, { flex: 1 }]}
              value={cardioNotes}
              onChangeText={setCardioNotes}
              placeholder="e.g. row 2K in 7:30, jump rope 15 min"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anything Else</Text>
          <Text style={styles.sectionHint}>
            Injuries, time off, athletic background, or anything that helps the
            AI understand where you're starting from.
          </Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder={"e.g. Coming back from a knee injury, Played college soccer, Haven't trained in 6 months"}
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save Baseline</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
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

  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionHint: {
    fontSize: 13,
    color: colors.textTertiary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },

  // Experience pills
  pillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pill: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pillActive: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.primary,
  },

  // Lift rows
  liftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  liftLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  liftInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liftInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
    width: 60,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  liftInputSmall: {
    width: 44,
  },
  liftUnit: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  liftSep: {
    fontSize: 15,
    color: colors.textTertiary,
    marginHorizontal: 2,
  },

  // Custom lifts
  customLiftRow: {
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  customLiftTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customLiftName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  removeText: {
    fontSize: 16,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  addExerciseBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addExerciseBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Search results
  searchResults: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchResultItemActive: {
    backgroundColor: colors.primary + '15',
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    flex: 1,
  },
  searchResultNameActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  searchResultCategory: {
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '500',
    marginLeft: spacing.sm,
  },

  // Category browsing
  browseSection: {
    marginBottom: spacing.xs,
  },
  categoryChipScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  categoryChipContent: {
    gap: spacing.xs,
  },
  categoryChip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  categoryExercises: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  presetChip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },

  // Cardio
  cardioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  cardioLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    width: 110,
  },
  cardioInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardioInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
    minWidth: 80,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Notes
  notesInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    minHeight: 100,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Save
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Info icon
  infoIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIconText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    marginTop: -1,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  modalLevelBlock: {
    marginBottom: spacing.md,
  },
  modalLevelName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  modalLevelDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  modalDismiss: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  modalDismissText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});
