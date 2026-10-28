import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";

const $ = (id) => document.getElementById(id);
let client, user, pending, receipt;
const status = (text) => { $("status").textContent = text; };

function showAccount(account) {
  user = account;
  $("loginPanel").hidden = true;
  $("withdrawalForm").hidden = false;
  $("accountEmail").textContent = user.email;
  status("");
}

async function boot() {
  try {
    const cfg = window.ALIGNER_CONFIG;
    if (!cfg?.supabaseUrl || !cfg?.supabasePublishableKey) throw new Error("Configuration indisponible.");
    client = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
    const { data, error } = await client.auth.getUser();
    if (!error && data.user) showAccount(data.user);
    else { $("loginPanel").hidden = false; status(""); }
  } catch { status("Le service est indisponible. Vous pouvez transmettre votre demande par e-mail ci-dessous."); }
}

$("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const button = ev.currentTarget.querySelector("button");
  button.disabled = true;
  status("Connexion en cours…");
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: $("loginEmail").value.trim(), password: $("loginPassword").value,
    });
    if (error || !data.user || !data.session) throw new Error();
    showAccount(data.user);
  } catch { status("Connexion impossible. Vérifiez vos identifiants ou envoyez votre demande par e-mail."); }
  finally { $("loginPassword").value = ""; button.disabled = false; }
});

$("withdrawalForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  pending = { firstName: $("firstName").value.trim(), lastName: $("lastName").value.trim(),
    purchaseDate: $("purchaseDate").value, orderReference: $("orderReference").value.trim(), confirmed: true };
  const fields = [["Prénom", pending.firstName], ["Nom", pending.lastName],
    ["Achat du", pending.purchaseDate.split("-").reverse().join("/")],
    ["Référence", pending.orderReference || "Non renseignée"], ["Accusé de réception à", user.email]];
  $("reviewDetails").replaceChildren();
  for (const [label, value] of fields) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = value; $("reviewDetails").append(dt, dd);
  }
  $("withdrawalForm").hidden = true; $("reviewPanel").hidden = false;
  status(""); $("confirmWithdrawal").focus();
});
$("editWithdrawal").addEventListener("click", () => {
  $("reviewPanel").hidden = true; $("withdrawalForm").hidden = false; $("firstName").focus();
});

async function submitWithdrawal() {
  $("confirmWithdrawal").disabled = true; $("editWithdrawal").disabled = true; $("retryReceipt").disabled = true;
  status("Enregistrement de votre demande…");
  try {
    const { data: identity, error: identityError } = await client.auth.getUser();
    if (identityError || identity.user?.id !== user?.id) throw new Error();
    const { data, error } = await client.functions.invoke("request-withdrawal", { body: pending });
    if (error || data?.accepted !== true) throw new Error();
    receipt = data;
    $("reviewPanel").hidden = true; $("receiptPanel").hidden = false;
    $("receiptText").textContent = data.receipt;
    $("emailStatus").textContent = data.emailSent
      ? "L’accusé de réception a été transmis au service d’envoi d’e-mails. Vous pouvez aussi le télécharger ci-dessous."
      : "Votre demande est enregistrée. L’envoi de l’e-mail n’est pas confirmé : téléchargez votre accusé de réception et réessayez l’envoi.";
    $("retryReceipt").hidden = data.emailSent;
    status(""); $("downloadReceipt").focus();
  } catch { status("L’envoi n’a pas pu être confirmé. Réessayez ou transmettez votre demande par e-mail à contact@alignerconseil.fr."); }
  finally { $("confirmWithdrawal").disabled = false; $("editWithdrawal").disabled = false; $("retryReceipt").disabled = false; }
}
$("confirmWithdrawal").addEventListener("click", submitWithdrawal);
$("retryReceipt").addEventListener("click", submitWithdrawal);
$("downloadReceipt").addEventListener("click", () => {
  if (!receipt) return;
  const url = URL.createObjectURL(new Blob(["\uFEFF" + receipt.receipt], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = "retractation-mon-carnet-aligne-" + receipt.id + ".txt";
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
boot();
