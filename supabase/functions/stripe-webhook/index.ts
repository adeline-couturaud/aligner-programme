
import { createClient } from "npm:@supabase/supabase-js@2";

const LAUNCH_AMOUNT_CENTS = 3700;
// À changer uniquement lors de l’ouverture explicitement validée des ventes.
const LIVE_RELEASE_APPROVED = false;

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
  const payload = await req.text();
  let event;
  try { event = JSON.parse(payload); } catch { return json({ error: "Invalid event" }, 400); }
  if (typeof event?.livemode !== "boolean") return json({ error: "Invalid event mode" }, 400);
  const isLive = event.livemode;
  if (isLive && (!LIVE_RELEASE_APPROVED || Deno.env.get("CARNET_LIVE_SALES_ENABLED") !== "true")) {
    return json({ error: "Live payments are not enabled" }, 503);
  }
  const stripeKey = Deno.env.get(isLive ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_SECRET_KEY") || "";
  const signingSecret = Deno.env.get(isLive ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_WEBHOOK_SECRET") || "";
  const priceId = isLive ? (Deno.env.get("STRIPE_LIVE_PRICE_ID") || "") : "price_1UbMDDHqesE01MFcG9G1sX70";
  const sbUrl = Deno.env.get("SUPABASE_URL") || "";
  const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!(isLive ? /^(?:sk|rk)_live_/.test(stripeKey) : stripeKey.startsWith("sk_test_")) || !signingSecret.startsWith("whsec_") ||
      !priceId.startsWith("price_") || !sbUrl || !sbKey) {
    return json({ error: "Webhook not configured" }, 503);
  }
  const sig = req.headers.get("stripe-signature") || "";
  if (!await verifyStripeSignature(payload, sig, signingSecret)) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  try {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      return json({ received: true });
    }
    const obj = event?.data?.object;
    if (typeof obj?.id !== "string" || !obj.id.startsWith(isLive ? "cs_live_" : "cs_test_")) {
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
    if (session.id !== obj.id || session.livemode !== isLive || session.mode !== "payment" ||
        session.payment_status !== "paid" || session.amount_total !== LAUNCH_AMOUNT_CENTS ||
        session.currency !== "eur" || session.status !== "complete") {
      return json({ received: true, status: "not_applicable" });
    }
    const items = session.line_items?.data;
    if (!Array.isArray(items) || items.length !== 1 ||
        items[0]?.price?.id !== priceId || items[0]?.quantity !== 1 ||
        items[0]?.price?.unit_amount !== LAUNCH_AMOUNT_CENTS ||
        items[0]?.price?.currency !== "eur" || items[0]?.price?.livemode !== isLive ||
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

    if (!isLive) {
      // Un paiement de test ne doit jamais activer un accès cliente.
      console.info("Verified Stripe TEST payment; enrollment remains unchanged");
      return json({ received: true, test_only: true, enrollment_unchanged: true });
    }

    const { data: activation, error: activationError } = await supabase.rpc("activate_paid_enrollment", {
      p_user_id: userId,
      p_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      p_price_id: priceId,
      p_total_cents: LAUNCH_AMOUNT_CENTS,
      p_currency: "eur",
    });
    if (activationError) throw activationError;
    console.info("Verified Stripe LIVE payment; enrollment processed");
    return json({ received: true, duplicate: activation?.duplicate === true });
  } catch (e) {
    console.error("Stripe webhook:", e instanceof Error ? e.message : "unknown");
    return json({ error: "Webhook processing failed" }, 500);
  }
});


