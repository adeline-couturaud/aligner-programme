
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (message: unknown, status = 200) =>
  new Response(JSON.stringify(message), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function verifyStripeSignature(raw: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;

  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(timestamp + "." + raw)
  ));
  const expected = [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => {
    if (sig.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const signingSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const priceId = Deno.env.get("STRIPE_PRICE_ID") || "";
  const sbUrl = Deno.env.get("SUPABASE_URL") || "";
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!stripeKey.startsWith("sk_test_") || !signingSecret.startsWith("whsec_") ||
      !priceId.startsWith("price_") || !sbUrl || !sbKey) {
    return json({ error: "Test webhook not configured" }, 503);
  }

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!await verifyStripeSignature(payload, sig, signingSecret)) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  try {
    const event = JSON.parse(payload);
    if (event.livemode !== false) return json({ error: "Live events are disabled" }, 400);
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return json({ received: true });
    }
    const obj = event?.data?.object;
    if (typeof obj?.id !== "string" || !obj.id.startsWith("cs_test_")) {
      return json({ error: "Unexpected checkout session" }, 400);
    }

    // Fetch the actual Checkout Session and line items from Stripe rather than
    // trusting values sent from the browser or session metadata alone.
    const stripeRes = await fetch(
      "https://api.stripe.com/v1/checkout/sessions/" +
      encodeURIComponent(obj.id) + "?expand%5B%5D=line_items",
      { headers: { authorization: "Bearer " + stripeKey } }
    );
    const session = await stripeRes.json();
    if (!stripeRes.ok) throw new Error("Stripe session lookup failed: " + stripeRes.status);
    if (session.id !== obj.id || session.livemode !== false || session.mode !== "payment" ||
        session.payment_status !== "paid" || session.amount_total !== 2700 ||
        session.currency !== "eur" || session.status !== "complete") {
      return json({ received: true, status: "not_applicable" });
    }
    const items = session.line_items?.data;
    if (!Array.isArray(items) || items.length !== 1 ||
        items[0]?.price?.id !== priceId || items[0]?.quantity !== 1 ||
        session.line_items?.has_more === true) {
      return json({ error: "Unexpected checkout price" }, 400);
    }
    const userId = session.client_reference_id;
    if (typeof userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
        session.metadata?.user_id !== userId ||
        session.metadata?.product_code !== "mon-carnet-aligne-dressing") {
      return json({ error: "Invalid checkout user metadata" }, 400);
    }
    const supabase = createClient(sbUrl, sbKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: consent, error: consentError } = await supabase
      .from("checkout_consents")
      .select("user_id,cgv_accepted,immediate_start_requested,withdrawal_information_acknowledged")
      .eq("stripe_checkout_session_id", session.id)
      .maybeSingle();
    if (consentError) throw consentError;
    if (!consent || consent.user_id !== userId || !consent.cgv_accepted ||
        !consent.immediate_start_requested || !consent.withdrawal_information_acknowledged) {
      throw new Error("Missing verified checkout consents");
    }

    // Isolate Stripe test payments from real client access.
    // A test Checkout Session must never activate a production enrollment.
    console.info("Verified Stripe TEST payment; enrollment remains unchanged", {
      stripe_checkout_session_id: session.id,
      user_id: userId,
    });
    return json({ received: true, test_only: true, enrollment_unchanged: true });

    const now = new Date().toISOString();
    const { error: orderError } = await supabase.from("payment_orders").upsert({
      user_id: userId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripe_price_id: priceId,
      total_cents: 2700,
      currency: "eur",
      status: "paid",
      updated_at: now,
    }, { onConflict: "stripe_checkout_session_id" });
    if (orderError) throw orderError;

    const { data: active, error: membershipError } = await supabase
      .from("enrollments").select("status,purchased_at").eq("user_id", userId).maybeSingle();
    if (membershipError) throw membershipError;
    if (active?.status !== "active") {
      const { error: grantError } = await supabase.from("enrollments").upsert({
        user_id: userId, status: "active", purchased_at: now,
      }, { onConflict: "user_id" });
      if (grantError) throw grantError;
    }
    return json({ received: true });
  } catch (e) {
    console.error("Stripe webhook:", e instanceof Error ? e.message : "unknown");
    return json({ error: "Webhook processing failed" }, 500);
  }
});
