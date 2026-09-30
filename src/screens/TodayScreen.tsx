import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
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

type AIWorkout = {
  type: string;
  exercises: {
    name: string;
    exercise_type: 'strength' | 'cardio';
    sets?: number;
    reps?: number;
    weight?: number;
    duration_minutes?: number;
    distance?: number;
    pace?: string;
  }[];
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ─── Chat Bubble ────────────────────────────────────────────
function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userBubbleRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userBubbleText}>{text}</Text>
      </View>
    </View>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <View style={styles.assistantBubbleRow}>
      <View style={styles.assistantBubble}>
        <Text style={styles.assistantBubbleText}>{text}</Text>
      </View>
    </View>
  );
}

// ─── Workout Preview Card ───────────────────────────────────
function WorkoutPreviewCard({ workout }: { workout: AIWorkout }) {
  return (
    <View style={styles.workoutPreview}>
      <Text style={styles.workoutPreviewTitle}>{workout.type}</Text>
      {workout.exercises.map((ex, i) => (
        <View key={i} style={styles.workoutPreviewRow}>
          <Text style={styles.workoutPreviewName}>{ex.name}</Text>
          <Text style={styles.workoutPreviewDetail}>
            {ex.exercise_type === 'strength'
              ? [
                  ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : null,
                  ex.weight ? `${ex.weight} lbs` : null,
                ]
                  .filter(Boolean)
                  .join(' @ ')
              : [
                  ex.duration_minutes ? `${ex.duration_minutes} min` : null,
                  ex.distance ? `${ex.distance} mi` : null,
                  ex.pace ?? null,
                ]
                  .filter(Boolean)
                  .join(', ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────
export default function TodayScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const {
    isTrialing,
    trialEndsAt,
    tier,
    aiSessionsUsed,
    aiSessionsLimit,
    refreshSubscription,
  } = useSubscription();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [todayWorkout, setTodayWorkout] = useState<Workout | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<PlannedExercise[]>(
    [],
  );
  const [actualExercises, setActualExercises] = useState<PlannedExercise[]>([]);
  const [schedule, setSchedule] = useState<WeeklyScheduleEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Chat state
  const [chatActive, setChatActive] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<AIWorkout | null>(null);

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
      setChatActive(false);
      setChatMessages([]);
      setPendingWorkout(null);
      setChatInput('');

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

  // ─── Chat Functions ─────────────────────────────────────────

  const aiLimitReached =
    tier === 'free' &&
    aiSessionsLimit != null &&
    aiSessionsUsed >= aiSessionsLimit;

  const startChat = async () => {
    if (!user) return;

    if (aiLimitReached) {
      Alert.alert(
        'AI Limit Reached',
        `You've used all ${aiSessionsLimit} free AI sessions this month. Upgrade to Setpoint+ for unlimited AI coaching.`,
        [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Upgrade',
            onPress: () =>
              navigation.getParent()?.navigate('PaywallScreen'),
          },
        ],
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setChatActive(true);
    setChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        'chat-workout',
        { body: { messages: [], date: dateStr } },
      );

      if (error) {
        let msg = 'Failed to get AI recommendation.';
        try {
          // In supabase-js v2, FunctionsHttpError.context is the
          // already-parsed response body (a plain object), not a Response.
          const body = (error as any).context ?? {};
          if (body?.code === 'AI_LIMIT_REACHED') {
            Alert.alert('AI Limit Reached', body.error, [
              { text: 'OK', style: 'cancel' },
              {
                text: 'Upgrade',
                onPress: () =>
                  navigation.getParent()?.navigate('PaywallScreen'),
              },
            ]);
            setChatActive(false);
            setChatLoading(false);
            return;
          }
          msg = body?.error ?? msg;
        } catch {}
        throw new Error(msg);
      }

      if (!data?.workout) throw new Error('No workout returned from AI');

      const rawResponse = JSON.stringify(data);
      setChatMessages([
        { role: 'user', content: 'What should I do today?' },
        { role: 'assistant', content: rawResponse },
      ]);
      setPendingWorkout(data.workout);

      refreshSubscription();

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to get AI recommendation.');
      setChatActive(false);
    } finally {
      setChatLoading(false);
    }
  };

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput('');
    setChatLoading(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { data, error } = await supabase.functions.invoke(
        'chat-workout',
        { body: { messages: updated, date: dateStr } },
      );

      if (error) {
        let errText = 'Something went wrong. Try again.';
        try {
          const body = (error as any).context ?? {};
          errText = body?.error ?? errText;
        } catch {}
        const errMsg: ChatMessage = {
          role: 'assistant',
          content: JSON.stringify({ reply: errText, workout: pendingWorkout }),
        };
        setChatMessages([...updated, errMsg]);
        setChatLoading(false);
        return;
      }

      const rawResponse = JSON.stringify(data);
      setChatMessages([...updated, { role: 'assistant', content: rawResponse }]);
      if (data?.workout) setPendingWorkout(data.workout);

      refreshSubscription();

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send message.');
    } finally {
      setChatLoading(false);
    }
  };

  const acceptWorkout = async () => {
    if (!pendingWorkout || !user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const lastAssistant = [...chatMessages]
        .reverse()
        .find((m) => m.role === 'assistant');
      let summary = '';
      try {
        const parsed = JSON.parse(lastAssistant?.content ?? '');
        summary = parsed.reply;
      } catch {}

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          user_id: user.id,
          date: dateStr,
          type: pendingWorkout.type,
          status: 'in_progress' as const,
          ai_summary: summary,
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      // Insert planned AND actual exercises
      for (let i = 0; i < pendingWorkout.exercises.length; i++) {
        const ex = pendingWorkout.exercises[i];

        // Planned exercise
        await supabase.from('workout_exercises').insert({
          workout_id: workout.id,
          name: ex.name,
          exercise_type: ex.exercise_type ?? 'strength',
          exercise_order: i,
          is_planned: true,
        });

        // Actual exercise (user will log against this)
        const { data: actualEx, error: exError } = await supabase
          .from('workout_exercises')
          .insert({
            workout_id: workout.id,
            name: ex.name,
            exercise_type: ex.exercise_type ?? 'strength',
            exercise_order: i,
            is_planned: false,
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
            exercise_id: actualEx.id,
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
            exercise_id: actualEx.id,
            duration_minutes: ex.duration_minutes ?? null,
            distance: ex.distance ?? null,
            pace: ex.pace ?? null,
          });
        }
      }

      // Rebuild AI profile in the background
      supabase.functions
        .invoke('rebuild-ai-profile', { body: {} })
        .catch(() => {});

      navigation
        .getParent()
        ?.navigate('WorkoutScreen', { workoutId: workout.id });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create workout.');
    }
  };

  // ─── Existing helpers ───────────────────────────────────────

  const startWorkout = async () => {
    if (!todayWorkout) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

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

    navigation
      .getParent()
      ?.navigate('WorkoutScreen', { workoutId: todayWorkout.id });
  };

  const startBlankWorkout = async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

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

    navigation
      .getParent()
      ?.navigate('WorkoutScreen', { workoutId: workout.id });
  };

  const formatSets = (exercise: PlannedExercise) => {
    if (exercise.sets.length === 0) return '';
    const first = exercise.sets[0];
    const weight = first.weight != null ? `${first.weight}` : '';
    const reps = first.reps != null ? `${first.reps}` : '';
    const count = exercise.sets.length;

    if (weight && reps)
      return count > 1 ? `${weight} × ${reps} × ${count}` : `${weight} × ${reps}`;
    if (reps) return count > 1 ? `${reps} reps × ${count}` : `${reps} reps`;
    return '';
  };

  const parseAssistantMessage = (content: string) => {
    try {
      return JSON.parse(content) as { reply: string; workout?: AIWorkout };
    } catch {
      return { reply: content };
    }
  };

  // ─── Loading state ──────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const showCompleted =
    todayWorkout?.status === 'completed' && actualExercises.length > 0;

  const chatVisible =
    chatActive &&
    (!todayWorkout || todayWorkout.status === 'completed');

  // Display messages: skip the synthetic first user message
  const displayMessages = chatMessages.slice(1);

  // ─── Chat Interface ─────────────────────────────────────────

  if (chatVisible) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Date header */}
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
              <Text style={styles.scheduleText}>
                {schedule.session_type}
              </Text>
            </View>
          )}

          {/* Trial banner */}
          {isTrialing && trialEndsAt && (
            <TouchableOpacity
              style={styles.trialBanner}
              onPress={() =>
                navigation.getParent()?.navigate('PaywallScreen')
              }
              activeOpacity={0.8}
            >
              <Text style={styles.trialBannerText}>
                Setpoint+ trial ends in{' '}
                {Math.max(
                  0,
                  Math.ceil(
                    (trialEndsAt.getTime() - Date.now()) / 86400000,
                  ),
                )}{' '}
                days
              </Text>
            </TouchableOpacity>
          )}

          {tier === 'free' && aiSessionsLimit != null && (
            <View style={styles.usageChip}>
              <Text style={styles.usageChipText}>
                AI: {aiSessionsUsed}/{aiSessionsLimit} this month
              </Text>
            </View>
          )}

          <View style={styles.chatDivider} />

          {/* Chat messages */}
          {displayMessages.map((msg, i) => {
            if (msg.role === 'user') {
              return <UserBubble key={i} text={msg.content} />;
            }

            const parsed = parseAssistantMessage(msg.content);
            return (
              <View key={i}>
                <AssistantBubble text={parsed.reply} />
                {parsed.workout && (
                  <WorkoutPreviewCard workout={parsed.workout} />
                )}
              </View>
            );
          })}

          {/* Loading indicator */}
          {chatLoading && (
            <View style={styles.assistantBubbleRow}>
              <View style={styles.assistantBubble}>
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={{ marginRight: spacing.sm }}
                />
                <Text style={styles.assistantBubbleText}>Thinking…</Text>
              </View>
            </View>
          )}

          {/* Accept & action buttons */}
          {pendingWorkout && !chatLoading && (
            <View style={styles.chatActions}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={acceptWorkout}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>
                  Accept & Start Workout
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={styles.blankWorkoutLink}
            onPress={startBlankWorkout}
            activeOpacity={0.7}
          >
            <Text style={styles.blankWorkoutLinkText}>
              or start a blank workout
            </Text>
          </TouchableOpacity>

          <View style={{ height: spacing.lg }} />
        </ScrollView>

        {/* Chat input bar */}
        <View
          style={[styles.inputBar, { paddingBottom: insets.bottom || spacing.md }]}
        >
          <TextInput
            style={styles.chatTextInput}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Adjust the workout…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            editable={!chatLoading}
            multiline={false}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!chatInput.trim() || chatLoading) && styles.sendButtonDisabled,
            ]}
            onPress={sendMessage}
            disabled={!chatInput.trim() || chatLoading}
            activeOpacity={0.7}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Standard View (no chat) ────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textTertiary}
          colors={[colors.primary]}
        />
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

      {/* Trial banner */}
      {isTrialing && trialEndsAt && (
        <TouchableOpacity
          style={styles.trialBanner}
          onPress={() =>
            navigation.getParent()?.navigate('PaywallScreen')
          }
          activeOpacity={0.8}
        >
          <Text style={styles.trialBannerText}>
            Setpoint+ trial ends in{' '}
            {Math.max(
              0,
              Math.ceil(
                (trialEndsAt.getTime() - Date.now()) / 86400000,
              ),
            )}{' '}
            days
          </Text>
        </TouchableOpacity>
      )}

      {/* AI usage counter (free tier only) */}
      {tier === 'free' && aiSessionsLimit != null && (
        <View style={styles.usageChip}>
          <Text style={styles.usageChipText}>
            AI: {aiSessionsUsed}/{aiSessionsLimit} this month
          </Text>
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
              <Text style={styles.exerciseSets}>
                {formatSets(exercise)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Actual exercises (shown for completed workouts) */}
      {showCompleted && (
        <View
          style={[
            styles.planCard,
            { borderLeftWidth: 3, borderLeftColor: colors.success },
          ]}
        >
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
              style={styles.primaryButton}
              onPress={startChat}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>
                Plan My Workout
              </Text>
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
              style={[styles.primaryButton, { marginTop: spacing.md }]}
              onPress={startChat}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>
                Plan Another Workout
              </Text>
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
  trialBanner: {
    backgroundColor: colors.warning + '18',
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  trialBannerText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '600',
  },
  usageChip: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  usageChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
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
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  completedBadge: {
    backgroundColor: colors.success + '15',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  completedText: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '600',
  },

  // Chat styles
  chatScroll: { flex: 1 },
  chatContent: { padding: spacing.lg, paddingBottom: spacing.md },
  chatDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },

  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.md,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    maxWidth: '80%',
  },
  userBubbleText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 21,
  },

  assistantBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing.sm,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  assistantBubbleText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    flexShrink: 1,
  },

  workoutPreview: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    padding: spacing.md,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
    marginRight: spacing.xl,
  },
  workoutPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  workoutPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs + 1,
  },
  workoutPreviewName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
  },
  workoutPreviewDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },

  chatActions: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },

  blankWorkoutLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  blankWorkoutLinkText: {
    color: colors.textTertiary,
    fontSize: 14,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surface,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
