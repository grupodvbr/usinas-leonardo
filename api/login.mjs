import { dashboardConfigured, makeSession, onlyMethod, responseJson, sameOrigin, sessionCookie, verifyDashboard } from '../lib/core.mjs';
export default { async fetch(request){
  if(!onlyMethod(request,'POST'))return responseJson({ok:false,error:'Método não permitido.'},405);
  if(!sameOrigin(request))return responseJson({ok:false,error:'Origem inválida.'},403);
  if(!dashboardConfigured())return responseJson({ok:false,error:'Configure DASHBOARD_USER, DASHBOARD_PASSWORD (ou HASH) e SESSION_SECRET na Vercel.'},500);
  let b={};try{b=await request.json()}catch{}
  if(!verifyDashboard(b.username,b.password))return responseJson({ok:false,error:'Usuário ou senha incorretos.'},401);
  const t=makeSession(b.username); if(!t)return responseJson({ok:false,error:'SESSION_SECRET inválido.'},500);
  return responseJson({ok:true,user:String(b.username)},200,{'set-cookie':sessionCookie(t)});
}};
