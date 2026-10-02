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
  PurchasesOfferings,
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

const ENTITLEMENT_ID = 'setpoint_ai_pro';

type SubscriptionContextType = {
  subscription: Subscription | null;
  tier: SubscriptionTier;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  aiSessionsUsed: number;
  aiSessionsLimit: number | null;
  loading: boolean;
  offerings: PurchasesOfferings | null;
  offeringsLoading: boolean;
  purchaseWithApple: (pkg: PurchasesPackage) => Promise<{ error: Error | null }>;
  purchaseOnWeb: (plan?: 'monthly' | 'annual') => Promise<{ error: Error | null }>;
  restorePurchases: () => Promise<{ error: Error | null }>;
  refreshSubscription: () => Promise<void>;
  manageSubscription: () => void;
  devTierOverride: SubscriptionTier | null;
  setDevTierOverride: (tier: SubscriptionTier | null) => void;
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
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [devTierOverride, setDevTierOverride] = useState<SubscriptionTier | null>(null);

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

  // ─── Load RevenueCat offerings ────────────────────────────
  // In dev builds the bundle ID is .dev, but IAP products are registered
  // under the production bundle ID in App Store Connect. StoreKit Config
  // files only work when launched from Xcode, so skip offerings entirely
  // in development to avoid noisy errors. Test IAP via simulator
  // (npx expo run:ios) or use a production/preview build on-device.

  useEffect(() => {
    if (!rcInitialized) return;

    if (__DEV__) {
      setOfferingsLoading(false);
      return;
    }

    const loadOfferings = async () => {
      try {
        setOfferingsLoading(true);
        const off = await Purchases.getOfferings();
        setOfferings(off);
      } catch (err) {
        console.warn('Failed to load offerings:', err);
      } finally {
        setOfferingsLoading(false);
      }
    };

    loadOfferings();
  }, [rcInitialized]);

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

  const baseTier = getEffectiveTier(subscription);
  const effectiveTier = (__DEV__ && devTierOverride) ? devTierOverride : baseTier;
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

  const purchaseWithApple = async (
    pkg: PurchasesPackage,
  ): Promise<{ error: Error | null }> => {
    try {
      console.log('[IAP] Starting purchase for product:', pkg.product.identifier);
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      console.log('[IAP] Purchase completed. Active entitlements:', Object.keys(customerInfo.entitlements.active));

      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        await refreshSubscription();
        return { error: null };
      }

      // Purchase went through but entitlement not active — likely a config mismatch
      console.warn('[IAP] Purchase succeeded but entitlement not found:', ENTITLEMENT_ID);
      return {
        error: new Error(
          `Purchase completed but your subscription wasn't activated. ` +
          `Please tap "Restore Purchases" or contact support.`,
        ),
      };
    } catch (err: any) {
      console.warn('[IAP] Purchase error:', err.code, err.message, JSON.stringify(err));
      if (err.userCancelled) {
        return { error: null };
      }
      return { error: err };
    }
  };

  // ─── Purchase via Stripe (web) ────────────────────────────

  const purchaseOnWeb = async (
    plan: 'monthly' | 'annual' = 'monthly',
  ): Promise<{ error: Error | null }> => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'create-checkout-session',
        {
          body: { plan },
        },
      );

      if (error) {
        // Extract the actual message from the edge function response if available
        const body = error.context
          ? await error.context.json().catch(() => null)
          : null;
        const message =
          body?.error || error.message || 'Failed to start checkout';
        return { error: new Error(message) };
      }

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
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
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
        offerings,
        offeringsLoading,
        purchaseWithApple,
        purchaseOnWeb,
        restorePurchases,
        refreshSubscription,
        manageSubscription,
        devTierOverride,
        setDevTierOverride,
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
