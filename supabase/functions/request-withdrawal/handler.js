const ORIGIN = "https://adeline-couturaud.github.io";
const CONTACT = "contact@alignerconseil.fr";
const FROM = "Mon Carnet Aligné <alertes@notifications.alignerconseil.fr>";
const PRODUCT = "Mon Carnet Aligné – Mon dressing, mon style";
const columns = "id,user_id,first_name,last_name,email,purchase_date,order_reference,created_at,receipt_sent_at,notification_sent_at";

export function receiptText(row) {
  const date = new Date(row.created_at).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "long",
  });
  return [
    "Aligner Conseil | Accusé de réception de rétractation",
    "Référence : " + row.id,
    "Demande reçue le : " + date,
    "Horodatage : " + row.created_at,
    "", "Déclaration reçue :",
    "Je vous notifie ma rétractation du contrat portant sur l’achat du programme « " + PRODUCT + " ».",
    "Prénom : " + row.first_name,
    "Nom : " + row.last_name,
    "Adresse de réception : " + row.email,
    "Date d’achat indiquée : " + row.purchase_date,
    "Référence de commande indiquée : " + (row.order_reference || "Non renseignée"),
    "", "Cet accusé confirme la réception de votre demande. Il ne constitue pas une confirmation de remboursement.",
    "Aligner Conseil vérifiera la commande et traitera la demande selon les conditions générales de vente et les dispositions légales applicables.",
    "Contact : " + CONTACT,
  ].join("\n");
}

export function createWithdrawalHandler({ env, fetch: request = globalThis.fetch, now = () => new Date() }) {
  const headers = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  const clean = (value, max) => typeof value === "string" && value.trim().length <= max &&
    !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;

  return async (req) => {
    if (req.headers.get("origin") !== ORIGIN) return json({ error: "Origine non autorisée." }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Connectez-vous avec le compte utilisé pour votre achat." }, 401);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Service temporairement indisponible. Vous pouvez écrire à " + CONTACT + "." }, 503);

    const database = async (path, options = {}) => {
      const response = await request(env.SUPABASE_URL + "/rest/v1/" + path, {
        ...options,
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      if (!response.ok) throw new Error("Database unavailable");
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    try {
      const authResponse = await request(env.SUPABASE_URL + "/auth/v1/user", {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token },
      });
      if (!authResponse.ok) return json({ error: "Votre session a expiré. Reconnectez-vous." }, 401);
      const user = await authResponse.json();
      if (!user?.id || !user.email || !user.email_confirmed_at) return json({ error: "Confirmez votre adresse électronique avant de continuer." }, 401);
      const raw = await req.text();
      if (raw.length > 4096) return json({ error: "Le formulaire est trop long." }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Formulaire invalide." }, 400); }
      const firstName = clean(body?.firstName, 80);
      const lastName = clean(body?.lastName, 80);
      const reference = clean(body?.orderReference ?? "", 160);
      const purchaseDate = typeof body?.purchaseDate === "string" ? body.purchaseDate : "";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) ? new Date(purchaseDate + "T12:00:00Z") : null;
      if (!firstName || !lastName || reference === null || !date || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== purchaseDate || body?.confirmed !== true) {
        return json({ error: "Vérifiez vos prénom, nom, date d’achat et la confirmation de votre demande." }, 400);
      }
      const filter = new URLSearchParams({
        user_id: "eq." + user.id, purchase_date: "eq." + purchaseDate,
        order_reference: "eq." + reference, select: columns,
      });
      let rows = await database("withdrawal_requests?" + filter);
      let row = rows?.[0];
      if (!row) {
        const recent = new URLSearchParams({ user_id: "eq." + user.id,
          created_at: "gte." + new Date(now().getTime() - 3600000).toISOString(), select: "id", limit: "5" });
        const recentRows = await database("withdrawal_requests?" + recent);
        if (recentRows.length >= 5) return json({ error: "Plusieurs demandes ont déjà été reçues. Écrivez à " + CONTACT + " pour toute autre demande." }, 429);
        await database("withdrawal_requests?on_conflict=user_id,purchase_date,order_reference", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: user.id, first_name: firstName, last_name: lastName,
            email: user.email, purchase_date: purchaseDate, order_reference: reference }),
        });
        rows = await database("withdrawal_requests?" + filter);
        row = rows?.[0];
        if (!row) throw new Error("Request not recorded");
      }
      // The original receipt is immutable across retries, including its date.
      const text = receiptText(row);
      const send = async (to, subject, content, key) => {
        if (!env.RESEND_API_KEY) return false;
        try {
          const response = await request("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: "Bearer " + env.RESEND_API_KEY,
              "Content-Type": "application/json", "Idempotency-Key": key },
            body: JSON.stringify({ from: FROM, to: [to], subject, text: content, reply_to: CONTACT }),
          });
          return response.ok;
        } catch { return false; }
      };
      const patch = {};
      let emailSent = Boolean(row.receipt_sent_at);
      if (!emailSent) {
        emailSent = await send(row.email, "Votre demande de rétractation | Mon Carnet Aligné", text, "withdrawal-receipt-" + row.id);
        if (emailSent) patch.receipt_sent_at = now().toISOString();
      }
      if (!row.notification_sent_at && await send(CONTACT, "Rétractation à traiter | Mon Carnet Aligné", text,
          "withdrawal-notification-" + row.id)) patch.notification_sent_at = now().toISOString();
      if (Object.keys(patch).length) await database("withdrawal_requests?id=eq." + encodeURIComponent(row.id), {
        method: "PATCH", body: JSON.stringify(patch),
      });
      return json({ accepted: true, id: row.id, receivedAt: row.created_at, receipt: text, emailSent }, emailSent ? 200 : 202);
    } catch {
      return json({ error: "L’envoi n’a pas pu être confirmé. Réessayez ou écrivez à " + CONTACT + "." }, 503);
    }
  };
}
