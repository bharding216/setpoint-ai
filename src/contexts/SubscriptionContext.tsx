import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Platform, Alert, Linking } from 'react-native';
import Purchases, {
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
} from 'react-native-purchases';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import {
  Subscription,
  SubscriptionTier,
  FREE_TIER_AI_SESSIONS,
} from '../types/database';

const REVENUE_CAT_KEY =
  process.env.EXPO_PUBLIC_REVENUE_CAT_PUBLIC_KEY ?? '';

type SubscriptionContextType = {
  subscription: Subscription | null;
  tier: SubscriptionTier;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  aiSessionsUsed: number;
  aiSessionsLimit: number | null;
  loading: boolean;
  purchaseWithApple: () => Promise<{ error: Error | null }>;
  purchaseOnWeb: () => Promise<{ error: Error | null }>;
  restorePurchases: () => Promise<{ error: Error | null }>;
  refreshSubscription: () => Promise<void>;
  manageSubscription: () => void;
};

const SubscriptionContext = createContext<
  SubscriptionContextType | undefined
>(undefined);

export function SubscriptionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [aiSessionsUsed, setAiSessionsUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rcInitialized, setRcInitialized] = useState(false);

  // ─── Initialize RevenueCat ────────────────────────────────

  useEffect(() => {
    if (!REVENUE_CAT_KEY || rcInitialized) return;

    const initRC = async () => {
      try {
        if (__DEV__) {
          Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        }
        Purchases.configure({
          apiKey: REVENUE_CAT_KEY,
        });
        setRcInitialized(true);
      } catch (err) {
        console.warn('RevenueCat init failed:', err);
      }
    };

    initRC();
  }, [rcInitialized]);

  // ─── Identify user in RevenueCat when authenticated ──────

  useEffect(() => {
    if (!user || !rcInitialized) return;

    Purchases.logIn(user.id).catch((err) => {
      console.warn('RevenueCat logIn failed:', err);
    });

    return () => {
      Purchases.logOut().catch(() => {});
    };
  }, [user?.id, rcInitialized]);

  // ─── Load subscription from Supabase ─────────────────────

  const refreshSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setAiSessionsUsed(0);
      setLoading(false);
      return;
    }

    const [{ data: sub }, { data: profile }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('profiles')
        .select('ai_sessions_this_month')
        .eq('id', user.id)
        .single(),
    ]);

    setSubscription(sub);
    setAiSessionsUsed(profile?.ai_sessions_this_month ?? 0);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  // ─── Derived state ────────────────────────────────────────

  const effectiveTier = getEffectiveTier(subscription);
  const isTrialing =
    subscription?.status === 'trialing' &&
    subscription?.trial_ends_at != null &&
    new Date(subscription.trial_ends_at) > new Date();

  const trialEndsAt = subscription?.trial_ends_at
    ? new Date(subscription.trial_ends_at)
    : null;

  const aiSessionsLimit =
    effectiveTier === 'free' ? FREE_TIER_AI_SESSIONS : null;

  // ─── Purchase via Apple IAP (RevenueCat) ──────────────────

  const purchaseWithApple = async (): Promise<{ error: Error | null }> => {
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages?.[0];

      if (!pkg) {
        return {
          error: new Error(
            'No subscription packages available. Please try again later.',
          ),
        };
      }

      const { customerInfo } = await Purchases.purchasePackage(pkg);

      // Check if the purchase activated the entitlement
      if (customerInfo.entitlements.active['setpoint_plus']) {
        // Webhook will sync to Supabase, but refresh optimistically
        await refreshSubscription();
        return { error: null };
      }

      return { error: null };
    } catch (err: any) {
      if (err.userCancelled) {
        return { error: null }; // User canceled — not an error
      }
      return { error: err };
    }
  };

  // ─── Purchase via Stripe (web) ────────────────────────────

  const purchaseOnWeb = async (): Promise<{ error: Error | null }> => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'create-checkout-session',
        {
          body: {
            // You'll set this to your actual Stripe price ID
            priceId: process.env.EXPO_PUBLIC_STRIPE_PRICE_ID ?? '',
          },
        },
      );

      if (error) throw error;

      if (data?.error) {
        return { error: new Error(data.error) };
      }

      if (data?.url) {
        await Linking.openURL(data.url);
        return { error: null };
      }

      return { error: new Error('No checkout URL returned') };
    } catch (err: any) {
      return { error: err };
    }
  };

  // ─── Restore purchases ───────────────────────────────────

  const restorePurchases = async (): Promise<{ error: Error | null }> => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active['setpoint_plus']) {
        await refreshSubscription();
        return { error: null };
      }
      return {
        error: new Error('No active Setpoint+ subscription found.'),
      };
    } catch (err: any) {
      return { error: err };
    }
  };

  // ─── Manage subscription (open system settings) ──────────

  const manageSubscription = () => {
    if (subscription?.provider === 'apple') {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    } else if (subscription?.provider === 'stripe') {
      // Could open a Stripe customer portal URL if you set one up
      Alert.alert(
        'Manage Subscription',
        'Visit setpoint.ai to manage your web subscription.',
      );
    } else {
      Linking.openURL('https://apps.apple.com/account/subscriptions');
    }
  };

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        tier: effectiveTier,
        isTrialing,
        trialEndsAt,
        aiSessionsUsed,
        aiSessionsLimit,
        loading,
        purchaseWithApple,
        purchaseOnWeb,
        restorePurchases,
        refreshSubscription,
        manageSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error(
      'useSubscription must be used within a SubscriptionProvider',
    );
  }
  return context;
}

function getEffectiveTier(sub: Subscription | null): SubscriptionTier {
  if (!sub) return 'free';

  if (sub.tier === 'plus' && sub.status === 'active') return 'plus';

  if (
    sub.status === 'trialing' &&
    sub.trial_ends_at &&
    new Date(sub.trial_ends_at) > new Date()
  ) {
    return 'plus';
  }

  // Canceled but still in paid period
  if (
    sub.status === 'canceled' &&
    sub.current_period_end &&
    new Date(sub.current_period_end) > new Date()
  ) {
    return 'plus';
  }

  return 'free';
}
