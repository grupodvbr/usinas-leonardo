import crypto from 'node:crypto';
import { SolarConnectorError, fetchJson, numberOf, normalizeStatus, isoFromAny, compactObject } from '../solar-utils.mjs';
function baseUrl(c){return (c.api_base||'https://globalapi.solarmanpv.com').replace(/\/+$/,'');}
async function post(base,path,body,token=null){
  const headers={'content-type':'application/json','accept':'application/json','user-agent':'SolarCentral/4.0'}; if(token)headers.authorization=`bearer ${token}`;
  return (await fetchJson(`${base}${path}`,{method:'POST',headers,body:JSON.stringify(body)},20000)).data;
}
export async function getSolarmanData(c){
  if(!c.user||!c.password||!c.app_id_key||!c.app_secret) throw new SolarConnectorError('SOLARMAN exige USER, PASSWORD, APP_ID e APP_SECRET da OpenAPI.','CONFIG');
  const base=baseUrl(c), passhash=crypto.createHash('sha256').update(c.password).digest('hex');
  const ident=c.user.includes('@')?{email:c.user}:{username:c.user};
  const tokenData=await post(base,`/account/v1.0/token?appId=${encodeURIComponent(c.app_id_key)}&language=en`,{appSecret:c.app_secret,password:passhash,...ident});
  if(tokenData?.success===false || !tokenData?.access_token) throw new SolarConnectorError(tokenData?.msg||tokenData?.code||'Não foi possível obter token SOLARMAN.','AUTH',tokenData);
  const token=tokenData.access_token;
  const list=await post(base,'/station/v1.0/list?language=en',{page:1,size:100},token);
  if(list?.success===false) throw new SolarConnectorError(list?.msg||'Falha ao listar usinas SOLARMAN.','UPSTREAM',list);
  let rows=Array.isArray(list?.stationList)?list.stationList:[]; if(c.plant_id)rows=rows.filter(x=>String(x.id)===String(c.plant_id));
  const plants=[];
  for(const s of rows.slice(0,30)){
    let rt={}; try{rt=await post(base,'/station/v1.0/realTime?language=en',{stationId:s.id},token);}catch(e){rt={_error:e.message};}
    plants.push(compactObject({
      id:String(s.id),name:s.name||c.plant||`Usina ${s.id}`,status:normalizeStatus(s.networkStatus),capacity_kw:numberOf(s.installedCapacity),
      power_kw:numberOf(rt.generationPower??s.generationPower)!==null?numberOf(rt.generationPower??s.generationPower)/1000:null,
      load_kw:numberOf(rt.usePower)!==null?numberOf(rt.usePower)/1000:null,grid_kw:numberOf(rt.gridPower)!==null?numberOf(rt.gridPower)/1000:null,
      total_kwh:numberOf(rt.generationTotal),battery_soc:numberOf(rt.batterySoc??s.batterySoc),updated_at:isoFromAny(rt.lastUpdateTime??s.lastUpdateTime),
      network_status:s.networkStatus||null,raw:{station:s,realtime:rt}
    }));
  }
  return {provider:'solarman',source:'SOLARMAN OpenAPI',plants,checked_at:new Date().toISOString()};
}
