import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import { ExerciseSet, DAY_NAMES } from '../types/database';
import { formatWeight, formatWeightWithUnit } from '../lib/formatWeight';

// ─── Types ──────────────────────────────────────────────────

type CalendarViewMode = 'month' | 'week' | 'day';

type ExerciseDetail = {
  id: string;
  name: string;
  exercise_type: string;
  is_planned: boolean;
  exercise_order: number;
  equipment_count: number | null;
  sets: { weight: number | null; reps: number | null; rpe: number | null }[];
  cardio: {
    duration_minutes: number | null;
    distance: number | null;
    pace: string | null;
    heart_rate: number | null;
    notes: string | null;
  } | null;
};

type WorkoutMarker = {
  id: string;
  date: string;
  type: string | null;
  status: 'planned' | 'in_progress' | 'completed';
  exerciseSummary: string;
  exercises: ExerciseDetail[];
};

type AIWorkout = {
  type: string;
  exercises: {
    name: string;
    exercise_type: 'strength' | 'cardio';
    sets?: number;
    reps?: number;
    weight?: number;
    equipment_count?: number;
    duration_minutes?: number;
    distance?: number;
    pace?: string;
  }[];
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ─── Constants ──────────────────────────────────────────────

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const CHAT_COLLAPSED = 50;
const CHAT_EXPANDED = Math.min(SCREEN_HEIGHT * 0.42, 400);
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Helpers ────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function getMonthGrid(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const start = new Date(year, month, 1 - startOffset);
  const weeks: Date[][] = [];

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(start));
      start.setDate(start.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function getWeekDays(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start));
    start.setDate(start.getDate() + 1);
  }
  return days;
}

function getDateRange(view: CalendarViewMode, refDate: Date): { start: string; end: string } {
  if (view === 'month') {
    const grid = getMonthGrid(refDate.getFullYear(), refDate.getMonth());
    return { start: toDateKey(grid[0][0]), end: toDateKey(grid[5][6]) };
  }
  if (view === 'week') {
    const days = getWeekDays(refDate);
    return { start: toDateKey(days[0]), end: toDateKey(days[6]) };
  }
  const key = toDateKey(refDate);
  return { start: key, end: key };
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return colors.success;
    case 'in_progress': return colors.warning;
    default: return colors.primary;
  }
}

function formatExerciseBrief(ex: ExerciseDetail): string {
  if (ex.exercise_type === 'strength' && ex.sets.length > 0) {
    const first = ex.sets[0];
    const parts: string[] = [];
    const w = formatWeight(first.weight, ex.equipment_count);
    if (w) parts.push(w);
    if (first.reps != null) parts.push(`${first.reps}`);
    const main = parts.join(' × ');
    const suffix = ex.sets.length > 1 ? ` × ${ex.sets.length}` : '';
    return main + suffix;
  }
  if (ex.exercise_type === 'cardio' && ex.cardio) {
    const parts: string[] = [];
    if (ex.cardio.duration_minutes != null) parts.push(`${ex.cardio.duration_minutes} min`);
    if (ex.cardio.distance != null) parts.push(`${ex.cardio.distance} mi`);
    return parts.join(', ');
  }
  return '';
}

function formatFullDate(d: Date): string {
  return `${DAY_NAMES[d.getDay()]}, ${SHORT_MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// ─── Chat Bubbles ───────────────────────────────────────────

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

function EditField({
  label,
  value,
  onChange,
  keyboard = 'decimal-pad',
  width = 52,
}: {
  label: string;
  value: string | number | undefined | null;
  onChange: (v: string) => void;
  keyboard?: 'number-pad' | 'decimal-pad' | 'default';
  width?: number;
}) {
  return (
    <View style={styles.editFieldGroup}>
      <TextInput
        style={[styles.editFieldInput, { width }]}
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
        keyboardType={keyboard}
        selectTextOnFocus
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
      />
      <Text style={styles.editFieldLabel}>{label}</Text>
    </View>
  );
}

function WorkoutPreviewCard({
  workout,
  onUpdate,
}: {
  workout: AIWorkout;
  onUpdate?: (updated: AIWorkout) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AIWorkout>(workout);

  React.useEffect(() => {
    setDraft(workout);
    setEditing(false);
  }, [JSON.stringify(workout)]);

  const updateNum = (index: number, field: string, value: string) => {
    setDraft((prev) => {
      const exercises = [...prev.exercises];
      const parsed = value === '' ? undefined : Number(value);
      exercises[index] = {
        ...exercises[index],
        [field]: parsed == null || isNaN(parsed) ? undefined : parsed,
      };
      return { ...prev, exercises };
    });
  };

  const updateStr = (index: number, field: string, value: string) => {
    setDraft((prev) => {
      const exercises = [...prev.exercises];
      exercises[index] = { ...exercises[index], [field]: value || undefined };
      return { ...prev, exercises };
    });
  };

  const startEditing = () => {
    Haptics.selectionAsync();
    setEditing(true);
  };

  const finishEditing = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(false);
    onUpdate?.(draft);
  };

  const display = editing ? draft : workout;

  return (
    <View style={styles.workoutPreview}>
      <View style={styles.workoutPreviewHeader}>
        <Text style={styles.workoutPreviewTitle}>{display.type}</Text>
        {onUpdate && !editing && (
          <TouchableOpacity
            onPress={startEditing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.editIconBtn}
          >
            <SymbolView
              name="pencil"
              tintColor={colors.primary}
              style={{ width: 13, height: 13 }}
              type="monochrome"
            />
            <Text style={styles.editIconLabel}>Edit</Text>
          </TouchableOpacity>
        )}
        {editing && (
          <TouchableOpacity onPress={finishEditing} style={styles.doneEditBtn}>
            <Text style={styles.doneEditBtnText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>
      {display.exercises.map((ex, i) => (
        <View key={i} style={editing ? styles.editExerciseRow : styles.workoutPreviewRow}>
          <Text style={[styles.workoutPreviewName, editing && { marginBottom: 4 }]}>
            {ex.name}
          </Text>
          {!editing ? (
            <Text style={styles.workoutPreviewDetail}>
              {ex.exercise_type === 'strength'
                ? [
                    ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : null,
                    ex.weight
                      ? formatWeightWithUnit(ex.weight, ex.equipment_count)
                      : null,
                  ].filter(Boolean).join(' @ ')
                : [
                    ex.duration_minutes ? `${ex.duration_minutes} min` : null,
                    ex.distance ? `${ex.distance} mi` : null,
                    ex.pace ?? null,
                  ].filter(Boolean).join(', ')}
            </Text>
          ) : ex.exercise_type === 'strength' ? (
            <View style={styles.editFieldsRow}>
              <EditField label="Sets" value={ex.sets} onChange={(v) => updateNum(i, 'sets', v)} />
              <Text style={styles.editFieldSep}>×</Text>
              <EditField label="Reps" value={ex.reps} onChange={(v) => updateNum(i, 'reps', v)} />
              <Text style={styles.editFieldSep}>@</Text>
              <EditField
                label="lbs"
                value={ex.weight}
                onChange={(v) => updateNum(i, 'weight', v)}
              />
            </View>
          ) : (
            <View style={styles.editFieldsRow}>
              <EditField
                label="Min"
                value={ex.duration_minutes}
                onChange={(v) => updateNum(i, 'duration_minutes', v)}
              />
              <EditField
                label="Miles"
                value={ex.distance}
                onChange={(v) => updateNum(i, 'distance', v)}
                keyboard="decimal-pad"
              />
              <EditField
                label="Pace"
                value={ex.pace}
                onChange={(v) => updateStr(i, 'pace', v)}
                keyboard="default"
                width={60}
              />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function CalendarScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const { tier, aiSessionsUsed, aiSessionsLimit, refreshSubscription } =
    useSubscription();
  const insets = useSafeAreaInsets();

  // Calendar state
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [refDate, setRefDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [workoutsByDate, setWorkoutsByDate] = useState<Record<string, WorkoutMarker[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Chat state
  const [chatExpanded, setChatExpanded] = useState(false);
  const chatHeight = useRef(new Animated.Value(CHAT_COLLAPSED)).current;
  const chatScrollRef = useRef<ScrollView>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingWorkout, setPendingWorkout] = useState<AIWorkout | null>(null);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0, width: 0 });
  const viewDropdownRef = useRef<View>(null);

  const tKey = todayKey();
  const selectedKey = toDateKey(selectedDate);

  // ─── Data fetching ──────────────────────────────────────────

  const fetchWorkouts = useCallback(async () => {
    if (!user) return;
    const { start, end } = getDateRange(viewMode, refDate);

    const { data } = await supabase
      .from('workouts')
      .select(`
        id, date, type, status,
        workout_exercises (
          id, name, is_planned, exercise_type, exercise_order, equipment_count,
          exercise_sets ( weight, reps, rpe, set_number ),
          cardio_entries ( duration_minutes, distance, pace, heart_rate, notes )
        )
      `)
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
      .order('date')
      .order('created_at');

    if (data) {
      const map: Record<string, WorkoutMarker[]> = {};
      for (const w of data as any[]) {
        const allEx: ExerciseDetail[] = (w.workout_exercises ?? [])
          .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
          .map((e: any) => ({
            id: e.id,
            name: e.name,
            exercise_type: e.exercise_type,
            is_planned: e.is_planned,
            exercise_order: e.exercise_order,
            equipment_count: e.equipment_count ?? null,
            sets: (e.exercise_sets ?? [])
              .sort((a: ExerciseSet, b: ExerciseSet) => a.set_number - b.set_number)
              .map((s: any) => ({ weight: s.weight, reps: s.reps, rpe: s.rpe })),
            cardio: e.cardio_entries?.[0] ?? null,
          }));

        const actual = allEx.filter((e) => !e.is_planned);
        const planned = allEx.filter((e) => e.is_planned);
        const display = actual.length > 0 ? actual : planned;
        const names = display.map((e) => e.name).slice(0, 3);
        const summary =
          names.length > 0
            ? names.join(', ') + (display.length > 3 ? ` +${display.length - 3}` : '')
            : '';

        const marker: WorkoutMarker = {
          id: w.id,
          date: w.date,
          type: w.type,
          status: w.status,
          exerciseSummary: summary,
          exercises: allEx,
        };

        if (!map[w.date]) map[w.date] = [];
        map[w.date].push(marker);
      }
      setWorkoutsByDate(map);
    }
    setLoading(false);
  }, [user, viewMode, refDate]);

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

  // ─── Navigation ─────────────────────────────────────────────

  const navigatePrev = () => {
    Haptics.selectionAsync();
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === 'month') next.setMonth(next.getMonth() - 1);
      else if (viewMode === 'week') next.setDate(next.getDate() - 7);
      else next.setDate(next.getDate() - 1);
      return next;
    });
  };

  const navigateNext = () => {
    Haptics.selectionAsync();
    setRefDate((d) => {
      const next = new Date(d);
      if (viewMode === 'month') next.setMonth(next.getMonth() + 1);
      else if (viewMode === 'week') next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + 1);
      return next;
    });
  };

  const goToToday = () => {
    Haptics.selectionAsync();
    const now = new Date();
    setRefDate(now);
    setSelectedDate(now);
  };

  const selectDay = (d: Date) => {
    Haptics.selectionAsync();
    setSelectedDate(d);
    if (viewMode === 'day') setRefDate(d);
  };

  const changeView = (mode: CalendarViewMode) => {
    Haptics.selectionAsync();
    setViewMode(mode);
    if (mode === 'day') setRefDate(selectedDate);
  };

  // ─── Chat panel toggle ─────────────────────────────────────

  const toggleChat = () => {
    const expanding = !chatExpanded;
    setChatExpanded(expanding);
    Animated.spring(chatHeight, {
      toValue: expanding ? CHAT_EXPANDED : CHAT_COLLAPSED,
      useNativeDriver: false,
      tension: 65,
      friction: 11,
    }).start();
    if (expanding) {
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 200);
    }
  };

  // ─── AI Chat ────────────────────────────────────────────────

  const aiLimitReached =
    tier === 'free' && aiSessionsLimit != null && aiSessionsUsed >= aiSessionsLimit;

  const startAIChat = async () => {
    if (!user) return;
    if (aiLimitReached) {
      Alert.alert(
        'AI Limit Reached',
        `You've used all ${aiSessionsLimit} free AI sessions this month. Upgrade to Setpoint+ for unlimited AI coaching.`,
        [
          { text: 'OK', style: 'cancel' },
          { text: 'Upgrade', onPress: () => navigation.getParent()?.navigate('PaywallScreen') },
        ],
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!chatExpanded) toggleChat();
    setChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat-workout', {
        body: { messages: [], date: selectedKey },
      });

      if (error) {
        const body = (error as any).context ?? {};
        if (body?.code === 'AI_LIMIT_REACHED') {
          Alert.alert('AI Limit Reached', body.error, [
            { text: 'OK', style: 'cancel' },
            { text: 'Upgrade', onPress: () => navigation.getParent()?.navigate('PaywallScreen') },
          ]);
          setChatLoading(false);
          return;
        }
        throw new Error(body?.error ?? 'Failed to get AI recommendation.');
      }

      if (!data?.workout) throw new Error('No workout returned from AI.');

      const rawResponse = JSON.stringify(data);
      setChatMessages([
        { role: 'user', content: `Plan my workout for ${formatFullDate(selectedDate)}` },
        { role: 'assistant', content: rawResponse },
      ]);
      setPendingWorkout(data.workout);
      refreshSubscription();
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to get recommendation.');
    } finally {
      setChatLoading(false);
    }
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput('');
    setChatLoading(true);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { data, error } = await supabase.functions.invoke('chat-workout', {
        body: { messages: updated, date: selectedKey },
      });
      if (error) {
        const body = (error as any).context ?? {};
        const errMsg: ChatMessage = {
          role: 'assistant',
          content: JSON.stringify({ reply: body?.error ?? 'Something went wrong.', workout: pendingWorkout }),
        };
        setChatMessages([...updated, errMsg]);
        setChatLoading(false);
        return;
      }
      setChatMessages([...updated, { role: 'assistant', content: JSON.stringify(data) }]);
      if (data?.workout) setPendingWorkout(data.workout);
      refreshSubscription();
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
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
      const lastAssistant = [...chatMessages].reverse().find((m) => m.role === 'assistant');
      let summary = '';
      try {
        summary = JSON.parse(lastAssistant?.content ?? '').reply;
      } catch {}

      const { data: workout, error: workoutError } = await supabase
        .from('workouts')
        .insert({
          user_id: user.id,
          date: selectedKey,
          type: pendingWorkout.type,
          status: 'in_progress' as const,
          ai_summary: summary,
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      for (let i = 0; i < pendingWorkout.exercises.length; i++) {
        const ex = pendingWorkout.exercises[i];

        await supabase.from('workout_exercises').insert({
          workout_id: workout.id,
          name: ex.name,
          exercise_type: ex.exercise_type ?? 'strength',
          exercise_order: i,
          is_planned: true,
          equipment_count: ex.equipment_count ?? null,
        });

        const { data: actualEx, error: exError } = await supabase
          .from('workout_exercises')
          .insert({
            workout_id: workout.id,
            name: ex.name,
            exercise_type: ex.exercise_type ?? 'strength',
            exercise_order: i,
            is_planned: false,
            equipment_count: ex.equipment_count ?? null,
          })
          .select()
          .single();

        if (exError) throw exError;

        if (ex.exercise_type !== 'cardio' && ex.sets != null && ex.reps != null) {
          const setInserts = Array.from({ length: ex.sets }, (_, s) => ({
            exercise_id: actualEx.id,
            set_number: s + 1,
            weight: ex.weight ?? null,
            reps: ex.reps,
          }));
          await supabase.from('exercise_sets').insert(setInserts);
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

      supabase.functions.invoke('rebuild-ai-profile', { body: {} }).catch(() => {});

      setChatMessages([]);
      setPendingWorkout(null);
      setChatInput('');

      navigation.getParent()?.navigate('WorkoutScreen', { workoutId: workout.id });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create workout.');
    }
  };

  const parseAssistantMsg = (content: string) => {
    try {
      return JSON.parse(content) as { reply: string; workout?: AIWorkout };
    } catch {
      return { reply: content };
    }
  };

  // ─── Workout actions ────────────────────────────────────────

  const openWorkout = (marker: WorkoutMarker) => {
    Haptics.selectionAsync();
    navigation.getParent()?.navigate('WorkoutScreen', {
      workoutId: marker.id,
      mode: marker.status === 'planned' ? 'plan' : 'log',
    });
  };

  const startPlannedWorkout = async (marker: WorkoutMarker) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await supabase.from('workouts').update({ status: 'in_progress' }).eq('id', marker.id);

    const planned = marker.exercises.filter((e) => e.is_planned);
    for (const p of planned) {
      const { data: actual } = await supabase
        .from('workout_exercises')
        .insert({
          workout_id: marker.id,
          name: p.name,
          exercise_type: p.exercise_type,
          exercise_order: p.exercise_order,
          is_planned: false,
          equipment_count: p.equipment_count,
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

    navigation.getParent()?.navigate('WorkoutScreen', { workoutId: marker.id, mode: 'log' });
  };

  // ─── Computed values ────────────────────────────────────────

  const headerTitle = useMemo(() => {
    if (viewMode === 'day') return formatFullDate(refDate);
    if (viewMode === 'week') {
      const days = getWeekDays(refDate);
      const s = days[0];
      const e = days[6];
      if (s.getMonth() === e.getMonth()) {
        return `${SHORT_MONTH_NAMES[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
      }
      return `${SHORT_MONTH_NAMES[s.getMonth()]} ${s.getDate()} – ${SHORT_MONTH_NAMES[e.getMonth()]} ${e.getDate()}`;
    }
    return `${SHORT_MONTH_NAMES[refDate.getMonth()]} ${refDate.getFullYear()}`;
  }, [viewMode, refDate]);

  const monthGrid = useMemo(
    () => (viewMode === 'month' ? getMonthGrid(refDate.getFullYear(), refDate.getMonth()) : []),
    [viewMode, refDate],
  );

  const weekDays = useMemo(
    () => (viewMode === 'week' ? getWeekDays(refDate) : []),
    [viewMode, refDate],
  );

  const selectedDayWorkouts = workoutsByDate[selectedKey] ?? [];

  const showTodayButton = toDateKey(refDate) !== tKey;
  const displayMessages = chatMessages.slice(1);

  const lastWorkoutMsgIdx = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'assistant') {
        try {
          const p = JSON.parse(displayMessages[i].content);
          if (p.workout) return i;
        } catch {}
      }
    }
    return -1;
  }, [displayMessages]);

  // ─── Loading ────────────────────────────────────────────────

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
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 85 : 0}
    >
      {/* ── Calendar area ─────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {/* Header: navigation + view toggle */}
        <View style={styles.header}>
          <View style={styles.headerNav}>
            <TouchableOpacity onPress={navigatePrev} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <SymbolView name="chevron.left" tintColor={colors.text} style={styles.navArrow} type="monochrome" />
            </TouchableOpacity>

            <TouchableOpacity onPress={goToToday} activeOpacity={0.7}>
              <Text style={styles.headerTitle}>{headerTitle}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={navigateNext} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <SymbolView name="chevron.right" tintColor={colors.text} style={styles.navArrow} type="monochrome" />
            </TouchableOpacity>
          </View>

          <View style={styles.headerRight}>
            {showTodayButton && (
              <TouchableOpacity style={styles.todayChip} onPress={goToToday} activeOpacity={0.7}>
                <Text style={styles.todayChipText}>Today</Text>
              </TouchableOpacity>
            )}

            <View ref={viewDropdownRef} collapsable={false}>
              <TouchableOpacity
                style={styles.viewDropdownTrigger}
                onPress={() => {
                  Haptics.selectionAsync();
                  viewDropdownRef.current?.measureInWindow((x, y, width, height) => {
                    const menuWidth = 150;
                    const rightEdge = x + width;
                    const menuLeft = Math.max(spacing.sm, rightEdge - menuWidth);
                    setDropdownPos({ x: menuLeft, y: y + height + 4, width: menuWidth });
                    setViewDropdownOpen(true);
                  });
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.viewDropdownTriggerText}>
                  {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}
                </Text>
                <SymbolView
                  name="chevron.down"
                  tintColor={colors.primary}
                  style={{ width: 10, height: 10 }}
                  type="monochrome"
                />
              </TouchableOpacity>
            </View>

            <Modal
              visible={viewDropdownOpen}
              transparent
              animationType="none"
              onRequestClose={() => setViewDropdownOpen(false)}
            >
              <Pressable
                style={styles.viewDropdownOverlay}
                onPress={() => setViewDropdownOpen(false)}
              >
                <View
                  style={[
                    styles.viewDropdownMenu,
                    {
                      position: 'absolute',
                      top: dropdownPos.y,
                      left: dropdownPos.x,
                      width: dropdownPos.width,
                    },
                  ]}
                >
                  {(['month', 'week', 'day'] as const).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.viewDropdownItem,
                        viewMode === m && styles.viewDropdownItemActive,
                      ]}
                      onPress={() => {
                        changeView(m);
                        setViewDropdownOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.viewDropdownItemText,
                          viewMode === m && styles.viewDropdownItemTextActive,
                        ]}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </Text>
                      {viewMode === m && (
                        <SymbolView
                          name="checkmark"
                          tintColor={colors.primary}
                          style={{ width: 14, height: 14 }}
                          type="monochrome"
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>
          </View>
        </View>

        {/* Calendar content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textTertiary}
              colors={[colors.primary]}
            />
          }
        >
          {/* ── Month view ──────────────────────────────── */}
          {viewMode === 'month' && (
            <View>
              {/* Weekday headers */}
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((label) => (
                  <View key={label} style={styles.weekdayCell}>
                    <Text style={styles.weekdayText}>{label}</Text>
                  </View>
                ))}
              </View>

              {/* Day grid */}
              {monthGrid.map((week, wi) => (
                <View key={wi} style={styles.weekRow}>
                  {week.map((day) => {
                    const key = toDateKey(day);
                    const isCurrentMonth = day.getMonth() === refDate.getMonth();
                    const isToday = key === tKey;
                    const isSelected = key === selectedKey;
                    const dayWorkouts = workoutsByDate[key] ?? [];
                    const hasPending = pendingWorkout && key === selectedKey;

                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.dayCell,
                          isSelected && styles.dayCellSelected,
                        ]}
                        onPress={() => selectDay(day)}
                        activeOpacity={0.6}
                      >
                        <View style={[styles.dayNumberWrap, isToday && styles.dayNumberToday]}>
                          <Text
                            style={[
                              styles.dayNumber,
                              !isCurrentMonth && styles.dayNumberMuted,
                              isToday && styles.dayNumberTodayText,
                              isSelected && styles.dayNumberSelectedText,
                            ]}
                          >
                            {day.getDate()}
                          </Text>
                        </View>

                        {/* Workout dots */}
                        <View style={styles.dotRow}>
                          {dayWorkouts.slice(0, 3).map((w) => (
                            <View
                              key={w.id}
                              style={[styles.dot, { backgroundColor: statusColor(w.status) }]}
                            />
                          ))}
                          {hasPending && dayWorkouts.length === 0 && (
                            <View style={[styles.dot, styles.dotPending]} />
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {/* ── Week view ───────────────────────────────── */}
          {viewMode === 'week' && (
            <View style={styles.weekViewContainer}>
              {weekDays.map((day) => {
                const key = toDateKey(day);
                const isToday = key === tKey;
                const isSelected = key === selectedKey;
                const dayWorkouts = workoutsByDate[key] ?? [];

                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.weekDayCard,
                      isSelected && styles.weekDayCardSelected,
                      isToday && !isSelected && styles.weekDayCardToday,
                    ]}
                    onPress={() => selectDay(day)}
                    activeOpacity={0.6}
                  >
                    <Text style={[styles.weekDayLabel, isToday && styles.weekDayLabelToday]}>
                      {WEEKDAY_LABELS[day.getDay()]}
                    </Text>
                    <Text style={[styles.weekDayNumber, isToday && styles.weekDayNumberToday]}>
                      {day.getDate()}
                    </Text>

                    {dayWorkouts.length > 0 ? (
                      dayWorkouts.map((w) => (
                        <View
                          key={w.id}
                          style={[styles.weekWorkoutChip, { borderLeftColor: statusColor(w.status) }]}
                        >
                          <Text style={styles.weekWorkoutType} numberOfLines={1}>
                            {w.type ?? 'Workout'}
                          </Text>
                          <Text style={styles.weekWorkoutSummary} numberOfLines={2}>
                            {w.exerciseSummary}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.weekRestLabel}>Rest</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* ── Day view ────────────────────────────────── */}
          {viewMode === 'day' && (
            <View style={styles.dayViewContainer}>
              <Text style={styles.dayViewDate}>{formatFullDate(refDate)}</Text>
              {selectedDayWorkouts.length > 0 ? (
                selectedDayWorkouts.map((w) => renderDayWorkoutCard(w))
              ) : (
                <View style={styles.emptyDay}>
                  <Text style={styles.emptyDayTitle}>Rest Day</Text>
                  <Text style={styles.emptyDaySubtitle}>No workout planned</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Selected day details (month & week views) ─ */}
          {viewMode !== 'day' && (
            <View style={styles.dayDetailSection}>
              <Text style={styles.dayDetailTitle}>{formatFullDate(selectedDate)}</Text>

              {selectedDayWorkouts.length > 0 ? (
                selectedDayWorkouts.map((w) => renderWorkoutCard(w))
              ) : (
                <View style={styles.emptyDayCompact}>
                  <Text style={styles.emptyDayCompactText}>
                    {selectedKey >= tKey ? 'No workout planned' : 'Rest day'}
                  </Text>
                </View>
              )}

              {/* Plan button if no workout on this day */}
              {selectedDayWorkouts.length === 0 && selectedKey >= tKey && (
                <TouchableOpacity
                  style={styles.planButton}
                  onPress={startAIChat}
                  activeOpacity={0.8}
                >
                  <SymbolView
                    name="sparkles"
                    tintColor="#fff"
                    style={{ width: 16, height: 16 }}
                    type="monochrome"
                  />
                  <Text style={styles.planButtonText}>Plan with AI</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </View>

      {/* ── AI Chat Panel ─────────────────────────────────── */}
      <Animated.View style={[styles.chatPanel, { height: chatHeight }]}>
        {/* Chat header / collapse bar */}
        <TouchableOpacity style={styles.chatPanelHeader} onPress={toggleChat} activeOpacity={0.7}>
          <View style={styles.chatPanelHeaderLeft}>
            <SymbolView
              name="sparkles"
              tintColor={colors.primary}
              style={{ width: 16, height: 16 }}
              type="monochrome"
            />
            <Text style={styles.chatPanelTitle}>AI Coach</Text>
            {chatExpanded && (
              <Text style={styles.chatPanelDate}>
                · {SHORT_MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
              </Text>
            )}
          </View>
          <SymbolView
            name={chatExpanded ? 'chevron.down' : 'chevron.up'}
            tintColor={colors.textTertiary}
            style={{ width: 14, height: 14 }}
            type="monochrome"
          />
        </TouchableOpacity>

        {/* Chat content (only when expanded) */}
        {chatExpanded && (
          <>
            <ScrollView
              ref={chatScrollRef}
              style={styles.chatScrollArea}
              contentContainerStyle={styles.chatScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {displayMessages.length === 0 && !chatLoading && (
                <View style={styles.chatEmpty}>
                  <Text style={styles.chatEmptyText}>
                    Tap "Plan with AI" or type a message to get started.
                  </Text>

                  {selectedKey >= tKey && selectedDayWorkouts.length === 0 && (
                    <TouchableOpacity
                      style={[styles.planButton, { marginTop: spacing.md }]}
                      onPress={startAIChat}
                      activeOpacity={0.8}
                    >
                      <SymbolView
                        name="sparkles"
                        tintColor="#fff"
                        style={{ width: 16, height: 16 }}
                        type="monochrome"
                      />
                      <Text style={styles.planButtonText}>
                        Plan {formatFullDate(selectedDate)}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {displayMessages.map((msg, i) => {
                if (msg.role === 'user') return <UserBubble key={i} text={msg.content} />;
                const parsed = parseAssistantMsg(msg.content);
                const isLatestWorkout = parsed.workout && i === lastWorkoutMsgIdx;
                return (
                  <View key={i}>
                    <AssistantBubble text={parsed.reply} />
                    {parsed.workout && (
                      <WorkoutPreviewCard
                        workout={isLatestWorkout ? (pendingWorkout ?? parsed.workout) : parsed.workout}
                        onUpdate={isLatestWorkout ? setPendingWorkout : undefined}
                      />
                    )}
                  </View>
                );
              })}

              {chatLoading && (
                <View style={styles.assistantBubbleRow}>
                  <View style={styles.assistantBubble}>
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.sm }} />
                    <Text style={styles.assistantBubbleText}>Thinking…</Text>
                  </View>
                </View>
              )}

              {pendingWorkout && !chatLoading && (
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={acceptWorkout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.acceptButtonText}>Accept & Start Workout</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            {/* Input bar */}
            <View style={[styles.chatInputBar, { paddingBottom: Math.max(insets.bottom - 20, 4) }]}>
              <TextInput
                style={styles.chatTextInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder="Adjust the plan…"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="send"
                onSubmitEditing={sendChatMessage}
                editable={!chatLoading}
                multiline={false}
              />
              <TouchableOpacity
                style={[styles.sendButton, (!chatInput.trim() || chatLoading) && styles.sendButtonDisabled]}
                onPress={sendChatMessage}
                disabled={!chatInput.trim() || chatLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.sendButtonText}>↑</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );

  // ─── Render helpers ─────────────────────────────────────────

  function renderWorkoutCard(w: WorkoutMarker) {
    const actual = w.exercises.filter((e) => !e.is_planned);
    const planned = w.exercises.filter((e) => e.is_planned);
    const display = actual.length > 0 ? actual : planned;
    const isUpcoming = w.status === 'planned' && w.date >= tKey;

    return (
      <TouchableOpacity
        key={w.id}
        style={[styles.workoutCard, isUpcoming && styles.workoutCardPlanned]}
        onPress={() => openWorkout(w)}
        activeOpacity={0.7}
      >
        <View style={styles.workoutCardHeader}>
          <Text style={styles.workoutCardType}>{w.type ?? 'Workout'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(w.status) + '22' }]}>
            <View style={[styles.statusDotSmall, { backgroundColor: statusColor(w.status) }]} />
            <Text style={[styles.statusBadgeText, { color: statusColor(w.status) }]}>
              {w.status === 'completed' ? 'Done' : w.status === 'in_progress' ? 'Active' : 'Planned'}
            </Text>
          </View>
        </View>

        {display.slice(0, 4).map((ex, i) => (
          <View key={`${ex.id}-${i}`} style={styles.exerciseRow}>
            <Text style={styles.exerciseName} numberOfLines={1}>{ex.name}</Text>
            <Text style={styles.exerciseDetail}>{formatExerciseBrief(ex)}</Text>
          </View>
        ))}
        {display.length > 4 && (
          <Text style={styles.moreExercises}>+{display.length - 4} more</Text>
        )}

        {isUpcoming && (
          <View style={styles.workoutCardActions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => openWorkout(w)}
              activeOpacity={0.8}
            >
              <Text style={styles.editButtonText}>Edit Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => startPlannedWorkout(w)}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonText}>Start</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  function renderDayWorkoutCard(w: WorkoutMarker) {
    const actual = w.exercises.filter((e) => !e.is_planned);
    const planned = w.exercises.filter((e) => e.is_planned);
    const isUpcoming = w.status === 'planned' && w.date >= tKey;

    return (
      <View key={w.id} style={[styles.dayWorkoutCard, isUpcoming && styles.workoutCardPlanned]}>
        <View style={styles.workoutCardHeader}>
          <Text style={styles.workoutCardType}>{w.type ?? 'Workout'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(w.status) + '22' }]}>
            <View style={[styles.statusDotSmall, { backgroundColor: statusColor(w.status) }]} />
            <Text style={[styles.statusBadgeText, { color: statusColor(w.status) }]}>
              {w.status === 'completed' ? 'Done' : w.status === 'in_progress' ? 'Active' : 'Planned'}
            </Text>
          </View>
        </View>

        {planned.length > 0 && actual.length > 0 && (
          <Text style={styles.sectionLabel}>Planned</Text>
        )}
        {planned.length > 0 && planned.map((ex, i) => (
          <View key={`p-${ex.id}-${i}`} style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            <Text style={styles.exerciseDetail}>{formatExerciseBrief(ex)}</Text>
          </View>
        ))}

        {actual.length > 0 && planned.length > 0 && (
          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Actual</Text>
        )}
        {actual.length > 0 && actual.map((ex, i) => (
          <View key={`a-${ex.id}-${i}`} style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>{ex.name}</Text>
            {ex.exercise_type === 'strength' && ex.sets.map((set, si) => {
              const parts: string[] = [];
              const w = formatWeight(set.weight, ex.equipment_count);
              if (w) parts.push(w);
              if (set.reps != null) parts.push(`${set.reps}`);
              const main = parts.join(' × ');
              const line = set.rpe != null ? `${main} @${set.rpe}` : main;
              return (
                <Text key={si} style={styles.setLine}>Set {si + 1} — {line || '—'}</Text>
              );
            })}
            {ex.exercise_type === 'cardio' && ex.cardio && (
              <View>
                {ex.cardio.duration_minutes != null && (
                  <Text style={styles.setLine}>{ex.cardio.duration_minutes} min</Text>
                )}
                {ex.cardio.distance != null && (
                  <Text style={styles.setLine}>{ex.cardio.distance} mi</Text>
                )}
                {ex.cardio.pace && (
                  <Text style={styles.setLine}>Pace: {ex.cardio.pace}</Text>
                )}
              </View>
            )}
          </View>
        ))}

        {actual.length === 0 && planned.length === 0 && (
          <Text style={styles.emptyExercises}>No exercises logged.</Text>
        )}

        <View style={styles.dayCardActions}>
          {isUpcoming && (
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => startPlannedWorkout(w)}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonText}>Start Workout</Text>
            </TouchableOpacity>
          )}
          {w.status === 'in_progress' && (
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => openWorkout(w)}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonText}>Continue Workout</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => openWorkout(w)}
            activeOpacity={0.8}
          >
            <Text style={styles.editButtonText}>
              {w.status === 'completed' ? 'View Details' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  navArrow: { width: 18, height: 18 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    minWidth: 130,
    textAlign: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  todayChip: {
    backgroundColor: colors.primary + '18',
    borderRadius: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  todayChipText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  viewDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '14',
    borderRadius: 8,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
  },
  viewDropdownTriggerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  viewDropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  viewDropdownMenu: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  viewDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md + 2,
  },
  viewDropdownItemActive: {
    backgroundColor: colors.primary + '10',
  },
  viewDropdownItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  viewDropdownItemTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // Month view
  weekdayRow: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    borderRadius: 8,
    minHeight: 48,
  },
  dayCellSelected: {
    backgroundColor: colors.primary + '15',
  },
  dayNumberWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberToday: {
    backgroundColor: colors.primary,
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  dayNumberMuted: {
    color: colors.textTertiary,
    opacity: 0.5,
  },
  dayNumberTodayText: {
    color: '#fff',
    fontWeight: '700',
  },
  dayNumberSelectedText: {
    fontWeight: '700',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
    height: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  dotPending: {
    backgroundColor: colors.primary,
    opacity: 0.4,
  },

  // Week view
  weekViewContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  weekDayCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.xs + 2,
    alignItems: 'center',
    minHeight: 120,
  },
  weekDayCardSelected: {
    backgroundColor: colors.primary + '18',
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  weekDayCardToday: {
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  weekDayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    marginBottom: 2,
  },
  weekDayLabelToday: {
    color: colors.primary,
  },
  weekDayNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  weekDayNumberToday: {
    color: colors.primary,
  },
  weekWorkoutChip: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: 6,
    borderLeftWidth: 2,
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginTop: 3,
  },
  weekWorkoutType: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.text,
  },
  weekWorkoutSummary: {
    fontSize: 9,
    color: colors.textSecondary,
    marginTop: 1,
  },
  weekRestLabel: {
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },

  // Day view
  dayViewContainer: {
    paddingTop: spacing.sm,
  },
  dayViewDate: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  dayWorkoutCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  setLine: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingLeft: spacing.sm,
  },
  emptyExercises: {
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  dayCardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },

  // Selected day detail section
  dayDetailSection: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  dayDetailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Workout card (compact, for month/week selected day)
  workoutCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  workoutCardPlanned: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  workoutCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  workoutCardType: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  exerciseRow: {
    paddingVertical: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  exerciseName: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
  },
  exerciseDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  moreExercises: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  workoutCardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  editButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '12',
    borderRadius: 10,
    paddingVertical: spacing.sm,
  },
  editButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  startButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.sm,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Empty states
  emptyDay: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyDayTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyDaySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyDayCompact: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyDayCompactText: {
    fontSize: 14,
    color: colors.textTertiary,
  },

  // Plan button
  planButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    alignSelf: 'center',
  },
  planButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Chat panel
  chatPanel: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  chatPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  chatPanelHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chatPanelTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  chatPanelDate: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  chatScrollArea: {
    flex: 1,
  },
  chatScrollContent: {
    padding: spacing.md,
    paddingTop: 0,
  },
  chatEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  chatEmptyText: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
  },

  // Chat bubbles
  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.sm,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: '80%',
  },
  userBubbleText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  assistantBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing.sm,
  },
  assistantBubble: {
    backgroundColor: colors.background,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  assistantBubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },

  // Workout preview (AI response)
  workoutPreview: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    padding: spacing.md,
    marginBottom: spacing.sm,
    marginRight: spacing.xl,
  },
  workoutPreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  workoutPreviewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  editIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '14',
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  editIconLabel: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  doneEditBtn: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  doneEditBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  editExerciseRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border + '50',
  },
  editFieldsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editFieldGroup: {
    alignItems: 'center',
  },
  editFieldInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 6 : 4,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    minHeight: 34,
  },
  editFieldLabel: {
    fontSize: 10,
    color: colors.textTertiary,
    marginTop: 2,
  },
  editFieldSep: {
    fontSize: 14,
    color: colors.textTertiary,
    fontWeight: '500',
    marginTop: -12,
  },
  workoutPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  workoutPreviewName: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
  },
  workoutPreviewDetail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },

  // Accept button
  acceptButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.sm + 2,
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Chat input
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.sm - 2,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.background,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
