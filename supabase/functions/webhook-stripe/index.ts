// Supabase Edge Function — webhook-stripe
// Handles Stripe webhook events to sync subscription state.
//
// Required secrets: STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
//
// Stripe events to register:
//   - checkout.session.completed
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_failed

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";

Deno.serve(async (req: Request) => {
  // Webhooks are POST only — no CORS preflight needed from Stripe,
  // but keep it for manual testing
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    // Verify webhook signature
    const event = await verifyStripeWebhook(body, signature, WEBHOOK_SECRET);
    if (!event) {
      return new Response("Invalid signature", { status: 400 });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(serviceClient, event.data.object);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(serviceClient, event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(serviceClient, event.data.object);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(serviceClient, event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Webhook handler failed", { status: 500 });
  }
});

// ─── Event handlers ─────────────────────────────────────────

async function handleCheckoutCompleted(
  client: ReturnType<typeof createClient>,
  session: any,
) {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) {
    console.error("No supabase_user_id in checkout session metadata");
    return;
  }

  const subscriptionId = session.subscription;
  if (!subscriptionId) return;

  // Fetch the full subscription from Stripe
  const sub = await fetchStripeSubscription(subscriptionId);
  if (!sub) return;

  await upsertSubscription(client, userId, sub);
}

async function handleSubscriptionUpdated(
  client: ReturnType<typeof createClient>,
  subscription: any,
) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) {
    console.error("No supabase_user_id in subscription metadata");
    return;
  }

  await upsertSubscription(client, userId, subscription);
}

async function handleSubscriptionDeleted(
  client: ReturnType<typeof createClient>,
  subscription: any,
) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  await client
    .from("subscriptions")
    .update({
      tier: "free",
      status: "expired",
      canceled_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

async function handlePaymentFailed(
  client: ReturnType<typeof createClient>,
  invoice: any,
) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // Fetch subscription to get user ID
  const sub = await fetchStripeSubscription(subscriptionId);
  if (!sub) return;

  const userId = sub.metadata?.supabase_user_id;
  if (!userId) return;

  await client
    .from("subscriptions")
    .update({ status: "past_due" })
    .eq("user_id", userId);
}

// ─── Helpers ────────────────────────────────────────────────

async function upsertSubscription(
  client: ReturnType<typeof createClient>,
  userId: string,
  sub: any,
) {
  const status = mapStripeStatus(sub.status, sub.trial_end);

  const { error } = await client.from("subscriptions").upsert(
    {
      user_id: userId,
      tier: "plus",
      status,
      provider: "stripe",
      provider_subscription_id: sub.id,
      trial_started_at: sub.trial_start
        ? new Date(sub.trial_start * 1000).toISOString()
        : null,
      trial_ends_at: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      current_period_start: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      canceled_at: sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toISOString()
        : null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("Subscription upsert error:", error);
  }
}

function mapStripeStatus(
  stripeStatus: string,
  trialEnd: number | null,
): string {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    case "incomplete_expired":
      return "expired";
    default:
      return "active";
  }
}

async function fetchStripeSubscription(
  subscriptionId: string,
): Promise<any | null> {
  const resp = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!resp.ok) {
    console.error("Failed to fetch Stripe subscription:", await resp.text());
    return null;
  }
  return resp.json();
}

// ─── Stripe Webhook Signature Verification ──────────────────
// Implements Stripe's v1 signature scheme using Web Crypto API (Deno)

async function verifyStripeWebhook(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<any | null> {
  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [key, value] = part.split("=");
      if (key === "t") acc.timestamp = value;
      if (key === "v1") acc.signatures.push(value);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] },
  );

  if (!parts.timestamp || parts.signatures.length === 0) {
    return null;
  }

  // Check timestamp tolerance (5 minutes)
  const timestampSeconds = parseInt(parts.timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > 300) {
    console.error("Webhook timestamp too old");
    return null;
  }

  // Compute expected signature
  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expectedSig = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Compare (constant-time-ish for hex strings)
  const match = parts.signatures.some((sig) => sig === expectedSig);
  if (!match) {
    return null;
  }

  return JSON.parse(payload);
}
