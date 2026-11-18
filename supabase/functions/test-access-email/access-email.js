// Email transactionnel d’accès. Appelé uniquement après la validation et l’activation réelles.
export const ACCESS_URL = "https://adeline-couturaud.github.io/aligner-programme/";
export function accessEmailPayload(email) {
 const text = [
  "Bonjour,","",
  "Votre achat est confirmé. Votre accès à Mon Carnet Aligné est activé.","",
  "Ouvrir mon carnet : "+ACCESS_URL,"",
  "Connectez-vous avec le compte utilisé pour votre achat. Si vous avez oublié votre mot de passe, cliquez sur « Mot de passe oublié ? ».","",
  "Pour commencer : ouvrez le jour 1, « Point de départ ». Vous pourrez avancer à votre rythme et retrouver vos réponses en vous reconnectant au même compte.","",
  "Sur téléphone, vous pouvez ajouter le carnet à votre écran d’accueil pour le retrouver facilement. Une connexion internet reste nécessaire.","",
  "Une difficulté d’accès ? Écrivez-moi à contact@alignerconseil.fr en précisant l’adresse email de votre compte.","",
  "Adeline","Aligner Conseil"
 ].join("\n");
 const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#FFFEFD;color:#233d38;font:16px/1.65 Arial,sans-serif"><div style="max-width:560px;margin:auto;padding:28px 20px"><p style="color:#006D77;font-size:12px;font-weight:bold;letter-spacing:1px">ALIGNER CONSEIL</p><h1 style="color:#0B493F;font:30px/1.25 Georgia,serif">Votre Carnet Aligné est prêt</h1><p>Bonjour,</p><p>Votre achat est confirmé. Votre accès à <strong>Mon Carnet Aligné</strong> est activé.</p><p style="margin:26px 0"><a href="'+ACCESS_URL+'" style="display:inline-block;background:#C83E6A;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Ouvrir mon carnet</a></p><p>Connectez-vous avec le compte utilisé pour votre achat. Si vous avez oublié votre mot de passe, cliquez sur « Mot de passe oublié ? ».</p><h2 style="color:#0B493F;font-size:20px">Votre premier pas</h2><p>Ouvrez le <strong>jour 1, « Point de départ »</strong>. Avancez à votre rythme et retrouvez vos réponses en vous reconnectant au même compte.</p><p>Sur téléphone, vous pouvez ajouter le carnet à votre écran d’accueil pour le retrouver facilement. Une connexion internet reste nécessaire.</p><p>Une difficulté d’accès ? Écrivez-moi à <a href="mailto:contact@alignerconseil.fr" style="color:#006D77">contact@alignerconseil.fr</a> en précisant l’adresse email de votre compte.</p><p>Adeline<br>Aligner Conseil</p><p style="font-size:12px;color:#647773;border-top:1px solid #e2e8e4;padding-top:16px">Lien direct : <a href="'+ACCESS_URL+'" style="color:#006D77">'+ACCESS_URL+'</a></p></div></body></html>';
 return {from:"Mon Carnet Aligné <alertes@notifications.alignerconseil.fr>",to:[email],reply_to:"contact@alignerconseil.fr",subject:"Votre Carnet Aligné est prêt",text,html};
}
