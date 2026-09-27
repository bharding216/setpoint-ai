// Supabase Edge Function — webhook-revenuecat
// Handles RevenueCat webhook events to sync Apple IAP subscription state.
//
// Required secrets: SUPABASE_SERVICE_ROLE_KEY, REVENUECAT_WEBHOOK_SECRET
//
// RevenueCat events handled:
//   - INITIAL_PURCHASE
//   - RENEWAL
//   - CANCELLATION
//   - EXPIRATION
//   - BILLING_ISSUE_DETECTED
//   - SUBSCRIBER_ALIAS
//   - PRODUCT_CHANGE

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify authorization — RevenueCat sends a shared secret in the header
    const authHeader = req.headers.get("Authorization");
    if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const event = body.event;

    if (!event) {
      return new Response("No event in payload", { status: 400 });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // RevenueCat sends app_user_id which we set to the Supabase user ID
    const userId = event.app_user_id;
    if (!userId) {
      console.error("No app_user_id in RevenueCat event");
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const eventType: string = event.type;

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE":
        await handleActivePurchase(serviceClient, userId, event);
        break;

      case "CANCELLATION":
        await handleCancellation(serviceClient, userId, event);
        break;

      case "EXPIRATION":
        await handleExpiration(serviceClient, userId);
        break;

      case "BILLING_ISSUE_DETECTED":
        await handleBillingIssue(serviceClient, userId);
        break;

      default:
        console.log(`Unhandled RevenueCat event: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("RevenueCat webhook error:", err);
    return new Response("Webhook handler failed", { status: 500 });
  }
});

// ─── Event handlers ─────────────────────────────────────────

async function handleActivePurchase(
  client: ReturnType<typeof createClient>,
  userId: string,
  event: any,
) {
  const expirationDate = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;
  const purchaseDate = event.purchased_at_ms
    ? new Date(event.purchased_at_ms).toISOString()
    : null;

  // Determine if this is a trial
  const isTrial =
    event.period_type === "TRIAL" || event.period_type === "trial";

  const { error } = await client.from("subscriptions").upsert(
    {
      user_id: userId,
      tier: "plus",
      status: isTrial ? "trialing" : "active",
      provider: "apple",
      provider_subscription_id: event.original_transaction_id ?? event.id,
      trial_started_at: isTrial ? purchaseDate : null,
      trial_ends_at: isTrial ? expirationDate : null,
      current_period_start: purchaseDate,
      current_period_end: expirationDate,
      canceled_at: null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("RevenueCat subscription upsert error:", error);
  }
}

async function handleCancellation(
  client: ReturnType<typeof createClient>,
  userId: string,
  event: any,
) {
  const expirationDate = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  // Cancellation means the user won't renew, but they keep access until period end
  await client
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      current_period_end: expirationDate,
    })
    .eq("user_id", userId);
}

async function handleExpiration(
  client: ReturnType<typeof createClient>,
  userId: string,
) {
  await client
    .from("subscriptions")
    .update({
      tier: "free",
      status: "expired",
    })
    .eq("user_id", userId);
}

async function handleBillingIssue(
  client: ReturnType<typeof createClient>,
  userId: string,
) {
  await client
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("user_id", userId);
}
