import { SolarConnectorError, fetchJson, numberOf, normalizeStatus, compactObject, classifyMetric, normalizeMetricValue } from '../solar-utils.mjs';
function baseUrl(c){return (c.api_base||'https://gateway.isolarcloud.com.hk').replace(/\/+$/,'');}
async function post(base,path,c,token,payload){
  const body={appkey:c.app_key,lang:'_en_US',...payload}; if(token&&payload.user_password===undefined)body.token=token;
  const headers={'content-type':'application/json','user-agent':'SolarCentral/4.0','x-access-key':c.secret_key,'sys_code':'901'}; if(token)headers.token=token;
  const data=(await fetchJson(`${base}${path}`,{method:'POST',headers,body:JSON.stringify(body)},25000)).data;
  if(String(data?.result_code)!=='1') throw new SolarConnectorError(data?.result_msg||`iSolarCloud result_code=${data?.result_code}`,'UPSTREAM',data);
  return data?.result_data||{};
}
function pickName(obj){return obj?.ps_name||obj?.plant_name||obj?.name||obj?.psName||'';}
function metricFromRows(pointDict, devicePoint){
  const out={},metrics=[]; const dict=Array.isArray(pointDict)?pointDict:Object.values(pointDict||{});
  for(const meta of dict){
    const id=String(meta.point_id??meta.pointId??''); if(!id)continue; const key=`p${id}`; if(devicePoint?.[key]===undefined)continue;
    const name=meta.point_name||meta.pointName||key, unit=meta.show_unit||meta.storage_unit||meta.unit||''; const raw=devicePoint[key];
    const kind=classifyMetric(name); let val=normalizeMetricValue(raw,unit);
    if(kind==='battery_soc' && val!==null && val<=1 && String(unit).includes('%'))val*=100;
    if(kind && out[kind]===undefined && val!==null)out[kind]=val;
    metrics.push({id,name,unit,value:raw});
  }
  return {out,metrics};
}
export async function getISolarCloudData(c){
  if(!c.user||!c.password||!c.app_key||!c.secret_key) throw new SolarConnectorError('iSolarCloud exige USER, PASSWORD, APP_KEY e SECRET_KEY do Developer Portal.','CONFIG');
  const base=baseUrl(c);
  const login=await post(base,'/openapi/login',c,null,{user_account:c.user,user_password:c.password,login_type:'1'});
  if(String(login?.login_state)!=='1' || !login?.token) throw new SolarConnectorError(login?.msg||'Login iSolarCloud recusado.','AUTH',login);
  const token=login.token;
  const list=await post(base,'/openapi/getPowerStationList',c,token,{curPage:1,size:100});
  let rows=list.pageList||list.page_list||[]; if(!Array.isArray(rows))rows=[]; if(c.plant_id)rows=rows.filter(x=>String(x.ps_id??x.psId)===String(c.plant_id));
  const plants=[];
  for(const p of rows.slice(0,20)){
    const psId=String(p.ps_id??p.psId??''); let devices=[]; try{const d=await post(base,'/openapi/getDeviceList',c,token,{ps_id:psId,curPage:1,size:100});devices=d.pageList||d.page_list||[];}catch{}
    if(!Array.isArray(devices))devices=[];
    const primary={}; const deviceOut=[];
    const grouped=new Map();
    for(const d of devices){const t=Number(d.device_type??d.deviceType); if(!Number.isFinite(t))continue;if(!grouped.has(t))grouped.set(t,[]);grouped.get(t).push(d);}
    for(const [deviceType, group] of [...grouped.entries()].slice(0,8)){
      try{
        const metaRes=await post(base,'/openapi/getOpenPointInfo',c,token,{device_type:String(deviceType),type:'2',curPage:1,size:100});
        const metas=(metaRes.pageList||[]).filter(x=>classifyMetric(x.point_name||x.pointName||''));
        const pointIds=metas.map(x=>String(x.point_id??x.pointId)).filter(Boolean).slice(0,40); if(!pointIds.length)continue;
        const keys=group.map(d=>String(d.ps_key??d.psKey??'')).filter(Boolean); if(!keys.length)continue;
        const rt=await post(base,'/openapi/getDeviceRealTimeData',c,token,{device_type:deviceType,ps_key_list:keys,point_id_list:pointIds,is_get_point_dict:'1'});
        const listPoints=rt.device_point_list||rt.devicePointList||[]; const dict=rt.point_dict||rt.pointDict||metas;
        for(let i=0;i<listPoints.length;i++){
          const dp=listPoints[i], d=group[i]||{}; const m=metricFromRows(dict,dp); for(const [k,v] of Object.entries(m.out)) if(primary[k]===undefined)primary[k]=v;
          deviceOut.push({sn:d.sn||d.device_sn||'',name:d.device_name||d.dev_name||d.sn||`Dispositivo ${i+1}`,type:deviceType,status:normalizeStatus(d.device_state??d.device_status??d.status),metrics:m.out,raw:d});
        }
      }catch(e){ for(const d of group) deviceOut.push({sn:d.sn||'',name:d.device_name||d.sn||'Dispositivo',type:deviceType,status:normalizeStatus(d.device_state??d.status),error:e.message,raw:d}); }
    }
    const fallbackPower=numberOf(p.current_power??p.power??p.ps_power); const fallbackToday=numberOf(p.today_energy??p.day_energy??p.e_day); const fallbackTotal=numberOf(p.total_energy??p.e_total);
    plants.push(compactObject({
      id:psId,name:pickName(p)||c.plant||`Usina ${psId}`,status:normalizeStatus(p.ps_status??p.status),capacity_kw:numberOf(p.installed_power??p.installed_capacity??p.capacity),
      power_kw:primary.power_kw??fallbackPower,today_kwh:primary.today_kwh??fallbackToday,month_kwh:primary.month_kwh,total_kwh:primary.total_kwh??fallbackTotal,
      load_kw:primary.load_kw,grid_kw:primary.grid_kw,battery_soc:primary.battery_soc,total_devices:devices.length,online_devices:devices.filter(d=>normalizeStatus(d.device_state??d.status)==='online').length,
      devices:deviceOut,raw:{plant:p}
    }));
  }
  return {provider:'isolarcloud',source:'Sungrow iSolarCloud OpenAPI V1',plants,checked_at:new Date().toISOString()};
}
