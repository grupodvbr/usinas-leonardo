import crypto from 'node:crypto';

/* =========================================================
   OTTO SOLAR • PERSISTÊNCIA SUPABASE
   =========================================================
   Segunda saída de persistência, independente do Google Apps Script.
   Nunca envia credenciais das integrações solares.

   Vercel ENV:
   SUPABASE_URL=https://SEU-PROJETO.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
   SUPABASE_SAVE_TIMEOUT=20000
   ========================================================= */

function clean(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function config() {
  return {
    url: clean(process.env.SUPABASE_URL).replace(/\/+$/, ''),
    key: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    timeoutMs: Math.max(3000, Number(process.env.SUPABASE_SAVE_TIMEOUT || 20000))
  };
}

function headers(key, prefer = 'return=minimal') {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json; charset=utf-8',
    prefer
  };
}

async function request(path, { method = 'POST', body, prefer } = {}) {
  const { url, key, timeoutMs } = config();
  const response = await fetchWithTimeout(`${url}/rest/v1/${path}`, {
    method,
    headers: headers(key, prefer),
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);

  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text || null; }

  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.error || `Supabase respondeu HTTP ${response.status}`);
    error.status = response.status;
    error.response = parsed;
    throw error;
  }

  return { status: response.status, body: parsed };
}

export function supabaseStorageConfigured() {
  const { url, key } = config();
  return Boolean(url && key);
}

function buildRows({ checkedAt, results = [], runId }) {
  const rows = [];

  for (const item of Array.isArray(results) ? results : []) {
    const integration = item?.integration || {};
    const plants = Array.isArray(item?.plants) ? item.plants : [];

    for (const plant of plants) {
      rows.push({
        run_id: runId,
        captured_at: checkedAt || new Date().toISOString(),
        provider_checked_at: item?.checked_at || checkedAt || null,
        provider: clean(integration?.provider),
        provider_name: clean(integration?.provider_name),
        slot: numberOrNull(integration?.slot),
        label: clean(integration?.label),
        company: clean(integration?.company),
        source: clean(item?.source),
        station_id: clean(plant?.id),
        station_name: clean(plant?.name),
        status: clean(plant?.status, 'unknown'),
        capacity_kw: numberOrNull(plant?.capacity_kw),
        power_kw: numberOrNull(plant?.power_kw),
        today_kwh: numberOrNull(plant?.today_kwh),
        month_kwh: numberOrNull(plant?.month_kwh),
        year_kwh: numberOrNull(plant?.year_kwh),
        total_kwh: numberOrNull(plant?.total_kwh),
        revenue_today_brl: numberOrNull(plant?.revenue_today_brl),
        revenue_month_brl: numberOrNull(plant?.revenue_month_brl),
        revenue_year_brl: numberOrNull(plant?.revenue_year_brl),
        revenue_total_brl: numberOrNull(plant?.revenue_total_brl),
        total_devices: numberOrNull(plant?.total_devices),
        online_devices: numberOrNull(plant?.online_devices),
        offline_devices: numberOrNull(plant?.offline_devices),
        alarm_devices: numberOrNull(plant?.alarm_devices),
        updated_at: plant?.updated_at || null,
        saved_at: new Date().toISOString()
      });
    }
  }

  return rows;
}

export async function saveMonitorToSupabase({ checkedAt, results = [], summary = {} }) {
  if (!supabaseStorageConfigured()) {
    return { ok: false, skipped: true, reason: 'SUPABASE_NOT_CONFIGURED' };
  }

  const runId = `${checkedAt || new Date().toISOString()}-${crypto.randomUUID()}`;
  const rows = buildRows({ checkedAt, results, runId });
  const savedAt = new Date().toISOString();

  try {
    if (rows.length) {
      await request('solar_usinas_producao', { body: rows });

      await request('solar_usinas_atual?on_conflict=provider,slot,station_id', {
        body: rows,
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }

    const log = {
      run_id: runId,
      captured_at: checkedAt || new Date().toISOString(),
      saved_at: savedAt,
      rows_received: rows.length,
      rows_saved_history: rows.length,
      rows_updated_current: rows.length,
      integrations_total: numberOrNull(summary?.integrations_total) || 0,
      integrations_ok: numberOrNull(summary?.integrations_ok) || 0,
      integrations_failed: numberOrNull(summary?.integrations_failed) || 0,
      plants_total: numberOrNull(summary?.plants_total) || 0,
      plants_online: numberOrNull(summary?.plants_online) || 0,
      plants_offline: numberOrNull(summary?.plants_offline) || 0,
      plants_alarm: numberOrNull(summary?.plants_alarm) || 0,
      alerts_attempted: numberOrNull(summary?.alerts_attempted) || 0,
      alerts_sent: numberOrNull(summary?.alerts_sent) || 0,
      alerts_failed: numberOrNull(summary?.alerts_failed) || 0,
      duration_ms: numberOrNull(summary?.duration_ms) || 0
    };

    await request('solar_sync_log', { body: [log] });

    return {
      ok: true,
      skipped: false,
      rows: rows.length,
      rows_saved_history: rows.length,
      rows_updated_current: rows.length,
      run_id: runId
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      rows: rows.length,
      run_id: runId,
      status: error?.status || null,
      error: error?.name === 'AbortError'
        ? 'Timeout salvando dados no Supabase.'
        : (error?.message || 'Falha salvando dados no Supabase.')
    };
  }
}
