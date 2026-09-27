// Supabase Edge Function — create-checkout-session
// Creates a Stripe Checkout session for Setpoint+ web purchase.
//
// Required secrets: STRIPE_SECRET_KEY

import { handleCors, jsonError, jsonOk } from "../_shared/cors.ts";
import { authenticateUser, AuthError } from "../_shared/auth.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";

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
    let customerId: string;

    if (searchData.data?.length > 0) {
      customerId = searchData.data[0].id;
    } else {
      // Create new Stripe customer
      const createResp = await stripeRequest("POST", "/customers", {
        email,
        metadata: { supabase_user_id: user.id },
      });
      const customerData = await createResp.json();
      customerId = customerData.id;
    }

    // Create Checkout session
    // The price ID should be created in Stripe Dashboard for $9.99/month with 7-day trial
    const body = await req.json().catch(() => ({}));
    const priceId = body.priceId;

    if (!priceId) {
      return jsonError(
        "priceId is required. Create a $9.99/month price in Stripe Dashboard and pass its ID.",
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
      success_url: "https://setpoint.ai/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://setpoint.ai/cancel",
      "metadata[supabase_user_id]": user.id,
    });

    const sessionData = await sessionResp.json();

    if (sessionData.error) {
      console.error("Stripe error:", sessionData.error);
      return jsonError("Failed to create checkout session", 502);
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
