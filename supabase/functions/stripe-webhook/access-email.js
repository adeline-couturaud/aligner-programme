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
export async function sendPaidAccessEmail({db,userId,sessionId,resendKey,fetchImpl=fetch}) {
 if(!/^cs_live_[A-Za-z0-9]+$/.test(sessionId||""))throw new Error("Access email requires a live session");
 if(!resendKey)throw new Error("Access email provider is not configured");
 const {data:account,error:accountError}=await db.auth.admin.getUserById(userId);
 const user=account?.user;
 if(accountError||!user||user.id!==userId||!user.email_confirmed_at||!user.email||/[\r\n]/.test(user.email)) {
  throw new Error("Access email requires a confirmed account address");
 }
 const claim=await db.rpc("claim_paid_access_email",{
  p_user_id:userId,p_session_id:sessionId,p_payload:accessEmailPayload(user.email)
 });
 if(claim.error)throw new Error("Access email queue unavailable");
 const job=claim.data;
 if(!job||!job.status)throw new Error("Invalid access email claim");
 if(["sent","skipped","review","not_queued"].includes(job.status))return {status:job.status};
 if(job.status!=="claimed"||!job.token||!job.payload)throw new Error("Access email delivery is already in progress");
 const finish=async(success,providerId,errorCode)=>{
  const done=await db.rpc("finish_paid_access_email",{p_session_id:sessionId,p_token:job.token,p_success:success,p_provider_id:providerId,p_error:errorCode});
  if(done.error||done.data!==true)throw new Error("Access email delivery state could not be saved");
 };
 let response;
 try {
  response=await fetchImpl("https://api.resend.com/emails",{
   method:"POST",
   headers:{authorization:"Bearer "+resendKey,"content-type":"application/json","Idempotency-Key":"carnet-access/"+sessionId},
   body:JSON.stringify(job.payload),
   signal:AbortSignal.timeout(10000)
  });
 }catch(error){
  await finish(false,null,"provider_network_error");
  throw new Error("Access email provider is temporarily unavailable");
 }
 if(!response.ok){
  await finish(false,null,"provider_http_"+response.status);
  throw new Error("Access email provider refused the request");
 }
 let result;
 try{result=await response.json();}catch{
  await finish(false,null,"invalid_provider_response");
  throw new Error("Access email provider returned an invalid response");
 }
 if(typeof result?.id!=="string"||!result.id){
  await finish(false,null,"missing_provider_id");
  throw new Error("Access email provider returned no message identifier");
 }
 // If this write fails, the lease expires and the same frozen payload is retried
 // within Resend's idempotency window. Never mark a failed send as accepted.
 await finish(true,result.id,null);
 return {status:"sent"};
}
