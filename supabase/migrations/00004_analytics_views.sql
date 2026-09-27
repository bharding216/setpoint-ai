-- Setpoint AI — Analytics Views and Functions
-- Business metrics for tracking AI cost efficiency, conversion, and margins.
--
-- All views use SECURITY DEFINER so they can only be queried by service role
-- (admin dashboard / SQL editor), not by authenticated app users.

-- ============================================================
-- 1. AI Cost Per User Per Month
-- ============================================================

CREATE OR REPLACE VIEW public.v_ai_cost_per_user_month AS
SELECT
  u.user_id,
  date_trunc('month', u.created_at) AS month,
  COUNT(*)                           AS ai_requests,
  SUM(u.prompt_tokens)               AS total_prompt_tokens,
  SUM(u.completion_tokens)           AS total_completion_tokens,
  SUM(u.total_tokens)                AS total_tokens,
  SUM(u.estimated_cost_cents)        AS total_cost_cents,
  ROUND(AVG(u.total_tokens), 0)      AS avg_tokens_per_request,
  ROUND(AVG(u.estimated_cost_cents), 4) AS avg_cost_per_request_cents
FROM public.ai_usage_log u
GROUP BY u.user_id, date_trunc('month', u.created_at);

-- ============================================================
-- 2. Monthly Aggregate Metrics (platform-wide)
-- ============================================================

CREATE OR REPLACE VIEW public.v_monthly_platform_metrics AS
SELECT
  date_trunc('month', u.created_at)  AS month,
  COUNT(DISTINCT u.user_id)          AS active_ai_users,
  COUNT(*)                           AS total_ai_requests,
  SUM(u.total_tokens)                AS total_tokens,
  SUM(u.estimated_cost_cents)        AS total_cost_cents,
  ROUND(AVG(u.total_tokens), 0)      AS avg_tokens_per_request,
  ROUND(AVG(u.estimated_cost_cents), 4) AS avg_cost_per_request_cents,
  ROUND(
    SUM(u.estimated_cost_cents) / NULLIF(COUNT(DISTINCT u.user_id), 0), 2
  )                                  AS cost_per_active_user_cents
FROM public.ai_usage_log u
GROUP BY date_trunc('month', u.created_at);

-- ============================================================
-- 3. Free vs Paid User AI Cost Breakdown
-- ============================================================

CREATE OR REPLACE VIEW public.v_ai_cost_by_tier AS
SELECT
  date_trunc('month', u.created_at)  AS month,
  COALESCE(s.tier, 'free')           AS tier,
  COUNT(DISTINCT u.user_id)          AS users,
  COUNT(*)                           AS ai_requests,
  SUM(u.estimated_cost_cents)        AS total_cost_cents,
  ROUND(AVG(u.estimated_cost_cents), 4) AS avg_cost_per_request_cents,
  ROUND(
    SUM(u.estimated_cost_cents) / NULLIF(COUNT(DISTINCT u.user_id), 0), 2
  )                                  AS cost_per_user_cents
FROM public.ai_usage_log u
LEFT JOIN public.subscriptions s ON s.user_id = u.user_id
GROUP BY date_trunc('month', u.created_at), COALESCE(s.tier, 'free');

-- ============================================================
-- 4. Cost by AI Function
-- ============================================================

CREATE OR REPLACE VIEW public.v_ai_cost_by_function AS
SELECT
  date_trunc('month', u.created_at)  AS month,
  u.function_name,
  COUNT(*)                           AS requests,
  SUM(u.total_tokens)                AS total_tokens,
  SUM(u.estimated_cost_cents)        AS total_cost_cents,
  ROUND(AVG(u.prompt_tokens), 0)     AS avg_prompt_tokens,
  ROUND(AVG(u.completion_tokens), 0) AS avg_completion_tokens,
  ROUND(AVG(u.estimated_cost_cents), 4) AS avg_cost_cents
FROM public.ai_usage_log u
GROUP BY date_trunc('month', u.created_at), u.function_name;

-- ============================================================
-- 5. Subscription Conversion and Revenue
-- ============================================================

CREATE OR REPLACE VIEW public.v_subscription_metrics AS
SELECT
  date_trunc('month', s.created_at)  AS cohort_month,
  COUNT(*)                           AS total_users,
  COUNT(*) FILTER (WHERE s.tier = 'plus' AND s.status IN ('active', 'trialing'))
                                     AS plus_users,
  COUNT(*) FILTER (WHERE s.tier = 'free' OR s.status IN ('expired', 'canceled'))
                                     AS free_users,
  COUNT(*) FILTER (WHERE s.status = 'trialing')
                                     AS trialing_users,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE s.tier = 'plus' AND s.status = 'active')
    / NULLIF(COUNT(*), 0), 1
  )                                  AS conversion_rate_pct,
  COUNT(*) FILTER (WHERE s.provider = 'apple')
                                     AS apple_subscribers,
  COUNT(*) FILTER (WHERE s.provider = 'stripe')
                                     AS stripe_subscribers
FROM public.subscriptions s
GROUP BY date_trunc('month', s.created_at);

-- ============================================================
-- 6. Gross Margin Estimate
--    Revenue = $9.99/month per active plus subscriber
--    Cost = AI usage cost from ai_usage_log
-- ============================================================

CREATE OR REPLACE VIEW public.v_gross_margin AS
WITH monthly_revenue AS (
  SELECT
    date_trunc('month', now()) AS month,
    COUNT(*) FILTER (
      WHERE tier = 'plus'
        AND status IN ('active')
    ) * 999 AS revenue_cents  -- $9.99 * 100
  FROM public.subscriptions
),
monthly_cost AS (
  SELECT
    date_trunc('month', now()) AS month,
    COALESCE(SUM(estimated_cost_cents), 0) AS cost_cents
  FROM public.ai_usage_log
  WHERE created_at >= date_trunc('month', now())
)
SELECT
  r.month,
  r.revenue_cents,
  c.cost_cents       AS ai_cost_cents,
  r.revenue_cents - c.cost_cents AS gross_profit_cents,
  CASE
    WHEN r.revenue_cents > 0
    THEN ROUND(100.0 * (r.revenue_cents - c.cost_cents) / r.revenue_cents, 1)
    ELSE 0
  END AS gross_margin_pct
FROM monthly_revenue r
JOIN monthly_cost c ON r.month = c.month;

-- ============================================================
-- 7. User Lifetime AI Cost (for identifying expensive users)
-- ============================================================

CREATE OR REPLACE VIEW public.v_user_lifetime_ai_cost AS
SELECT
  u.user_id,
  p.display_name,
  COALESCE(s.tier, 'free')          AS current_tier,
  s.status                          AS subscription_status,
  COUNT(*)                          AS total_ai_requests,
  SUM(u.total_tokens)               AS total_tokens,
  SUM(u.estimated_cost_cents)       AS total_cost_cents,
  MIN(u.created_at)                 AS first_ai_use,
  MAX(u.created_at)                 AS last_ai_use,
  ROUND(AVG(u.estimated_cost_cents), 4) AS avg_cost_per_request_cents
FROM public.ai_usage_log u
LEFT JOIN public.profiles p ON p.id = u.user_id
LEFT JOIN public.subscriptions s ON s.user_id = u.user_id
GROUP BY u.user_id, p.display_name, s.tier, s.status
ORDER BY SUM(u.estimated_cost_cents) DESC;

-- ============================================================
-- 8. Callable function: dashboard summary (current month)
--    Returns a single JSON row with all key metrics.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  month_start TIMESTAMPTZ := date_trunc('month', now());
BEGIN
  SELECT jsonb_build_object(
    -- User counts
    'total_users', (SELECT COUNT(*) FROM public.profiles),
    'plus_subscribers', (
      SELECT COUNT(*) FROM public.subscriptions
      WHERE tier = 'plus' AND status IN ('active', 'trialing')
    ),
    'free_users', (
      SELECT COUNT(*) FROM public.subscriptions
      WHERE tier = 'free' OR status IN ('expired', 'canceled')
    ),
    'trialing_users', (
      SELECT COUNT(*) FROM public.subscriptions
      WHERE status = 'trialing' AND trial_ends_at > now()
    ),

    -- Conversion
    'conversion_rate_pct', (
      SELECT ROUND(
        100.0 * COUNT(*) FILTER (WHERE tier = 'plus' AND status = 'active')
        / NULLIF(COUNT(*), 0), 1
      )
      FROM public.subscriptions
    ),

    -- AI usage this month
    'ai_requests_this_month', (
      SELECT COUNT(*) FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'ai_active_users_this_month', (
      SELECT COUNT(DISTINCT user_id) FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'ai_total_tokens_this_month', (
      SELECT COALESCE(SUM(total_tokens), 0) FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'ai_total_cost_cents_this_month', (
      SELECT COALESCE(SUM(estimated_cost_cents), 0) FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'ai_avg_cost_per_request_cents', (
      SELECT ROUND(AVG(estimated_cost_cents), 4) FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'ai_cost_per_user_cents', (
      SELECT ROUND(
        COALESCE(SUM(estimated_cost_cents), 0) / NULLIF(COUNT(DISTINCT user_id), 0), 2
      )
      FROM public.ai_usage_log WHERE created_at >= month_start
    ),

    -- Revenue this month (estimate)
    'estimated_revenue_cents', (
      SELECT COUNT(*) FILTER (WHERE tier = 'plus' AND status = 'active') * 999
      FROM public.subscriptions
    ),
    'estimated_ai_cost_cents', (
      SELECT COALESCE(SUM(estimated_cost_cents), 0)
      FROM public.ai_usage_log WHERE created_at >= month_start
    ),
    'estimated_gross_margin_pct', (
      SELECT CASE
        WHEN rev > 0 THEN ROUND(100.0 * (rev - cost) / rev, 1)
        ELSE 0
      END
      FROM (
        SELECT
          (SELECT COUNT(*) FILTER (WHERE tier = 'plus' AND status = 'active') * 999
           FROM public.subscriptions) AS rev,
          (SELECT COALESCE(SUM(estimated_cost_cents), 0)
           FROM public.ai_usage_log WHERE created_at >= month_start) AS cost
      ) t
    ),

    -- Free vs paid cost breakdown
    'free_user_ai_cost_cents', (
      SELECT COALESCE(SUM(u.estimated_cost_cents), 0)
      FROM public.ai_usage_log u
      JOIN public.subscriptions s ON s.user_id = u.user_id
      WHERE u.created_at >= month_start
        AND (s.tier = 'free' OR s.status IN ('expired', 'canceled'))
    ),
    'paid_user_ai_cost_cents', (
      SELECT COALESCE(SUM(u.estimated_cost_cents), 0)
      FROM public.ai_usage_log u
      JOIN public.subscriptions s ON s.user_id = u.user_id
      WHERE u.created_at >= month_start
        AND s.tier = 'plus' AND s.status IN ('active', 'trialing')
    ),

    -- Avg conversation length (tokens)
    'avg_conversation_tokens', (
      SELECT ROUND(AVG(total_tokens), 0) FROM public.ai_usage_log WHERE created_at >= month_start
    ),

    -- Generated at
    'generated_at', now()
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
