import { SolarConnectorError, fetchJson, numberOf, normalizeStatus, isoFromAny, compactObject, classifyMetric, normalizeMetricValue } from '../solar-utils.mjs';
function baseUrl(c){return (c.api_base||'https://intl-developer.saj-electric.com/prod-api').replace(/\/+$/,'');}
async function getJson(url,headers){return (await fetchJson(url,{headers:{'content-language':'en_US','accept':'application/json',...headers}},20000)).data;}
function genericMetrics(obj={}){
  const out={};
  for(const [k,v] of Object.entries(obj||{})){
    if(v&&typeof v==='object')continue; const kind=classifyMetric(k); if(!kind)continue; const n=normalizeMetricValue(v,k.toLowerCase().includes('power')?'w':''); if(n!==null&&out[kind]===undefined)out[kind]=n;
  }
  return out;
}
export async function getElekeeperData(c){
  if(!c.app_id_key||!c.app_secret) throw new SolarConnectorError('elekeeper exige APP_ID e APP_SECRET do Elekeeper Open Platform e autorização das usinas ao developer.','CONFIG');
  const base=baseUrl(c);
  const tokenRes=await getJson(`${base}/open/api/access_token?appId=${encodeURIComponent(c.app_id_key)}&appSecret=${encodeURIComponent(c.app_secret)}`,{});
  if(Number(tokenRes?.code)!==200 || !tokenRes?.data?.access_token) throw new SolarConnectorError(tokenRes?.msg||'Não foi possível obter token elekeeper.','AUTH',tokenRes);
  const headers={accessToken:tokenRes.data.access_token};
  const list=await getJson(`${base}/open/api/developer/plant/page?appId=${encodeURIComponent(c.app_id_key)}&pageSize=100&pageNum=1`,headers);
  if(Number(list?.code)!==200) throw new SolarConnectorError(list?.msg||'Falha ao listar usinas elekeeper.','UPSTREAM',list);
  let rows=Array.isArray(list?.rows)?list.rows:[]; if(c.plant_id)rows=rows.filter(x=>String(x.plantId)===String(c.plant_id));
  const plants=[];
  for(const p of rows.slice(0,30)){
    const plantId=String(p.plantId||''); let details={},stats={},devices=[];
    try{ const j=await getJson(`${base}/open/api/plant/details?plantId=${encodeURIComponent(plantId)}`,headers); details=j?.data||{}; }catch{}
    try{ const j=await getJson(`${base}/open/api/plant/getPlantStatisticsData?plantId=${encodeURIComponent(plantId)}&clientDate=${encodeURIComponent(new Date().toISOString().slice(0,19).replace('T',' '))}`,headers); stats=j?.data||{}; }catch{}
    try{ const j=await getJson(`${base}/open/api/plant/getPlantAllDeviceList?plantId=${encodeURIComponent(plantId)}&userId=`,headers); const arr=j?.data||[]; devices=Array.isArray(arr)?arr.map(d=>({sn:d.sn||d.deviceSn||'',name:d.sn||'Dispositivo',type:d.deviceType,status:normalizeStatus(d.isOnline??d.status),raw:d})):[]; }catch{}
    const m={...genericMetrics(details),...genericMetrics(stats)};
    plants.push(compactObject({
      id:plantId,name:p.plantName||details.plantName||c.plant||`Usina ${plantId}`,status:devices.some(d=>d.status==='online')?'online':(devices.length?'offline':'unknown'),
      capacity_kw:numberOf(details.systemPower),power_kw:m.power_kw,today_kwh:m.today_kwh,month_kwh:m.month_kwh,total_kwh:m.total_kwh,battery_soc:m.battery_soc,
      total_devices:devices.length,online_devices:devices.filter(d=>d.status==='online').length,updated_at:isoFromAny(stats.updateTime||stats.lastUpdateTime),devices,raw:{plant:p,details,stats}
    }));
  }
  return {provider:'elekeeper',source:'SAJ Elekeeper Open Platform',plants,checked_at:new Date().toISOString()};
}
