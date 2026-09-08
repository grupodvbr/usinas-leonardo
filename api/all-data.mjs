import { onlyMethod, readCredentials, readSession, responseJson, publicCredential, integrationMissing } from '../lib/core.mjs';
import { getProviderData } from '../lib/connectors/index.mjs';
export default {async fetch(request){
 if(!onlyMethod(request,'GET'))return responseJson({ok:false,error:'Método não permitido.'},405); if(!readSession(request))return responseJson({ok:false,error:'Não autenticado.'},401);
 const items=readCredentials(); const results=[];
 for(const i of items){const pub=publicCredential(i),missing=integrationMissing(i);if(missing.length){results.push({...pub,ok:false,code:'CONFIG',error:'Integração não configurada.',missing});continue;}try{const d=await getProviderData(i);results.push({...pub,ok:true,data:d});}catch(e){results.push({...pub,ok:false,code:e?.code||'UPSTREAM_ERROR',error:e?.message||'Falha na integração.'});}}
 return responseJson({ok:true,results,checked_at:new Date().toISOString()});
}};
