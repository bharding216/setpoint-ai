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
  Modal,
  Linking,
  Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { requestReviewManually } from '../lib/storeReview';
import { colors, spacing } from '../theme';

// ─── Reusable menu row ──────────────────────────────────────

function MenuRow({
  label,
  detail,
  onPress,
  isFirst,
  isLast,
  chevron = true,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  chevron?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.menuRow,
        isFirst && styles.menuRowFirst,
        isLast && styles.menuRowLast,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.menuRowLabel}>{label}</Text>
      <View style={styles.menuRowRight}>
        {detail ? <Text style={styles.menuRowDetail}>{detail}</Text> : null}
        {chevron && <Text style={styles.menuRowChevron}>›</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Summary helpers ────────────────────────────────────────

function useProfileSummary() {
  const { user } = useAuth();
  const [scheduleDays, setScheduleDays] = useState(0);
  const [goalCount, setGoalCount] = useState(0);
  const [prefCount, setPrefCount] = useState(0);
  const [equipCount, setEquipCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;

      supabase
        .from('weekly_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(({ count }) => setScheduleDays(count ?? 0));

      supabase
        .from('training_preferences')
        .select('category')
        .eq('user_id', user.id)
        .then(({ data }) => {
          if (!data) return;
          setGoalCount(data.filter((d) => d.category === 'goal').length);
          setPrefCount(data.filter((d) => d.category === 'preference').length);
          setEquipCount(data.filter((d) => d.category === 'equipment').length);
        });
    }, [user]),
  );

  return { scheduleDays, goalCount, prefCount, equipCount };
}

// ─── Main Screen ────────────────────────────────────────────

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const { user, signOut } = useAuth();
  const {
    tier,
    isTrialing,
    trialEndsAt,
    aiSessionsUsed,
    aiSessionsLimit,
    manageSubscription,
    refreshSubscription,
    devTierOverride,
    setDevTierOverride,
  } = useSubscription();

  const { scheduleDays, goalCount, prefCount, equipCount } =
    useProfileSummary();

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [resettingAI, setResettingAI] = useState(false);

  // ── Handlers ──────────────────────────────────────────────

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleSendFeedback = async () => {
    const message = feedbackText.trim();
    if (!message || !user) return;

    setSendingFeedback(true);
    try {
      const { error } = await supabase.from('app_feedback').insert({
        user_id: user.id,
        message,
      });
      if (error) throw error;
      setFeedbackText('');
      setShowFeedback(false);
      Alert.alert(
        'Thank You!',
        'Your feedback has been submitted. We appreciate it!',
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to send feedback');
    } finally {
      setSendingFeedback(false);
    }
  };

  const handleContactSupport = () => {
    const subject = encodeURIComponent('Setpoint AI Support');
    const body = encodeURIComponent(
      `\n\n---\nApp Version: ${Constants.expoConfig?.version ?? '1.1'}\nUser: ${user?.email ?? 'unknown'}`,
    );
    Linking.openURL(
      `mailto:brandon@getsurmount.com?subject=${subject}&body=${body}`,
    );
  };

  const handleRateApp = async () => {
    const didRequest = await requestReviewManually();
    if (!didRequest) {
      Alert.alert(
        'Rate Setpoint AI',
        'Unable to open the store review on this device. You can rate us on the App Store or Google Play!',
      );
    }
  };

  const handleResetAISessions = () => {
    Alert.alert(
      'Reset AI Sessions',
      `This will reset your session counter from ${aiSessionsUsed} back to 0. Use this to re-test the AI usage limit flow.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            if (!user) return;
            setResettingAI(true);
            try {
              const { error } = await supabase
                .from('profiles')
                .update({ ai_sessions_this_month: 0 })
                .eq('id', user.id);
              if (error) {
                Alert.alert('Error', error.message);
              } else {
                await refreshSubscription();
                Alert.alert('Done', 'AI session counter reset to 0.');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to reset');
            } finally {
              setResettingAI(false);
            }
          },
        },
      ],
    );
  };

  const nav = navigation.getParent() ?? navigation;

  // ── Computed values ───────────────────────────────────────

  const profileParts: string[] = [];
  if (scheduleDays > 0) profileParts.push(`${scheduleDays}d schedule`);
  if (goalCount > 0) profileParts.push(`${goalCount} goal${goalCount !== 1 ? 's' : ''}`);
  if (prefCount > 0) profileParts.push(`${prefCount} pref${prefCount !== 1 ? 's' : ''}`);
  if (equipCount > 0) profileParts.push(`${equipCount} equip`);
  const profileSummary = profileParts.length > 0 ? profileParts.join(' · ') : 'Not configured';

  const subscriptionLabel =
    tier === 'plus'
      ? isTrialing && trialEndsAt
        ? `Setpoint+ (Trial — ${Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000))}d left)`
        : 'Setpoint+'
      : 'Free';

  // ── Render ────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* ── Training ─────────────────────────────────────── */}
      <Text style={styles.groupTitle}>Training</Text>
      <View style={styles.menuGroup}>
        <MenuRow
          label="Training Profile"
          detail={profileSummary}
          onPress={() => nav.navigate('TrainingProfileScreen')}
          isFirst
        />
        <MenuRow
          label="Fitness Baseline"
          detail="Lifts, paces, experience"
          onPress={() => nav.navigate('BaselineScreen')}
          isLast
        />
      </View>

      {/* ── Subscription ─────────────────────────────────── */}
      <Text style={styles.groupTitle}>Subscription</Text>
      <View style={styles.menuGroup}>
        <View style={[styles.menuRow, styles.menuRowFirst, styles.menuRowNonInteractive]}>
          <Text style={styles.menuRowLabel}>{subscriptionLabel}</Text>
          {aiSessionsLimit != null ? (
            <Text style={styles.menuRowDetail}>
              {aiSessionsUsed} / {aiSessionsLimit} sessions
            </Text>
          ) : tier === 'plus' ? (
            <Text style={styles.menuRowDetail}>Unlimited</Text>
          ) : null}
        </View>
        {tier === 'free' ? (
          <TouchableOpacity
            style={[styles.menuRow, styles.menuRowLast]}
            onPress={() => nav.navigate('PaywallScreen')}
            activeOpacity={0.7}
          >
            <Text style={[styles.menuRowLabel, { color: colors.primary, fontWeight: '600' }]}>
              Upgrade to Setpoint+
            </Text>
            <Text style={styles.menuRowChevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.menuRow, styles.menuRowLast]}
            onPress={manageSubscription}
            activeOpacity={0.7}
          >
            <Text style={styles.menuRowLabel}>Manage Subscription</Text>
            <Text style={styles.menuRowChevron}>›</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Support ──────────────────────────────────────── */}
      <Text style={styles.groupTitle}>Support</Text>
      <View style={styles.menuGroup}>
        <MenuRow
          label="Send Feedback"
          onPress={() => setShowFeedback(true)}
          isFirst
        />
        <MenuRow
          label="Contact Support"
          detail="brandon@getsurmount.com"
          onPress={handleContactSupport}
          chevron={false}
        />
        <MenuRow
          label="Rate Setpoint AI"
          detail="⭐"
          onPress={handleRateApp}
          isLast
          chevron={false}
        />
      </View>

      {/* ── Account ──────────────────────────────────────── */}
      <Text style={styles.groupTitle}>Account</Text>
      <View style={styles.menuGroup}>
        <View style={[styles.menuRow, styles.menuRowFirst, styles.menuRowNonInteractive]}>
          <Text style={styles.menuRowLabel}>{user?.email}</Text>
        </View>
        <TouchableOpacity
          style={[styles.menuRow, styles.menuRowLast]}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={[styles.menuRowLabel, { color: colors.error }]}>
            Log Out
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Developer Tools (dev builds only) ────────────── */}
      {__DEV__ && (
        <>
          <Text style={styles.groupTitle}>Developer Tools</Text>
          <View style={styles.menuGroup}>
            <View style={[styles.menuRow, styles.menuRowFirst, styles.menuRowNonInteractive]}>
              <Text style={styles.menuRowLabel}>Tier Override</Text>
              <View style={styles.devTierToggle}>
                <Text
                  style={[
                    styles.devTierLabel,
                    (devTierOverride ?? tier) === 'free' &&
                      styles.devTierLabelActive,
                  ]}
                >
                  Free
                </Text>
                <Switch
                  value={(devTierOverride ?? tier) === 'plus'}
                  onValueChange={(v) =>
                    setDevTierOverride(v ? 'plus' : 'free')
                  }
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
                <Text
                  style={[
                    styles.devTierLabel,
                    (devTierOverride ?? tier) === 'plus' &&
                      styles.devTierLabelActive,
                  ]}
                >
                  Plus
                </Text>
              </View>
            </View>
            {devTierOverride && (
              <TouchableOpacity
                style={[styles.menuRow, styles.menuRowNonInteractive]}
                onPress={() => setDevTierOverride(null)}
                activeOpacity={0.7}
              >
                <Text style={[styles.menuRowLabel, { color: colors.warning, fontSize: 13 }]}>
                  Reset to actual tier ({tier === devTierOverride ? 'same' : tier})
                </Text>
              </TouchableOpacity>
            )}
            <View style={[styles.menuRow, styles.menuRowNonInteractive]}>
              <Text style={styles.menuRowLabel}>AI Sessions</Text>
              <Text style={styles.menuRowDetail}>
                {aiSessionsUsed}
                {aiSessionsLimit != null ? ` / ${aiSessionsLimit}` : ' (unlimited)'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowLast]}
              onPress={handleResetAISessions}
              activeOpacity={0.8}
              disabled={resettingAI}
            >
              {resettingAI ? (
                <ActivityIndicator size="small" color={colors.warning} />
              ) : (
                <Text style={[styles.menuRowLabel, { color: colors.warning }]}>
                  Reset AI Sessions
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── App version ──────────────────────────────────── */}
      <View style={styles.versionContainer}>
        <Text style={styles.versionText}>
          Setpoint AI v{Constants.expoConfig?.version ?? '1.1'}
        </Text>
        {Constants.expoConfig?.extra?.isDev && (
          <Text style={styles.devBadge}>DEV</Text>
        )}
      </View>

      {/* ── Feedback Modal ───────────────────────────────── */}
      <Modal
        visible={showFeedback}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFeedback(false)}
      >
        <View style={styles.feedbackModal}>
          <View style={styles.feedbackHeader}>
            <TouchableOpacity onPress={() => setShowFeedback(false)}>
              <Text style={styles.feedbackCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.feedbackHeaderTitle}>Send Feedback</Text>
            <TouchableOpacity
              onPress={handleSendFeedback}
              disabled={!feedbackText.trim() || sendingFeedback}
            >
              <Text
                style={[
                  styles.feedbackSend,
                  (!feedbackText.trim() || sendingFeedback) &&
                    styles.feedbackSendDisabled,
                ]}
              >
                {sendingFeedback ? 'Sending…' : 'Send'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.feedbackBody}>
            <Text style={styles.feedbackPrompt}>
              What's on your mind? Bug reports, feature requests, or anything
              else — we'd love to hear from you.
            </Text>
            <TextInput
              style={styles.feedbackInput}
              value={feedbackText}
              onChangeText={setFeedbackText}
              placeholder="Type your feedback…"
              placeholderTextColor={colors.textTertiary}
              multiline
              textAlignVertical="top"
              autoFocus
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg, paddingBottom: spacing.xl * 3 },

  // Section group titles (iOS-style)
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },

  // Grouped menu card
  menuGroup: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  menuRowFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  menuRowLast: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  menuRowNonInteractive: {},
  menuRowLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
    flexShrink: 1,
  },
  menuRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
    flexShrink: 0,
  },
  menuRowDetail: {
    fontSize: 13,
    color: colors.textTertiary,
    marginRight: spacing.xs,
  },
  menuRowChevron: {
    fontSize: 18,
    color: colors.textTertiary,
    fontWeight: '600',
  },

  // Dev tools
  devTierToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  devTierLabel: {
    fontSize: 13,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  devTierLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // Version footer
  versionContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xl,
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

  // Feedback modal
  feedbackModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  feedbackHeaderTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  feedbackCancel: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  feedbackSend: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  feedbackSendDisabled: {
    color: colors.textTertiary,
  },
  feedbackBody: {
    padding: spacing.lg,
    flex: 1,
  },
  feedbackPrompt: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  feedbackInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 160,
    flex: 1,
  },
});
