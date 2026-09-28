import crypto from 'node:crypto';

/* =========================================================
   OTTO SOLAR • PERSISTÊNCIA GOOGLE APPS SCRIPT
   =========================================================
   Envia SOMENTE dados operacionais normalizados das usinas.
   Nunca envia credenciais das integrações.

   Vercel ENV:
   GAS_WEB_APP_URL=https://script.google.com/macros/s/SEU_DEPLOY/exec
   GAS_SHARED_SECRET=um-segredo-grande-e-aleatorio
   GAS_SAVE_TIMEOUT=20000
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

export function gasStorageConfigured() {
  return Boolean(clean(process.env.GAS_WEB_APP_URL) && clean(process.env.GAS_SHARED_SECRET));
}

export async function saveMonitorToGas({ checkedAt, results = [], summary = {} }) {
  const url = clean(process.env.GAS_WEB_APP_URL);
  const secret = clean(process.env.GAS_SHARED_SECRET);
  const timeoutMs = Math.max(3000, Number(process.env.GAS_SAVE_TIMEOUT || 20000));

  if (!url || !secret) {
    return {
      ok: false,
      skipped: true,
      reason: 'GAS_NOT_CONFIGURED'
    };
  }

  const runId = `${checkedAt || new Date().toISOString()}-${crypto.randomUUID()}`;
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
        updated_at: plant?.updated_at || null
      });
    }
  }

  const payload = {
    action: 'save_solar_snapshot',
    secret,
    run_id: runId,
    captured_at: checkedAt || new Date().toISOString(),
    timezone: 'America/Bahia',
    summary,
    rows
  };

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'OTTO-Solar-Vercel/1.0'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }, timeoutMs);

    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 1000) }; }

    if (!response.ok || body?.ok === false) {
      return {
        ok: false,
        skipped: false,
        status: response.status,
        rows: rows.length,
        error: body?.error || `GAS respondeu HTTP ${response.status}`,
        response: body
      };
    }

    return {
      ok: true,
      skipped: false,
      status: response.status,
      rows: rows.length,
      run_id: runId,
      response: body
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      rows: rows.length,
      error: error?.name === 'AbortError'
        ? 'Timeout salvando dados no Google Apps Script.'
        : (error?.message || 'Falha salvando dados no Google Apps Script.')
    };
  }
}
