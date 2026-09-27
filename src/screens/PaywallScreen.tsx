import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '../contexts/SubscriptionContext';
import { colors, spacing } from '../theme';

const FEATURES_FREE = [
  'Workout logging',
  'Basic workout history',
  '10 AI coaching sessions / month',
];

const FEATURES_PLUS = [
  'Unlimited AI coaching',
  'Voice conversations',
  'Deeper performance analysis',
  'Personalized programming',
  'Long-term progression analysis',
  'Priority support',
];

export default function PaywallScreen({
  navigation,
}: {
  navigation: any;
}) {
  const insets = useSafeAreaInsets();
  const {
    tier,
    isTrialing,
    aiSessionsUsed,
    aiSessionsLimit,
    purchaseWithApple,
    purchaseOnWeb,
    restorePurchases,
  } = useSubscription();

  const [loading, setLoading] = useState<
    'apple' | 'web' | 'restore' | null
  >(null);

  const handleApplePurchase = async () => {
    setLoading('apple');
    const { error } = await purchaseWithApple();
    setLoading(null);
    if (error) {
      Alert.alert('Purchase Failed', error.message);
    } else {
      navigation.goBack();
    }
  };

  const handleWebPurchase = async () => {
    setLoading('web');
    const { error } = await purchaseOnWeb();
    setLoading(null);
    if (error) {
      Alert.alert('Error', error.message);
    }
    // Don't navigate back — user is going to the browser
  };

  const handleRestore = async () => {
    setLoading('restore');
    const { error } = await restorePurchases();
    setLoading(null);
    if (error) {
      Alert.alert('Restore', error.message);
    } else {
      Alert.alert('Restored', 'Your Setpoint+ subscription has been restored.');
      navigation.goBack();
    }
  };

  // If already subscribed, show a confirmation instead
  if (tier === 'plus' && !isTrialing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Text style={styles.activeTitle}>You're on Setpoint+</Text>
          <Text style={styles.activeSubtitle}>
            You have unlimited AI coaching and all premium features.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl * 2 },
      ]}
    >
      {/* Header */}
      <Text style={styles.header}>Setpoint+</Text>
      <Text style={styles.price}>$9.99 / month</Text>
      <Text style={styles.trialNote}>Start with a 7-day free trial</Text>

      {/* Usage context */}
      {aiSessionsLimit != null && (
        <View style={styles.usageCard}>
          <Text style={styles.usageText}>
            AI sessions used: {aiSessionsUsed} / {aiSessionsLimit}
          </Text>
          <View style={styles.usageBar}>
            <View
              style={[
                styles.usageBarFill,
                {
                  width: `${Math.min(
                    (aiSessionsUsed / aiSessionsLimit) * 100,
                    100,
                  )}%`,
                },
                aiSessionsUsed >= aiSessionsLimit && styles.usageBarFull,
              ]}
            />
          </View>
          {aiSessionsUsed >= aiSessionsLimit && (
            <Text style={styles.usageLimitText}>
              Monthly limit reached. Upgrade for unlimited AI.
            </Text>
          )}
        </View>
      )}

      {/* Feature comparison */}
      <View style={styles.comparisonContainer}>
        <View style={styles.tierColumn}>
          <Text style={styles.tierLabel}>Free</Text>
          {FEATURES_FREE.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.checkFree}>{'  \u2713'}</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.tierColumn, styles.tierColumnPlus]}>
          <Text style={styles.tierLabelPlus}>Setpoint+</Text>
          {FEATURES_FREE.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.checkPlus}>{'\u2713'}</Text>
              <Text style={styles.featureTextPlus}>{f.replace('10 AI coaching sessions / month', 'Unlimited AI coaching')}</Text>
            </View>
          ))}
          {FEATURES_PLUS.filter(f => f !== 'Unlimited AI coaching').map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.checkPlus}>{'\u2713'}</Text>
              <Text style={styles.featureTextPlus}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Purchase buttons */}
      <View style={styles.purchaseButtons}>
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.appleButton, loading === 'apple' && styles.buttonDisabled]}
            onPress={handleApplePurchase}
            disabled={loading != null}
            activeOpacity={0.8}
          >
            {loading === 'apple' ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.appleButtonText}>
                Upgrade with Apple
              </Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.webButton, loading === 'web' && styles.buttonDisabled]}
          onPress={handleWebPurchase}
          disabled={loading != null}
          activeOpacity={0.8}
        >
          {loading === 'web' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.webButtonText}>
              Purchase on the Web
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Restore + terms */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleRestore}
          disabled={loading != null}
          activeOpacity={0.6}
        >
          <Text style={styles.restoreText}>
            {loading === 'restore' ? 'Restoring…' : 'Restore Purchases'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.termsText}>
          Payment will be charged to your Apple ID or payment method at
          confirmation of purchase. Subscription automatically renews unless
          canceled at least 24 hours before the end of the current period.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },

  // Header
  header: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  price: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  trialNote: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },

  // Usage card
  usageCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  usageText: {
    fontSize: 14,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  usageBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  usageBarFull: {
    backgroundColor: colors.error,
  },
  usageLimitText: {
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.xs,
  },

  // Feature comparison
  comparisonContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  tierColumn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  tierColumnPlus: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  tierLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  tierLabelPlus: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  checkFree: {
    fontSize: 13,
    color: colors.textTertiary,
    marginRight: spacing.xs,
    width: 18,
  },
  checkPlus: {
    fontSize: 13,
    color: colors.primary,
    marginRight: spacing.xs,
    width: 18,
  },
  featureText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  featureTextPlus: {
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },

  // Purchase buttons
  purchaseButtons: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  appleButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  webButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
  },
  webButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Footer
  footer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  restoreText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  termsText: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },

  // Active state
  activeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  activeSubtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl * 2,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
