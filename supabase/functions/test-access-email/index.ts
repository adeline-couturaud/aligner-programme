import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { accessEmailPayload } from "./access-email.js";
const ORIGIN="https://adeline-couturaud.github.io";
const headers={"access-control-allow-origin":ORIGIN,"access-control-allow-headers":"authorization, x-client-info, apikey, content-type","access-control-allow-methods":"POST, OPTIONS","content-type":"application/json; charset=utf-8","vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.headers.get("origin")!==ORIGIN)return json({error:"Origine non autorisée."},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return json({error:"Méthode non autorisée."},405);
 const authorization=req.headers.get("authorization")||"";
 if(!authorization.startsWith("Bearer "))return json({error:"Connectez-vous à votre compte administratrice."},401);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return json({error:"Service momentanément indisponible."},503);
 const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const account=await db.auth.getUser(authorization.slice(7));
 const user=account.data?.user;
 if(account.error||!user)return json({error:"Session invalide. Reconnectez-vous."},401);
 const profile=await db.from("profiles").select("role").eq("id",user.id).single();
 if(profile.error||profile.data?.role!=="admin")return json({error:"Test réservé à l’administratrice."},403);
 if(!user.email_confirmed_at||!user.email||/[\r\n]/.test(user.email))return json({error:"Confirmez l’adresse email de votre compte avant ce test."},400);
 let body;try{body=await req.json()}catch{return json({error:"Demande invalide."},400)}
 if(body?.confirmPreview!==true)return json({error:"Confirmez la demande d’aperçu."},400);
 const resendKey=Deno.env.get("RESEND_API_KEY")||"";
 if(!resendKey)return json({error:"Le service d’envoi d’email n’est pas configuré."},503);
 // Never accept a recipient, subject or content from the browser.
 const message=accessEmailPayload(user.email);
 message.subject="[TEST] "+message.subject;
 const notice="APERÇU DE TEST : aucun paiement n’a été effectué et aucun accès n’a été modifié.";
 message.text=notice+"\n\n"+message.text;
 message.html=message.html.replace('<h1 style=', '<p style="padding:12px;background:#fff5dc;color:#765400;font-weight:bold">'+notice+'</p><h1 style=');
 const day=new Date().toISOString().slice(0,10);
 try{
  const response=await fetch("https://api.resend.com/emails",{
   method:"POST",headers:{authorization:"Bearer "+resendKey,"content-type":"application/json","Idempotency-Key":"carnet-access-preview-v1/"+user.id+"/"+day},
   body:JSON.stringify(message),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return json({error:response.status===429?"Limite d’envoi atteinte. Réessayez plus tard.":response.status===409?"Un aperçu a déjà été demandé aujourd’hui. Vérifiez votre boîte de réception.":"Le service d’email a refusé l’envoi. Vérifiez la configuration de l’expéditeur."},502);
  const sent=await response.json();
  if(typeof sent?.id!=="string"||!sent.id)return json({error:"La confirmation d’envoi est indisponible. Vérifiez votre boîte avant de réessayer."},502);
  return json({ok:true,recipient:user.email,message:"Aperçu accepté par le service d’email. Vérifiez votre boîte de réception et les indésirables. Un seul aperçu par compte et par jour UTC."});
 }catch{return json({error:"Le service d’email ne répond pas. Vérifiez votre boîte de réception avant de réessayer."},503)}
});
