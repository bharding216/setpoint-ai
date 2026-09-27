-- Setpoint AI — Subscriptions, AI Usage Tracking, and Compact AI Profiles
-- Supports: free/plus tiers, per-request cost logging, $50 hard cap, compact AI context

-- ============================================================
-- Subscriptions
-- ============================================================

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'plus')),
  status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'canceled', 'expired', 'past_due')),
  provider TEXT
    CHECK (provider IN ('apple', 'stripe', 'manual')),
  provider_subscription_id TEXT,
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_provider_id ON public.subscriptions(provider_subscription_id);

-- ============================================================
-- AI Usage Log — one row per AI API call
-- ============================================================

CREATE TABLE public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  estimated_cost_cents NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_user_created ON public.ai_usage_log(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_created ON public.ai_usage_log(created_at DESC);

-- ============================================================
-- Compact AI Profiles — maintained by backend, not user-editable
-- ============================================================

CREATE TABLE public.user_ai_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_data JSONB NOT NULL DEFAULT '{}',
  last_rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX idx_user_ai_profiles_user ON public.user_ai_profiles(user_id);

-- ============================================================
-- Extend profiles with usage tracking columns
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN ai_sessions_this_month INT NOT NULL DEFAULT 0,
  ADD COLUMN ai_sessions_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  ADD COLUMN monthly_cost_limit_cents INT NOT NULL DEFAULT 5000;

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_profiles ENABLE ROW LEVEL SECURITY;

-- Subscriptions: users can read own; service role manages writes
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- AI usage log: users can read own; service role inserts
CREATE POLICY "Users can view own AI usage"
  ON public.ai_usage_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages AI usage"
  ON public.ai_usage_log FOR ALL
  USING (auth.role() = 'service_role');

-- AI profiles: users can read own; service role manages
CREATE POLICY "Users can view own AI profile"
  ON public.user_ai_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages AI profiles"
  ON public.user_ai_profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- Auto-create subscription row for new users (free tier, 7-day trial)
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, status, trial_started_at, trial_ends_at)
  VALUES (
    NEW.id,
    'plus',
    'trialing',
    now(),
    now() + INTERVAL '7 days'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_user_ai_profiles_updated_at
  BEFORE UPDATE ON public.user_ai_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- Grants — allow authenticated role to read these tables
-- (Writes happen via service role in Edge Functions)
-- ============================================================

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT SELECT ON public.user_ai_profiles TO authenticated;

-- Profiles already had grants; ensure new columns are accessible
-- (ALTER TABLE doesn't need new grants for existing table grants)

-- ============================================================
-- Helper: atomically increment AI session counter
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_ai_sessions(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET ai_sessions_this_month = ai_sessions_this_month + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Helper: get a user's current month AI cost in cents
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_monthly_ai_cost(p_user_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(estimated_cost_cents), 0)
  FROM public.ai_usage_log
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('month', now());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- Helper: get a user's effective subscription tier
-- Accounts for trial expiration
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  sub RECORD;
BEGIN
  SELECT * INTO sub FROM public.subscriptions WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  -- Active paid subscription
  IF sub.status = 'active' AND sub.tier = 'plus' THEN
    RETURN 'plus';
  END IF;

  -- Trialing and trial hasn't expired
  IF sub.status = 'trialing' AND sub.trial_ends_at > now() THEN
    RETURN 'plus';
  END IF;

  -- Everything else is free
  RETURN 'free';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
