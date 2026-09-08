import crypto from 'node:crypto';

export const APPS = [
  {
    id: 'isolarcloud', env: 'ISOLARCLOUD', name: 'iSolarCloud', maker: 'Sungrow',
    icon: '/assets/isolarcloud.png', portal: 'https://web2.isolarcloud.com/',
    android: 'https://play.google.com/store/apps/details?id=com.isolarcloud.manager',
    ios: 'https://apps.apple.com/br/app/isolarcloud/id1050077439'
  },
  {
    id: 'shinephone', env: 'SHINEPHONE', name: 'ShinePhone', maker: 'Growatt',
    icon: '/assets/shinephone.png', portal: 'https://server.growatt.com/',
    android: 'https://play.google.com/store/apps/details?id=com.growatt.shinephones',
    ios: 'https://apps.apple.com/br/app/shinephone/id669936054'
  },
  {
    id: 'elekeeper', env: 'ELEKEEPER', name: 'elekeeper', maker: 'SAJ Electric',
    icon: '/assets/elekeeper.png', portal: 'https://iop.saj-electric.com/',
    android: 'https://play.google.com/store/apps/details?id=com.saj.home',
    ios: 'https://apps.apple.com/br/app/elekeeper-energy-management/id1623295015'
  },
  {
    id: 'solarman', env: 'SOLARMAN', name: 'SOLARMAN Smart', maker: 'IGEN Tech',
    icon: '/assets/solarman.png', portal: 'https://home.solarmanpv.com/',
    android: 'https://play.google.com/store/apps/details?id=com.igen.xiaomaizhidian',
    ios: 'https://apps.apple.com/br/app/solarman-smart/id1469487897'
  }
];

const APP_BY_ID = new Map(APPS.map(a => [a.id, a]));
const APP_BY_ENV = new Map(APPS.map(a => [a.env, a]));
const SESSION_SECONDS = 60 * 60 * 12;

export function responseJson(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'pragma': 'no-cache',
      'x-content-type-options': 'nosniff',
      ...headers,
    }
  });
}

export function onlyMethod(request, method) {
  return request.method.toUpperCase() === method.toUpperCase();
}

export function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function b64url(text) { return Buffer.from(text).toString('base64url'); }
function signingSecret() {
  const secret = env('SESSION_SECRET');
  if (!secret || secret.length < 32) return null;
  return secret;
}
function hmac(payload) {
  const secret = signingSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

export function makeSession(username) {
  const payload = b64url(JSON.stringify({
    u: String(username), exp: Date.now() + SESSION_SECONDS * 1000,
    nonce: crypto.randomBytes(16).toString('hex')
  }));
  const signature = hmac(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function readSession(request) {
  try {
    const token = parseCookies(request).solar_session;
    if (!token) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = hmac(payload);
    if (!expected) return null;
    const a = Buffer.from(signature), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Number(data.exp) < Date.now()) return null;
    return data;
  } catch { return null; }
}

export function sessionCookie(token) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `solar_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}
export function clearCookie() {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `solar_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? '')), right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
function verifyLegacyHash(password, encoded) {
  try {
    const [saltHex, hashHex] = String(encoded || '').split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex'), expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
export function dashboardConfigured() {
  return Boolean(env('DASHBOARD_USER', 'admin') && (env('DASHBOARD_PASSWORD') || env('DASHBOARD_PASSWORD_HASH')) && signingSecret());
}
export function verifyDashboard(username, password) {
  if (!safeEqual(username, env('DASHBOARD_USER', 'admin'))) return false;
  const plain = env('DASHBOARD_PASSWORD');
  return plain ? safeEqual(password, plain) : verifyLegacyHash(password, env('DASHBOARD_PASSWORD_HASH'));
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

const EXTRA_FIELDS = new Map([
  ['APP_ID', 'app_id'], ['APP_KEY', 'app_key'], ['APP_SECRET', 'app_secret'], ['SECRET_KEY', 'secret_key'],
  ['API_BASE', 'api_base'], ['PLANT_ID', 'plant_id'], ['ORG_ID', 'org_id'], ['DEVICE_SN', 'device_sn'],
  ['API_TOKEN', 'api_token'], ['REGION_CODE', 'region_code']
]);

function normalizeRecord(record = {}, fallbackApp = null, fallbackSlot = null) {
  const appIdRaw = String(record.app_id || record.app || fallbackApp || '').toLowerCase().trim();
  const aliases = { isolarcloud:'isolarcloud', sungrow:'isolarcloud', shinephone:'shinephone', growatt:'shinephone', shineserver:'shinephone', elekeeper:'elekeeper', saj:'elekeeper', solarman:'solarman', solarmansmart:'solarman' };
  const appId = aliases[appIdRaw.replace(/[^a-z0-9]/g, '')] || appIdRaw;
  const app = APP_BY_ID.get(appId);
  if (!app) return null;
  const slot = Number(record.slot ?? fallbackSlot ?? 1);
  if (!Number.isInteger(slot) || slot < 1 || slot > 999) return null;
  const out = {
    app_id: app.id, slot,
    label: String(record.label ?? '').trim(), company: String(record.company ?? '').trim(), plant: String(record.plant ?? '').trim(),
    user: String(record.user ?? record.account ?? '').trim(), password: String(record.password ?? '').trim(),
    region: String(record.region ?? '').trim(), notes: String(record.notes ?? '').trim(),
    app_id_key: String(record.app_id_key ?? record.api_app_id ?? record.appId ?? '').trim(),
    app_key: String(record.app_key ?? record.appKey ?? '').trim(), app_secret: String(record.app_secret ?? record.appSecret ?? '').trim(),
    secret_key: String(record.secret_key ?? record.secretKey ?? '').trim(), api_base: String(record.api_base ?? record.base_url ?? '').trim(),
    plant_id: String(record.plant_id ?? record.ps_id ?? '').trim(), org_id: String(record.org_id ?? '').trim(), device_sn: String(record.device_sn ?? '').trim(),
    api_token: String(record.api_token ?? '').trim(), region_code: String(record.region_code ?? '').trim(),
  };
  out.label = out.label || out.company || out.plant || `Acesso ${String(slot).padStart(2,'0')}`;
  out.complete = Boolean(out.user && out.password);
  out.integration_ready = integrationReady(out);
  return out;
}

function integrationReady(item) {
  if (item.app_id === 'shinephone') return Boolean(item.user && item.password);
  if (item.app_id === 'isolarcloud') return Boolean(item.user && item.password && item.app_key && item.secret_key);
  if (item.app_id === 'elekeeper') return Boolean(item.app_id_key && item.app_secret);
  if (item.app_id === 'solarman') return Boolean(item.user && item.password && item.app_id_key && item.app_secret);
  return false;
}

function readJsonCredentials() {
  const raw = env('SOLAR_CREDENTIALS_JSON');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw), list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.credentials) ? parsed.credentials : []);
    return list.map((item, i) => normalizeRecord(item, null, i + 1)).filter(Boolean);
  } catch { return []; }
}

function readSlotCredentials() {
  const map = new Map();
  const regex = /^SOLAR_(ISOLARCLOUD|SHINEPHONE|ELEKEEPER|SOLARMAN)_(\d{1,3})_(LABEL|COMPANY|PLANT|USER|ACCOUNT|PASSWORD|REGION|NOTES|APP_ID|APP_KEY|APP_SECRET|SECRET_KEY|API_BASE|PLANT_ID|ORG_ID|DEVICE_SN|API_TOKEN|REGION_CODE)$/;
  for (const [key, raw] of Object.entries(process.env)) {
    const m = key.match(regex); if (!m) continue;
    const [, appEnv, slotRaw, fieldRaw] = m, app = APP_BY_ENV.get(appEnv); if (!app) continue;
    const slot = Number(slotRaw), id = `${app.id}:${slot}`;
    if (!map.has(id)) map.set(id, { app_id: app.id, slot });
    const target = map.get(id);
    if (fieldRaw === 'ACCOUNT') target.user = String(raw ?? '').trim();
    else if (fieldRaw === 'APP_ID') target.app_id_key = String(raw ?? '').trim();
    else {
      const field = EXTRA_FIELDS.get(fieldRaw) || fieldRaw.toLowerCase();
      target[field] = String(raw ?? '').trim();
    }
  }
  return [...map.values()].map(x => normalizeRecord(x, x.app_id, x.slot)).filter(Boolean);
}

export function readCredentials() {
  const merged = new Map();
  for (const item of [...readJsonCredentials(), ...readSlotCredentials()]) merged.set(`${item.app_id}:${item.slot}`, item);
  const order = new Map(APPS.map((a,i)=>[a.id,i]));
  return [...merged.values()].sort((a,b)=>(order.get(a.app_id)-order.get(b.app_id)) || a.slot-b.slot);
}

function maskUser(value) {
  const text = String(value || ''); if (!text) return '';
  if (text.includes('@')) { const [name, domain] = text.split('@'); const visible = name.slice(0,2); return `${visible}${'*'.repeat(Math.max(3,name.length-visible.length))}@${domain}`; }
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0,2)}${'*'.repeat(Math.max(3,text.length-4))}${text.slice(-2)}`;
}

export function publicCredential(item) {
  const missing = integrationMissing(item);
  return {
    id:`${item.app_id}:${String(item.slot).padStart(2,'0')}`, app_id:item.app_id, slot:item.slot, label:item.label, company:item.company,
    plant:item.plant, region:item.region, notes:item.notes, account_masked:maskUser(item.user), complete:item.complete,
    integration_ready:item.integration_ready, integration_missing:missing, plant_id:item.plant_id || null,
  };
}

export function integrationMissing(item) {
  const miss=[];
  const need=(cond,name)=>{if(!cond)miss.push(name)};
  if(item.app_id==='shinephone'){ need(item.user,'USER'); need(item.password,'PASSWORD'); }
  if(item.app_id==='isolarcloud'){ need(item.user,'USER'); need(item.password,'PASSWORD'); need(item.app_key,'APP_KEY'); need(item.secret_key,'SECRET_KEY'); }
  if(item.app_id==='elekeeper'){ need(item.app_id_key,'APP_ID'); need(item.app_secret,'APP_SECRET'); }
  if(item.app_id==='solarman'){ need(item.user,'USER'); need(item.password,'PASSWORD'); need(item.app_id_key,'APP_ID'); need(item.app_secret,'APP_SECRET'); }
  return miss;
}

export function findCredential(appId, slot) { return readCredentials().find(x=>x.app_id===String(appId)&&x.slot===Number(slot)) || null; }
export function findApp(appId) { return APP_BY_ID.get(String(appId)) || null; }

export async function portalStatus(app) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),3500), started=Date.now();
  try {
    const res = await fetch(app.portal,{method:'HEAD',redirect:'follow',signal:controller.signal,headers:{'user-agent':'SolarCentral/4.0'}});
    return {id:app.id,online:res.status<500,status:res.status,ms:Date.now()-started};
  } catch {
    try { const res=await fetch(app.portal,{method:'GET',redirect:'follow',signal:controller.signal,headers:{'user-agent':'SolarCentral/4.0'}}); return {id:app.id,online:res.status<500,status:res.status,ms:Date.now()-started}; }
    catch { return {id:app.id,online:false,status:0,ms:Date.now()-started}; }
  } finally { clearTimeout(timer); }
}
