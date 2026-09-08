import { findCredential, integrationMissing, onlyMethod, readSession, responseJson } from '../lib/core.mjs';
import { getProviderData } from '../lib/connectors/index.mjs';
export async function providerHandler(request,appId){
  if(!onlyMethod(request,'GET'))return responseJson({ok:false,error:'Método não permitido.'},405);
  if(!readSession(request))return responseJson({ok:false,error:'Não autenticado.'},401);
  const url=new URL(request.url), slot=Number(url.searchParams.get('slot')||1), item=findCredential(appId,slot);
  if(!item)return responseJson({ok:false,error:'Acesso não encontrado na Vercel.'},404);
  const missing=integrationMissing(item); if(missing.length)return responseJson({ok:false,error:'Integração ainda não configurada.',code:'CONFIG',missing,app_id:appId,slot},409);
  try{const data=await getProviderData(item);return responseJson({ok:true,app_id:appId,slot,label:item.label,company:item.company,...data});}
  catch(err){return responseJson({ok:false,error:err?.message||'Falha na integração.',code:err?.code||'UPSTREAM_ERROR',details:process.env.SOLAR_DEBUG==='1'?err?.details||null:null,app_id:appId,slot},502);}
}
