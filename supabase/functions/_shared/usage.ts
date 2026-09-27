import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const FREE_TIER_SESSION_LIMIT = 10;
const GPT4O_INPUT_COST_PER_M = 250;   // $2.50 per 1M input tokens, in cents
const GPT4O_OUTPUT_COST_PER_M = 1000;  // $10.00 per 1M output tokens, in cents

export type UsageCheckResult = {
  allowed: boolean;
  tier: string;
  sessionsUsed: number;
  sessionLimit: number | null;  // null = unlimited
  monthlyCostCents: number;
  costLimitCents: number;
  reason?: string;
  code?: string;
};

/**
 * Check whether a user is allowed to make an AI request.
 * Checks both session limits (free tier) and hard cost cap (all tiers).
 */
export async function checkUsageAllowance(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<UsageCheckResult> {
  // Get effective tier
  const { data: tierData } = await serviceClient.rpc("get_user_tier", {
    p_user_id: userId,
  });
  const tier: string = tierData ?? "free";

  // Get monthly cost
  const { data: costData } = await serviceClient.rpc(
    "get_user_monthly_ai_cost",
    { p_user_id: userId },
  );
  const monthlyCostCents = parseFloat(costData ?? "0");

  // Get profile for session count + cost limit
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("ai_sessions_this_month, ai_sessions_reset_at, monthly_cost_limit_cents")
    .eq("id", userId)
    .single();

  let sessionsUsed = profile?.ai_sessions_this_month ?? 0;
  const costLimitCents = profile?.monthly_cost_limit_cents ?? 5000;

  // Reset session counter if new month
  const resetAt = profile?.ai_sessions_reset_at
    ? new Date(profile.ai_sessions_reset_at)
    : new Date(0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  if (resetAt < monthStart) {
    sessionsUsed = 0;
    await serviceClient
      .from("profiles")
      .update({
        ai_sessions_this_month: 0,
        ai_sessions_reset_at: monthStart.toISOString(),
      })
      .eq("id", userId);
  }

  // Hard cost cap — applies to ALL tiers
  if (monthlyCostCents >= costLimitCents) {
    return {
      allowed: false,
      tier,
      sessionsUsed,
      sessionLimit: tier === "free" ? FREE_TIER_SESSION_LIMIT : null,
      monthlyCostCents,
      costLimitCents,
      reason: "Monthly cost safety limit reached. Please try again next month.",
      code: "COST_LIMIT_REACHED",
    };
  }

  // Free tier session limit
  if (tier === "free" && sessionsUsed >= FREE_TIER_SESSION_LIMIT) {
    return {
      allowed: false,
      tier,
      sessionsUsed,
      sessionLimit: FREE_TIER_SESSION_LIMIT,
      monthlyCostCents,
      costLimitCents,
      reason: `You've used all ${FREE_TIER_SESSION_LIMIT} free AI sessions this month. Upgrade to Setpoint+ for unlimited AI coaching.`,
      code: "AI_LIMIT_REACHED",
    };
  }

  return {
    allowed: true,
    tier,
    sessionsUsed,
    sessionLimit: tier === "free" ? FREE_TIER_SESSION_LIMIT : null,
    monthlyCostCents,
    costLimitCents,
  };
}

/**
 * Log an AI API call and increment the user's session counter.
 */
export async function logUsage(
  serviceClient: SupabaseClient,
  userId: string,
  functionName: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): Promise<{ estimatedCostCents: number }> {
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

  const estimatedCostCents =
    (promptTokens / 1_000_000) * GPT4O_INPUT_COST_PER_M +
    (completionTokens / 1_000_000) * GPT4O_OUTPUT_COST_PER_M;

  // Insert usage log
  await serviceClient.from("ai_usage_log").insert({
    user_id: userId,
    function_name: functionName,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated_cost_cents: estimatedCostCents,
  });

  // Increment session counter
  await serviceClient.rpc("increment_ai_sessions", { p_user_id: userId });

  return { estimatedCostCents };
}
