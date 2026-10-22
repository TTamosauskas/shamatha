import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.10";
import { reconcileLiveStudent } from "../_shared/mp-live-reconciliation.ts";
import { rotatingBillingBatchOffset } from "../_shared/mp-live-invoice-pages.mjs";

/**
 * Periodically refreshes payment status without requiring the student to log in.
 * NOT deployed/scheduled. Requires BOTH private kill switches and a separately
 * configured >=32-character cron secret. Does not create/modify any MP charges.
 *
 * Deploy with JWT verification disabled ONLY for this server-to-server endpoint;
 * cryptographically verify the independent Bearer secret before touching DB.
 */
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const TOKEN=Deno.env.get('SHAMATHA_MP_PRODUCTION_ACCESS_TOKEN')||'';
const SELLER=Deno.env.get('SHAMATHA_MP_PRODUCTION_SELLER_ID')||'';
const CRON_SECRET=Deno.env.get('SHAMATHA_BILLING_CRON_SECRET')||'';
const ENABLED=Deno.env.get('SHAMATHA_BILLING_PERIODIC_ENABLED')==='true'&&
  Deno.env.get('SHAMATHA_BILLING_RECONCILE_ENABLED')==='true';
const MAX_BATCH=5;
const QUARTER_HOUR_MS=15*60*1000;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});

async function authorizedBearer(actual:string,secret:string):Promise<boolean>{
  if(secret.length<32||actual.length>512)return false;
  const target='Bearer '+secret;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(actual)),
    crypto.subtle.digest('SHA-256',enc.encode(target))
  ]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<aa.length;i++)mismatch|=aa[i]^bb[i];
  return mismatch===0;
}

Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!ENABLED||!BASE||!SERVICE||!TOKEN||
     !/^\d+$/.test(SELLER)||SELLER==='3778352536'||
     CRON_SECRET.length<32)
    return json({error:'BILLING_PERIODIC_DISABLED'},503);
  if(!await authorizedBearer(req.headers.get('Authorization')||'',CRON_SECRET))
    return json({error:'NOT_AUTHORIZED'},401);
  try{
    const sb=createClient(BASE,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
    const {count,error:countError}=await sb.from('billing_subscriptions')
      .select('id',{head:true,count:'exact'}).eq('environment','production');
    if(countError||count===null)throw Error('BILLING_BATCH_COUNT_FAILED');
    if(count===0)return json({checked:0,failed:0,total:0});
    // One stable slice per 15-minute interval; failed records do not prevent
    // later batches. Requires monitoring of count/cadence as volume grows.
    const offset=rotatingBillingBatchOffset(count,MAX_BATCH,
      Math.floor(Date.now()/QUARTER_HOUR_MS));
    const {data:batch,error:batchError}=await sb.from('billing_subscriptions')
      .select('id,user_id').eq('environment','production')
      .order('id',{ascending:true}).range(offset,offset+MAX_BATCH-1);
    if(batchError||!batch?.length)throw Error('BILLING_BATCH_READ_FAILED');
    const checked=await Promise.allSettled(batch.map(async row=>{
      const {data:auth,error}=await sb.auth.admin.getUserById(row.user_id);
      if(error||!auth?.user?.email)throw Error('BILLING_USER_NOT_VERIFIED');
      return await reconcileLiveStudent({
        sb,userId:row.user_id,email:auth.user.email,
        subscriptionId:row.id,token:TOKEN,seller:SELLER
      });
    }));
    const failed=checked.filter(x=>x.status==='rejected').length;
    if(failed)console.error('billing periodic reconciliation failures',failed,
      'of',checked.length,'slot',Math.floor(Date.now()/QUARTER_HOUR_MS));
    return json({checked:checked.length-failed,failed,total:count,
      remainingApprox:Math.max(0,count-checked.length)},failed?503:200);
  }catch(error){
    console.error('billing periodic reconciliation unavailable',
      String((error as Error)?.message||error).slice(0,120));
    return json({error:'BILLING_PERIODIC_UNAVAILABLE'},503);
  }
});
