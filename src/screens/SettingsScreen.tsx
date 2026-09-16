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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import {
  TrainingPreference,
  WeeklyScheduleEntry,
  DAY_NAMES,
} from '../types/database';

// ─── Preset suggestions per category ────────────────────────

const GOAL_PRESETS = [
  'Run a 6-minute mile',
  'Build lean, athletic muscle',
  'Prioritize longevity',
  'Improve cardiovascular endurance',
  'Increase squat / bench / deadlift',
  'Lose body fat while maintaining strength',
  'Improve mobility and flexibility',
  'Train for a 5K / 10K / half marathon',
];

const PREFERENCE_PRESETS = [
  "I don't want to be a bodybuilder",
  "I don't want every workout to leave me sore",
  'Keep workouts under 60 minutes',
  'Prefer compound movements over isolation',
  'Minimal rest between sets (keep it moving)',
  'I like supersets and circuits',
  'I prefer steady-state cardio over HIIT',
  'I prefer HIIT over steady-state cardio',
  'No exercises that load the lower back heavily',
  'Prioritize recovery and avoid overtraining',
];

const EQUIPMENT_PRESETS = [
  'Barbell',
  'Squat rack / power rack',
  'Flat bench',
  'Adjustable bench',
  'Dumbbells',
  'Pull-up bar',
  'Resistance bands',
  'Kettlebell',
  'Cable machine',
  'Dip bars',
  'Foam roller',
  'Jump rope',
  'Treadmill',
  'Rowing machine',
  'Stationary bike',
  'Trap bar',
  'EZ curl bar',
  'Leg press',
  'Lat pulldown machine',
];

const SCHEDULE_PRESETS = [
  'Heavy Upper',
  'Heavy Lower',
  'Upper Conditioning',
  'Lower Conditioning',
  'Easy Run',
  'Hard Run',
  'Long Run',
  'Full Body',
  'Push',
  'Pull',
  'Legs',
  'HIIT',
  'Yoga / Mobility',
  'Recovery',
  'Rest',
];

// ─── Schedule Row ───────────────────────────────────────────

function ScheduleRow({
  day,
  value,
  onSave,
  showPresets,
}: {
  day: string;
  value: string;
  onSave: (v: string) => void;
  showPresets: boolean;
}) {
  const [text, setText] = useState(value);

  const selectPreset = (preset: string) => {
    setText(preset);
    onSave(preset);
  };

  return (
    <View style={styles.scheduleRowWrapper}>
      <View style={styles.scheduleRow}>
        <Text style={styles.scheduleDay}>{day}</Text>
        <View style={styles.scheduleInputWrapper}>
          <TextInput
            style={styles.scheduleInput}
            value={text}
            onChangeText={setText}
            onEndEditing={() => onSave(text.trim())}
            placeholder="Tap to set…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
          />
        </View>
      </View>
      {showPresets && (
        <View style={styles.schedulePresetRow}>
          {SCHEDULE_PRESETS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.presetChip,
                text === p && styles.presetChipActive,
              ]}
              onPress={() => selectPreset(p)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.presetChipText,
                  text === p && styles.presetChipTextActive,
                ]}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Schedule Section with suggestions toggle ───────────────

function ScheduleSection({
  schedule,
  onSave,
}: {
  schedule: (WeeklyScheduleEntry | null)[];
  onSave: (day: number, value: string) => void;
}) {
  const [showPresets, setShowPresets] = useState(false);

  const selectPreset = (preset: string, dayIndex: number) => {
    onSave(dayIndex, preset);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Weekly Schedule</Text>
        <TouchableOpacity
          onPress={() => setShowPresets((p) => !p)}
          activeOpacity={0.7}
        >
          <Text style={styles.suggestionsToggle}>
            {showPresets ? 'Hide suggestions' : 'Suggestions'}
          </Text>
        </TouchableOpacity>
      </View>

      {DAY_NAMES.map((day, i) => (
        <ScheduleRow
          key={day}
          day={day}
          value={schedule[i]?.session_type ?? ''}
          onSave={(v) => onSave(i, v)}
          showPresets={showPresets}
        />
      ))}
    </View>
  );
}

// ─── Preference Section with presets ────────────────────────

function PreferenceSection({
  title,
  category,
  items,
  userId,
  onChanged,
  presets,
}: {
  title: string;
  category: TrainingPreference['category'];
  items: TrainingPreference[];
  userId: string;
  onChanged: () => void;
  presets: string[];
}) {
  const [newItem, setNewItem] = useState('');
  const [showPresets, setShowPresets] = useState(false);

  const existingContent = new Set(items.map((i) => i.content));
  const availablePresets = presets.filter((p) => !existingContent.has(p));

  const addItem = async (content?: string) => {
    const value = (content ?? newItem).trim();
    if (!value) return;
    const { error } = await supabase.from('training_preferences').insert({
      user_id: userId,
      content: value,
      category,
    });
    if (error) Alert.alert('Error', error.message);
    else {
      setNewItem('');
      onChanged();
    }
  };

  const removeItem = async (id: string) => {
    await supabase.from('training_preferences').delete().eq('id', id);
    onChanged();
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {availablePresets.length > 0 && (
          <TouchableOpacity
            onPress={() => setShowPresets((p) => !p)}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionsToggle}>
              {showPresets ? 'Hide suggestions' : 'Suggestions'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Preset chips */}
      {showPresets && availablePresets.length > 0 && (
        <View style={styles.presetChipRow}>
          {availablePresets.map((p) => (
            <TouchableOpacity
              key={p}
              style={styles.presetChip}
              onPress={() => addItem(p)}
              activeOpacity={0.7}
            >
              <Text style={styles.presetChipText}>+ {p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Existing items */}
      {items.map((item) => (
        <View key={item.id} style={styles.prefRow}>
          <Text style={styles.prefText}>{item.content}</Text>
          <TouchableOpacity
            onPress={() => removeItem(item.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.prefDelete}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Free-form input */}
      <View style={styles.prefAddRow}>
        <TextInput
          style={styles.prefAddInput}
          value={newItem}
          onChangeText={setNewItem}
          placeholder={`Add custom ${title.toLowerCase().replace(/s$/, '')}…`}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={() => addItem()}
        />
        <TouchableOpacity
          style={styles.prefAddButton}
          onPress={() => addItem()}
        >
          <Text style={styles.prefAddButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const { user, signOut } = useAuth();
  const [schedule, setSchedule] = useState<(WeeklyScheduleEntry | null)[]>(
    Array(7).fill(null),
  );
  const [preferences, setPreferences] = useState<TrainingPreference[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) return;

    const { data: schedData } = await supabase
      .from('weekly_schedule')
      .select('*')
      .eq('user_id', user.id)
      .order('day_of_week');

    const sched: (WeeklyScheduleEntry | null)[] = Array(7).fill(null);
    if (schedData) {
      for (const entry of schedData) {
        sched[entry.day_of_week] = entry;
      }
    }
    setSchedule(sched);

    const { data: prefData } = await supabase
      .from('training_preferences')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at');
    setPreferences(prefData ?? []);

    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const saveScheduleDay = async (dayOfWeek: number, sessionType: string) => {
    if (!user) return;
    const existing = schedule[dayOfWeek];

    if (!sessionType) {
      if (existing) {
        await supabase
          .from('weekly_schedule')
          .delete()
          .eq('id', existing.id);
        fetchData();
      }
      return;
    }

    if (existing) {
      await supabase
        .from('weekly_schedule')
        .update({ session_type: sessionType })
        .eq('id', existing.id);
    } else {
      await supabase.from('weekly_schedule').insert({
        user_id: user.id,
        day_of_week: dayOfWeek,
        session_type: sessionType,
      });
    }
    fetchData();
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: signOut },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const goals = preferences.filter((p) => p.category === 'goal');
  const prefs = preferences.filter((p) => p.category === 'preference');
  const equipment = preferences.filter((p) => p.category === 'equipment');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Weekly Schedule */}
      <ScheduleSection
        schedule={schedule}
        onSave={saveScheduleDay}
      />

      {/* Goals */}
      <PreferenceSection
        title="Goals"
        category="goal"
        items={goals}
        userId={user!.id}
        onChanged={fetchData}
        presets={GOAL_PRESETS}
      />

      {/* Preferences */}
      <PreferenceSection
        title="Training Preferences"
        category="preference"
        items={prefs}
        userId={user!.id}
        onChanged={fetchData}
        presets={PREFERENCE_PRESETS}
      />

      {/* Equipment */}
      <PreferenceSection
        title="Equipment"
        category="equipment"
        items={equipment}
        userId={user!.id}
        onChanged={fetchData}
        presets={EQUIPMENT_PRESETS}
      />

      {/* Data */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>Data</Text>
        <TouchableOpacity
          style={styles.importButton}
          onPress={() => navigation.getParent()?.navigate('ImportScreen')}
          activeOpacity={0.8}
        >
          <Text style={styles.importButtonText}>Import Workout History (CSV)</Text>
        </TouchableOpacity>
      </View>

      {/* Account */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>Account</Text>
        <Text style={styles.emailText}>{user?.email}</Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>
          Setpoint AI v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
        {Constants.expoConfig?.extra?.isDev && (
          <Text style={styles.devBadge}>DEV</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  section: {
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  suggestionsToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // Schedule
  scheduleRowWrapper: {
    marginBottom: spacing.sm,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleDay: {
    width: 100,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  scheduleInputWrapper: {
    flex: 1,
  },
  scheduleInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Preset chips
  schedulePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    marginLeft: 100,
    gap: spacing.xs,
  },
  presetChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  presetChip: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  presetChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // Preferences
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  prefText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginRight: spacing.sm,
  },
  prefDelete: { fontSize: 14, color: colors.textTertiary },
  prefAddRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  prefAddInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  prefAddButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefAddButtonText: { color: '#fff', fontSize: 20, fontWeight: '600' },

  // Import
  importButton: {
    backgroundColor: colors.primary + '12',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  importButtonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  // Account
  emailText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  logoutButton: {
    backgroundColor: colors.error + '12',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  logoutText: { color: colors.error, fontSize: 16, fontWeight: '600' },

  // Version
  versionContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  versionText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  devBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
    backgroundColor: colors.warning + '18',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
