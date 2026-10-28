
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGIN = "https://adeline-couturaud.github.io";
const APP_URL = "https://adeline-couturaud.github.io/aligner-programme/";
const TERMS_VERSION = "2026-10-28-droit-retractation";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  if (req.headers.get("origin") !== ALLOWED_ORIGIN) return json({ error: "Origine non autorisée." }, 403);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const priceId = Deno.env.get("STRIPE_PRICE_ID") || "";
  const sbUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // Test-only rollout: live keys are deliberately rejected until legal and billing review.
  if (!stripeKey.startsWith("sk_test_") || !priceId.startsWith("price_") || !sbUrl || !serviceKey) {
    return json({ error: "Paiement test non configuré." }, 503);
  }

  const bearer = req.headers.get("authorization") || "";
  const accessToken = bearer.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!accessToken) return json({ error: "Veuillez vous reconnecter." }, 401);

  try {
    const supabase = createClient(sbUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: auth, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !auth?.user?.id || !auth.user.email) {
      return json({ error: "Session expirée, reconnectez-vous." }, 401);
    }
    const user = auth.user;
    const { data: membership, error: membershipError } = await supabase
      .from("enrollments").select("status").eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (membership?.status === "active") return json({ already_active: true });

    const body = await req.json().catch(() => ({}));
    if (body?.termsAccepted !== true || body?.immediateAccess !== true || body?.rightsAcknowledged !== true) {
      return json({ error: "Les confirmations sont nécessaires avant de continuer." }, 400);
    }

    const now = new Date().toISOString();
    const values = new URLSearchParams();
    values.set("mode", "payment");
    values.set("locale", "fr");
    values.set("line_items[0][price]", priceId);
    values.set("line_items[0][quantity]", "1");
    values.set("customer_email", user.email);
    values.set("client_reference_id", user.id);
    values.set("metadata[user_id]", user.id);
    values.set("metadata[product_code]", "mon-carnet-aligne-dressing");
    values.set("metadata[terms_version]", TERMS_VERSION);
    values.set("metadata[consented_at]", now);
    values.set("metadata[withdrawal_information_acknowledged]", "true");
    values.set("metadata[withdrawal_right_waived]", "false");
    values.set("payment_intent_data[metadata][user_id]", user.id);
    values.set("success_url", APP_URL + "?paiement=succes&session_id={CHECKOUT_SESSION_ID}");
    values.set("cancel_url", APP_URL + "?paiement=annule");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + stripeKey,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: values.toString(),
    });
    const session = await res.json();
    if (!res.ok) {
      console.error("Stripe Checkout", res.status, session?.error?.code || "error");
      return json({ error: "Impossible de préparer le paiement test. Vérifiez le tarif Stripe." }, 502);
    }
    if (typeof session.id !== "string" || typeof session.url !== "string" ||
        !session.url.startsWith("https://checkout.stripe.com/")) {
      return json({ error: "Réponse Stripe invalide." }, 502);
    }
    const { error: consentError } = await supabase.from("checkout_consents").insert({
      stripe_checkout_session_id: session.id,
      user_id: user.id,
      cgv_accepted: true,
      immediate_start_requested: true,
      withdrawal_information_acknowledged: true,
      terms_version: TERMS_VERSION,
      consented_at: now,
    });
    if (consentError) {
      console.error("Consent recording", consentError.code);
      return json({ error: "Impossible d'enregistrer les confirmations d'achat." }, 500);
    }
    return json({ url: session.url });
  } catch (error) {
    console.error("Create checkout", error instanceof Error ? error.message : "unknown");
    return json({ error: "Le paiement test est temporairement indisponible." }, 500);
  }
});
