import { SolarConnectorError, fetchWithTimeout, numberOf, normalizeStatus, summarizeDevices, isoFromAny, compactObject } from '../solar-utils.mjs';

function baseUrl(c){ return (c.api_base || 'https://server.growatt.com/').replace(/\/+$/,'') + '/'; }
function cookieHeader(headers){
  const arr = typeof headers.getSetCookie==='function' ? headers.getSetCookie() : [];
  const raw = arr.length ? arr : [headers.get('set-cookie')].filter(Boolean);
  return raw.map(v=>v.split(';')[0]).filter(Boolean).join('; ');
}
async function parseJsonResponse(res,label){
  const text=await res.text();
  try{return JSON.parse(text);}catch{throw new SolarConnectorError(`${label}: o Growatt não retornou JSON. Pode haver CAPTCHA ou mudança no portal.`,'GROWATT_RESPONSE',text.slice(0,500));}
}
async function postForm(url, body, headers){
  return fetchWithTimeout(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','accept':'application/json, text/plain, */*','user-agent':'Mozilla/5.0 SolarCentral/4.0',...headers},body:new URLSearchParams(body).toString(),redirect:'manual'},20000);
}

export async function getShinePhoneData(c){
  if(!c.user||!c.password) throw new SolarConnectorError('Configure USER e PASSWORD deste acesso.','CONFIG');
  const base=baseUrl(c), loginUrl=new URL('login',base).toString();
  const loginRes=await postForm(loginUrl,{account:c.user,password:c.password,validateCode:''},{origin:new URL(base).origin,referer:base});
  const login=await parseJsonResponse(loginRes,'Login');
  if(Number(login?.result)!==1) throw new SolarConnectorError(login?.msg || login?.message || 'Login Growatt recusado. Confira usuário/senha ou se o portal passou a exigir código de verificação.','AUTH',login);
  const cookie=cookieHeader(loginRes.headers); if(!cookie) throw new SolarConnectorError('Growatt autenticou, mas não retornou cookie de sessão.','AUTH_COOKIE');
  const headers={cookie,referer:base,'user-agent':'Mozilla/5.0 SolarCentral/4.0','accept':'application/json, text/plain, */*'};

  const listRes=await fetchWithTimeout(new URL('index/getPlantListTitle',base),{headers,redirect:'follow'},20000);
  const plantsRaw=await parseJsonResponse(listRes,'Lista de usinas');
  const rawList=Array.isArray(plantsRaw)?plantsRaw:(plantsRaw?.obj?.datas||plantsRaw?.data||[]);
  let plants=Array.isArray(rawList)?rawList:[];
  if(c.plant_id) plants=plants.filter(p=>String(p.id??p.plantId)===String(c.plant_id));
  const out=[];
  for(const p of plants.slice(0,20)){
    const plantId=String(p.id??p.plantId??''); if(!plantId)continue;
    let plantData={},devices=[];
    try{
      const r=await fetchWithTimeout(new URL(`panel/getPlantData?plantId=${encodeURIComponent(plantId)}`,base),{method:'POST',headers},20000);
      const j=await parseJsonResponse(r,'Dados da usina'); plantData=j?.obj||j?.data||j||{};
    }catch(e){ plantData={_error:e.message}; }
    try{
      const r=await postForm(new URL('panel/getDevicesByPlantList',base).toString(),{plantId,currPage:'1'},headers);
      const j=await parseJsonResponse(r,'Dispositivos'); devices=j?.obj?.datas||j?.data?.datas||j?.data||[]; if(!Array.isArray(devices))devices=[];
    }catch(e){ devices=[]; }
    const dnorm=devices.map(d=>({
      sn:d.sn||d.deviceSn||'',name:d.alias||d.deviceModel||d.deviceTypeName||d.sn||'Dispositivo',status:normalizeStatus(d.status),
      power_kw:numberOf(d.pac)!==null?numberOf(d.pac)/1000:null,today_kwh:numberOf(d.eDay),month_kwh:numberOf(d.eMonth),total_kwh:numberOf(d.eTotal),
      nominal_kw:numberOf(d.nominalPower),updated_at:isoFromAny(d.lastUpdateDateTime||d.timeServer),type:d.deviceTypeName||d.deviceType||'',raw:d
    }));
    const sum=(key)=>{const vals=dnorm.map(d=>d[key]).filter(v=>Number.isFinite(v));return vals.length?vals.reduce((a,b)=>a+b,0):null};
    const summary=summarizeDevices(dnorm);
    out.push(compactObject({
      id:plantId,name:p.plantName||plantData.plantName||c.plant||`Usina ${plantId}`,status:summary.online_devices>0?'online':(summary.total_devices?'offline':'unknown'),
      capacity_kw:numberOf(plantData.nominalPower),power_kw:sum('power_kw'),today_kwh:sum('today_kwh'),month_kwh:sum('month_kwh'),
      total_kwh:numberOf(plantData.eTotal)??sum('total_kwh'),updated_at:dnorm.map(d=>d.updated_at).filter(Boolean).sort().at(-1)||null,
      ...summary,devices:dnorm,raw:{plant:p,plantData}
    }));
  }
  return {provider:'shinephone',source:'Growatt ShineServer (sessão web)',plants:out,checked_at:new Date().toISOString(),note:'Integração usa a sessão web do ShineServer. Se Growatt ativar CAPTCHA/alterar endpoints, configure a API oficial quando disponível.'};
}
