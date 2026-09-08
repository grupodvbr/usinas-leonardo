export class SolarConnectorError extends Error {
  constructor(message, code='UPSTREAM_ERROR', details=null) { super(message); this.name='SolarConnectorError'; this.code=code; this.details=details; }
}

export async function fetchWithTimeout(url, options={}, timeoutMs=20000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetch(url, {...options, signal:controller.signal}); }
  catch (err) { if (err?.name==='AbortError') throw new SolarConnectorError('Tempo limite excedido ao consultar a plataforma solar.','TIMEOUT'); throw err; }
  finally { clearTimeout(timer); }
}

export async function fetchJson(url, options={}, timeoutMs=20000) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  const text = await res.text();
  let data=null;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new SolarConnectorError(`Resposta inválida (${res.status}) recebida do provedor.`,'INVALID_JSON',text.slice(0,500)); }
  if (!res.ok) throw new SolarConnectorError(`O provedor respondeu HTTP ${res.status}.`,'HTTP_ERROR',data);
  return {res,data};
}

export function numberOf(v) {
  if (v===null || v===undefined || v==='') return null;
  if (typeof v==='number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[^0-9+-.]/g,'')); return Number.isFinite(n)?n:null;
}
export function kwFromW(v) { const n=numberOf(v); return n===null?null:n/1000; }
export function compactObject(obj) { return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==null&&v!==undefined&&v!=='')); }
export function pick(obj, keys) { for (const k of keys) if (obj && obj[k]!==undefined && obj[k]!==null && obj[k]!=='') return obj[k]; return null; }
export function isoFromAny(v) {
  if (!v) return null;
  if (typeof v==='number' || /^\d+(\.\d+)?$/.test(String(v))) {
    let n=Number(v); if(n<1e12)n*=1000; const d=new Date(n); return Number.isNaN(d.getTime())?null:d.toISOString();
  }
  const d=new Date(v); return Number.isNaN(d.getTime())?String(v):d.toISOString();
}
export function normalizeStatus(v) {
  if (v===null||v===undefined) return 'unknown';
  const s=String(v).toLowerCase();
  if (['1','online','normal','all_online','running','run','ok','true'].some(x=>s===x||s.includes(x))) return 'online';
  if (['0','offline','all_offline','false','lost'].some(x=>s===x||s.includes(x))) return 'offline';
  if (s.includes('alarm')||s.includes('fault')||s.includes('abnormal')) return 'alarm';
  return s;
}
export function summarizeDevices(devices=[]) {
  const total=devices.length, online=devices.filter(d=>normalizeStatus(d.status)==='online').length, alarms=devices.filter(d=>normalizeStatus(d.status)==='alarm').length;
  return {total_devices:total,online_devices:online,alarm_devices:alarms};
}
export function classifyMetric(name='') {
  const s=String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if ((s.includes('soc') || s.includes('state of charge')) && s.includes('battery')) return 'battery_soc';
  if (s==='soc' || s.includes('battery soc') || s.includes('battery capacity')) return 'battery_soc';
  if (s.includes('daily') && (s.includes('yield')||s.includes('energy')||s.includes('generation'))) return 'today_kwh';
  if ((s.includes('today')||s.includes('day')) && (s.includes('energy')||s.includes('generation')||s.includes('yield'))) return 'today_kwh';
  if (s.includes('month') && (s.includes('energy')||s.includes('generation')||s.includes('yield'))) return 'month_kwh';
  if ((s.includes('total')||s.includes('cumulative')) && (s.includes('energy')||s.includes('generation')||s.includes('yield'))) return 'total_kwh';
  if (s.includes('load') && s.includes('power')) return 'load_kw';
  if ((s.includes('grid')||s.includes('feed')) && s.includes('power')) return 'grid_kw';
  if ((s.includes('pv')||s.includes('generation')||s.includes('active')||s.includes('output')) && s.includes('power')) return 'power_kw';
  return null;
}
export function normalizeMetricValue(value, unit='') {
  const n=numberOf(value); if(n===null)return null; const u=String(unit).toLowerCase();
  if (u==='w' || u.includes(' watt')) return n/1000;
  if (u==='wh') return n/1000;
  return n;
}
