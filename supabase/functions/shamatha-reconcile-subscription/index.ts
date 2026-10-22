import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { reconcileLiveStudent } from "../_shared/mp-live-reconciliation.ts";

/**
 * On-demand, authenticated reconciliation of the CURRENT student only.
 * No browser-supplied user ID, subscription ID, amounts or entitlement flags.
 * OFF by default; does not create any Mercado Pago charges.
 */
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const TOKEN=Deno.env.get('SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN')||'';
const SELLER=Deno.env.get('SHAMATHA_MP_PRODUCTION_SELLER_ID')||'';
const ENABLED=Deno.env.get('SHAMATHA_BILLING_RECONCILE_ENABLED')==='true';
const ORIGIN='https://ttamosauskas.github.io';
const headers={
  'Access-Control-Allow-Origin':ORIGIN,
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Cache-Control':'no-store','Content-Type':'application/json'
};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers});
const stop=(reason,status=409)=>{throw Object.assign(new Error(reason),{status})};

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==ORIGIN)
    return json({error:'ORIGIN_NOT_ALLOWED'},403);
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!ENABLED||!BASE||!SERVICE||!TOKEN||!/^\d+$/.test(SELLER)||SELLER==='3778352536')
    return json({error:'BILLING_RECONCILIATION_DISABLED'},503);
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!jwt)stop('AUTH_REQUIRED',401);
    const sb=createClient(BASE,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await sb.auth.getUser(jwt);
    if(authError||!user||!user.email_confirmed_at||!user.email)
      stop('SESSION_NOT_VERIFIED',401);
    const result=await reconcileLiveStudent({
      sb,userId:user.id,email:user.email,token:TOKEN,seller:SELLER
    });
    return json(result);
  }catch(err){
    const status=Number(err?.status||503);
    console.error('billing student reconciliation failed',
      String(err?.message||err).slice(0,120));
    return json({error:status>=500?'BILLING_VERIFICATION_UNAVAILABLE':
      String(err?.message||'INVALID_REQUEST')},status);
  }
});
