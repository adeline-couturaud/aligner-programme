/* Aligner Conseil: suppression volontaire et sécurisée du compte. */
(() => {
  "use strict";
  const app = document.getElementById("app");
  if (!app) return;
  const CONFIRMATION = "SUPPRIMER";

  function install() {
    const section = app.querySelector(".danger-card");
    if (!section || section.querySelector("#eraseAccount")) return;
    const emailLink = section.querySelector('a[href^="mailto:contact@alignerconseil.fr"]');
    if (!emailLink) return;
    const intro = section.querySelector("h3");
    if (intro) intro.textContent = "Supprimer mon compte";
    const form = document.createElement("div");
    form.innerHTML = `
      <div class="field">
        <label for="erasePassword">Confirmer votre mot de passe actuel</label>
        <input id="erasePassword" type="password" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label for="eraseWord">Tapez SUPPRIMER pour confirmer</label>
        <input id="eraseWord" type="text" autocomplete="off" placeholder="SUPPRIMER">
      </div>
      <div class="actions">
        <button class="btn danger" id="eraseAccount" type="button">Supprimer définitivement mon compte</button>
      </div>
      <p class="footer-note" id="eraseStatus" role="status" aria-live="polite"></p>
      <p class="footer-note">Cette action est irréversible. Exportez votre carnet et vos photos avant de continuer. Les justificatifs soumis à une obligation légale de conservation peuvent être conservés.</p>
    `;
    emailLink.before(form);
    emailLink.textContent = "Ou demander la suppression par e-mail";

    const button = form.querySelector("#eraseAccount");
    const passwordInput = form.querySelector("#erasePassword");
    const confirmation = form.querySelector("#eraseWord");
    const status = form.querySelector("#eraseStatus");

    button.addEventListener("click", async () => {
      if (confirmation.value.trim() !== CONFIRMATION) {
        status.textContent = "Saisissez SUPPRIMER en majuscules.";
        return;
      }
      if (!passwordInput.value) {
        status.textContent = "Indiquez votre mot de passe.";
        return;
      }
      if (!window.confirm("Confirmez-vous la suppression définitive de votre compte, de vos exercices et de vos photos ? Cette action est irréversible.")) return;
      button.disabled = true;
      confirmation.disabled = true;
      passwordInput.disabled = true;
      status.textContent = "Vérification de votre identité…";
      try {
        const settings = window.ALIGNER_CONFIG;
        if (!settings?.supabaseUrl || !settings?.supabasePublishableKey) throw new Error("Service indisponible.");
        const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
        const sb = createClient(settings.supabaseUrl, settings.supabasePublishableKey, {
          auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
        });
        const { data: current, error: userError } = await sb.auth.getUser();
        if (userError || !current.user?.id || !current.user.email) throw new Error("Veuillez vous reconnecter.");
        const originalId = current.user.id;
        const { data: signedIn, error: signInError } = await sb.auth.signInWithPassword({
          email: current.user.email,
          password: passwordInput.value,
        });
        if (signInError || !signedIn.user || signedIn.user.id !== originalId) {
          throw new Error("Mot de passe incorrect. Aucune donnée n'a été supprimée.");
        }
        status.textContent = "Suppression du compte en cours…";
        const { data, error } = await sb.functions.invoke("delete-account", {
          body: { confirm: true, confirmation: CONFIRMATION },
        });
        if (error || data?.deleted !== true) {
          throw new Error(data?.error || "Suppression non confirmée. Contactez contact@alignerconseil.fr.");
        }
        passwordInput.value = "";
        try { await sb.auth.signOut({ scope: "local" }); } catch (_) { /* Account already removed. */ }
        status.textContent = "Votre compte a été supprimé. Redirection…";
        window.location.reload();
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : "Une erreur est survenue. Contactez contact@alignerconseil.fr.";
        button.disabled = false;
        confirmation.disabled = false;
        passwordInput.disabled = false;
      } finally {
        passwordInput.value = "";
      }
    });
  }

  new MutationObserver(install).observe(app, { childList: true, subtree: true });
  install();
})();
