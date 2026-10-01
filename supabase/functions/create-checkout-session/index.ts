// Supabase Edge Function — create-checkout-session
// Creates a Stripe Checkout session for Setpoint+ web purchase.
//
// Required secrets: STRIPE_SECRET_KEY

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const REDIRECT_BASE = `${SUPABASE_URL}/functions/v1/stripe-redirect`;

// Stripe price IDs — managed server-side so app updates aren't needed to change pricing
const STRIPE_PRICES: Record<string, string> = {
  monthly: Deno.env.get("STRIPE_PRICE_MONTHLY") ?? "price_1UJgQVEl9L4ZwAwOy7f80SAy",
  annual: Deno.env.get("STRIPE_PRICE_ANNUAL") ?? "price_1ULmd3El9L4ZwAwOYPHzybVJ",
};

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { user, serviceClient } = await authenticateUser(req);

    // Check if user already has an active subscription
    const { data: existing } = await serviceClient
      .from("subscriptions")
      .select("tier, status, provider_subscription_id")
      .eq("user_id", user.id)
      .single();

    if (
      existing &&
      existing.tier === "plus" &&
      (existing.status === "active" || existing.status === "trialing")
    ) {
      return jsonError("You already have an active Setpoint+ subscription.", 400);
    }

    // Look up or create Stripe customer by email
    const email = user.email ?? "";

    // Search for existing Stripe customer
    const searchResp = await stripeRequest(
      "GET",
      `/customers/search?query=email:'${encodeURIComponent(email)}'`,
    );
    const searchData = await searchResp.json();

    if (searchData.error) {
      console.error("Stripe customer search error:", JSON.stringify(searchData.error));
      return jsonError(
        searchData.error?.message ?? "Failed to look up billing account",
        502,
      );
    }

    let customerId: string;

    if (searchData.data?.length > 0) {
      customerId = searchData.data[0].id;
    } else {
      // Create new Stripe customer
      const createResp = await stripeRequest("POST", "/customers", {
        email,
        "metadata[supabase_user_id]": user.id,
      });
      const customerData = await createResp.json();

      if (customerData.error) {
        console.error("Stripe customer create error:", JSON.stringify(customerData.error));
        return jsonError(
          customerData.error?.message ?? "Failed to create billing account",
          502,
        );
      }

      customerId = customerData.id;
    }

    // Create Checkout session
    const body = await req.json().catch(() => ({}));

    // Accept either a plan name ("monthly" | "annual") or a legacy priceId
    const plan: string = body.plan ?? "";
    const priceId = STRIPE_PRICES[plan] ?? body.priceId ?? "";

    if (!priceId) {
      return jsonError(
        'plan is required. Pass { plan: "monthly" } or { plan: "annual" }.',
        400,
      );
    }

    const sessionResp = await stripeRequest("POST", "/checkout/sessions", {
      customer: customerId,
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[trial_period_days]": "7",
      "subscription_data[metadata][supabase_user_id]": user.id,
      success_url: `${REDIRECT_BASE}?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${REDIRECT_BASE}?status=cancel`,
      "metadata[supabase_user_id]": user.id,
    });

    const sessionData = await sessionResp.json();

    if (sessionData.error) {
      console.error("Stripe error:", JSON.stringify(sessionData.error));
      return jsonError(
        sessionData.error?.message ?? "Failed to create checkout session",
        502,
      );
    }

    return jsonOk({ url: sessionData.url, sessionId: sessionData.id });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error("Edge function error:", err);
    return jsonError("Internal server error", 500);
  }
});

async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, string>,
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) {
    opts.body = new URLSearchParams(body).toString();
  }
  return fetch(`${STRIPE_API}${path}`, opts);
}
