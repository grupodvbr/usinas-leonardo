import {
  SolarConnectorError,
  fetchWithTimeout,
  numberOf,
  normalizeStatus,
  summarizeDevices,
  isoFromAny,
  compactObject
} from '../solar-utils.mjs';

/**
 * ShinePhone / Growatt
 *
 * Modo principal:
 *   Growatt OpenAPI V1 usando SOLAR_SHINEPHONE_XX_API_TOKEN
 *
 * Fallback:
 *   Sessão web antiga usando USER + PASSWORD, caso API_TOKEN não exista.
 *
 * Para Brasil / "Other regions":
 *   https://openapi.growatt.com/v1/
 */

// -----------------------------------------------------------------------------
// Helpers gerais
// -----------------------------------------------------------------------------

function cleanBase(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function openApiBase(c) {
  const configured = cleanBase(c.api_base);

  // Se ficou configurado o servidor antigo da sessão web, NÃO use no OpenAPI.
  if (!configured || /server\.growatt\.com/i.test(configured)) {
    return 'https://openapi.growatt.com/v1/';
  }

  // Aceita https://openapi.growatt.com ou .../v1
  if (/\/v1$/i.test(configured)) return `${configured}/`;
  return `${configured}/v1/`;
}

function legacyBase(c) {
  const configured = cleanBase(c.api_base);
  if (configured && !/openapi.*growatt/i.test(configured)) return `${configured}/`;
  return 'https://server.growatt.com/';
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const n = numberOf(obj?.[key]);
    if (n !== null) return n;
  }
  return null;
}

function pickText(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function normalizeCapacityKw(value) {
  const n = numberOf(value);
  if (n === null) return null;

  // A API/contas diferentes podem expor W ou kW.
  // 75 kWp => 75; 75000 W => 75.
  return n > 1000 ? n / 1000 : n;
}

function todayLocalIsoDate() {
  // Vercel roda em UTC. Para a consulta diária da Growatt, a data civil
  // é suficiente; o endpoint da planta também devolve o timestamp real.
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}

function monthEnergyFromHistory(data) {
  const rows =
    data?.energys ??
    data?.energies ??
    data?.energy ??
    data?.list ??
    [];

  if (!Array.isArray(rows)) return null;

  const values = rows
    .map(row => numberOf(row?.energy ?? row?.value ?? row?.eTotal ?? row?.eMonth))
    .filter(Number.isFinite);

  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function latestPowerKw(powerData) {
  const rows =
    powerData?.powers ??
    powerData?.data ??
    powerData?.list ??
    [];

  if (!Array.isArray(rows) || !rows.length) return null;

  const valid = rows
    .map(row => ({
      value: numberOf(row?.power ?? row?.value),
      time: row?.time ?? row?.date ?? row?.timestamp ?? null
    }))
    .filter(row => Number.isFinite(row.value));

  if (!valid.length) return null;

  const last = valid.at(-1);

  // O endpoint /v1/plant/power documenta potência em W.
  const kw = last.value / 1000;

  // Só usamos como fallback se a leitura parece recente.
  // Evita mostrar a última potência da tarde durante a noite.
  if (last.time) {
    const parsed = new Date(last.time);
    if (!Number.isNaN(parsed.getTime())) {
      const ageMs = Math.abs(Date.now() - parsed.getTime());
      if (ageMs > 30 * 60 * 1000) return null;
    }
  }

  return kw;
}

async function readJson(res, label) {
  const text = await res.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new SolarConnectorError(
      `${label}: a Growatt não retornou JSON.`,
      'GROWATT_RESPONSE',
      text.slice(0, 600)
    );
  }

  if (!res.ok) {
    throw new SolarConnectorError(
      `${label}: Growatt respondeu HTTP ${res.status}.`,
      'GROWATT_HTTP',
      data
    );
  }

  return data;
}

// -----------------------------------------------------------------------------
// Growatt OpenAPI V1 — API Token
// -----------------------------------------------------------------------------

async function openApiGet(c, path, params = {}) {
  const base = openApiBase(c);
  const url = new URL(path.replace(/^\/+/, ''), base);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        token: c.api_token,
        accept: 'application/json',
        'user-agent': 'SolarCentral/5.0 GrowattOpenAPI'
      },
      redirect: 'follow'
    },
    25000
  );

  const json = await readJson(res, `Growatt OpenAPI /${path}`);

  const errorCode = Number(json?.error_code ?? json?.code ?? 0);
  if (errorCode !== 0) {
    throw new SolarConnectorError(
      json?.error_msg ||
        json?.message ||
        `Growatt OpenAPI recusou a chamada /${path} (código ${errorCode}).`,
      errorCode === 10004 || errorCode === 10005 ? 'AUTH' : 'GROWATT_API',
      json
    );
  }

  return json?.data ?? json;
}

async function openApiPlantList(c) {
  // O V1 aceita estes filtros/paginação.
  const data = await openApiGet(c, 'plant/list', {
    page: 1,
    perpage: 100,
    search_type: '',
    search_keyword: ''
  });

  const list =
    data?.plants ??
    data?.plant_list ??
    data?.data ??
    [];

  return Array.isArray(list) ? list : [];
}

async function openApiPlantDetails(c, plantId) {
  try {
    return await openApiGet(c, 'plant/details', { plant_id: plantId });
  } catch {
    return {};
  }
}

async function openApiPlantOverview(c, plantId) {
  return await openApiGet(c, 'plant/data', { plant_id: plantId });
}

async function openApiPlantPower(c, plantId) {
  try {
    return await openApiGet(c, 'plant/power', {
      plant_id: plantId,
      date: todayLocalIsoDate()
    });
  } catch {
    return {};
  }
}

async function openApiPlantMonthEnergy(c, plantId) {
  const today = todayLocalIsoDate();

  try {
    const data = await openApiGet(c, 'plant/energy', {
      plant_id: plantId,
      start_date: firstDayOfMonth(today),
      end_date: today,
      time_unit: 'month',
      page: 1,
      perpage: 100
    });

    return monthEnergyFromHistory(data);
  } catch {
    return null;
  }
}

async function openApiDeviceList(c, plantId) {
  try {
    const data = await openApiGet(c, 'device/list', {
      plant_id: plantId,
      page: 1,
      perpage: 100
    });

    const rows =
      data?.devices ??
      data?.device_list ??
      data?.data ??
      [];

    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function normalizeOpenApiDevices(rows = []) {
  return rows.map(d => {
    const lost =
      d?.lost === true ||
      String(d?.lost ?? '').toLowerCase() === 'true';

    let status = lost ? 'offline' : normalizeStatus(d?.status);

    // Alguns retornos vêm sem status útil, mas lost=false.
    if (status === 'unknown' && d?.lost === false) status = 'online';

    return compactObject({
      sn: pickText(d, ['device_sn', 'deviceSn', 'sn']),
      name:
        pickText(d, ['alias', 'name', 'model', 'device_model', 'deviceModel']) ||
        pickText(d, ['device_sn', 'deviceSn', 'sn']) ||
        'Dispositivo',
      type: pickText(d, ['device_type_name', 'deviceTypeName', 'type', 'device_type']),
      model: pickText(d, ['model', 'device_model', 'deviceModel']),
      datalogger_sn: pickText(d, ['datalogger_sn', 'dataloggerSn']),
      status,
      updated_at: isoFromAny(
        d?.last_update_time ??
        d?.lastUpdateTime ??
        d?.last_update ??
        null
      ),
      raw: d
    });
  });
}

function filterPlantsForCredential(plants, c) {
  let list = [...plants];

  if (c.plant_id) {
    return list.filter(
      p => String(p?.plant_id ?? p?.plantId ?? p?.id ?? '') === String(c.plant_id)
    );
  }

  // Se houver um nome configurado e existir correspondência exata,
  // usa apenas essa planta. Se não houver correspondência, NÃO zera a lista:
  // isso facilita descobrir a planta correta pelo token.
  if (c.plant && list.length > 1) {
    const wanted = String(c.plant).trim().toLowerCase();
    const matched = list.filter(p => {
      const name = pickText(p, ['name', 'plant_name', 'plantName']).toLowerCase();
      return name === wanted;
    });
    if (matched.length) list = matched;
  }

  return list;
}

async function getByOpenApiToken(c) {
  if (!c.api_token) {
    throw new SolarConnectorError(
      'Configure API_TOKEN deste acesso Growatt.',
      'CONFIG'
    );
  }

  let rawPlants = await openApiPlantList(c);
  rawPlants = filterPlantsForCredential(rawPlants, c);

  if (!rawPlants.length) {
    return {
      provider: 'shinephone',
      source: 'Growatt OpenAPI V1 (API Token)',
      plants: [],
      checked_at: new Date().toISOString(),
      note:
        'O token foi aceito, mas nenhuma usina foi retornada. Confira se o API Token está ativo e se ele pertence à conta que possui a usina.'
    };
  }

  const out = [];

  for (const p of rawPlants.slice(0, 50)) {
    const plantId = String(p?.plant_id ?? p?.plantId ?? p?.id ?? '');
    if (!plantId) continue;

    const [details, overview, powerData, monthKwh, deviceRows] =
      await Promise.all([
        openApiPlantDetails(c, plantId),
        openApiPlantOverview(c, plantId),
        openApiPlantPower(c, plantId),
        openApiPlantMonthEnergy(c, plantId),
        openApiDeviceList(c, plantId)
      ]);

    const devices = normalizeOpenApiDevices(deviceRows);
    const summary = summarizeDevices(devices);

    const overviewPowerKw = pickNumber(overview, [
      'current_power',
      'currentPower',
      'pac',
      'power'
    ]);

    const recentPowerKw = latestPowerKw(powerData);

    // /plant/data costuma expor current_power em kW.
    // /plant/power expõe a série em W.
    let powerKw = overviewPowerKw;
    if (
      recentPowerKw !== null &&
      (powerKw === null || (powerKw === 0 && recentPowerKw > 0))
    ) {
      powerKw = recentPowerKw;
    }

    const todayKwh = pickNumber(overview, [
      'today_energy',
      'todayEnergy',
      'e_day',
      'eDay'
    ]);

    const totalKwh = pickNumber(overview, [
      'total_energy',
      'totalEnergy',
      'e_total',
      'eTotal'
    ]);

    const monthFromOverview = pickNumber(overview, [
      'month_energy',
      'monthEnergy',
      'e_month',
      'eMonth'
    ]);

    const capacityKw = normalizeCapacityKw(
      details?.peak_power ??
      details?.nominal_power ??
      details?.nominalPower ??
      p?.peak_power ??
      p?.nominal_power ??
      p?.nominalPower
    );

    const lastUpdate =
      isoFromAny(
        overview?.last_update ??
        overview?.last_update_time ??
        overview?.lastUpdate ??
        overview?.lastUpdateTime ??
        details?.last_update_time ??
        null
      ) ||
      devices
        .map(d => d.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) ||
      null;

    let plantStatus = 'unknown';
    if (summary.total_devices > 0) {
      plantStatus =
        summary.alarm_devices > 0
          ? 'alarm'
          : summary.online_devices > 0
            ? 'online'
            : 'offline';
    } else if (powerKw !== null || todayKwh !== null || totalKwh !== null) {
      plantStatus = 'online';
    }

    out.push(
      compactObject({
        id: plantId,
        name:
          pickText(p, ['name', 'plant_name', 'plantName']) ||
          pickText(details, ['name', 'plant_name', 'plantName']) ||
          c.plant ||
          `Usina ${plantId}`,

        status: plantStatus,
        capacity_kw: capacityKw,
        power_kw: powerKw,
        today_kwh: todayKwh,
        month_kwh: monthFromOverview ?? monthKwh,
        total_kwh: totalKwh,

        updated_at: lastUpdate,

        total_devices: summary.total_devices,
        online_devices: summary.online_devices,
        alarm_devices: summary.alarm_devices,

        devices,

        raw: {
          plant: p,
          details,
          overview,
          power: powerData
        }
      })
    );
  }

  return {
    provider: 'shinephone',
    source: 'Growatt OpenAPI V1 (API Token)',
    plants: out,
    checked_at: new Date().toISOString(),
    note:
      'Integração oficial por API Token. O usuário e a senha do ShinePhone não são enviados quando API_TOKEN está configurado.'
  };
}

// -----------------------------------------------------------------------------
// Fallback legado — USER + PASSWORD / sessão web
// -----------------------------------------------------------------------------

function cookieHeader(headers) {
  const arr =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [];

  const raw = arr.length
    ? arr
    : [headers.get('set-cookie')].filter(Boolean);

  return raw
    .map(v => v.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function parseLegacyJson(res, label) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new SolarConnectorError(
      `${label}: o Growatt não retornou JSON. Pode haver CAPTCHA ou mudança no portal.`,
      'GROWATT_RESPONSE',
      text.slice(0, 500)
    );
  }
}

async function postForm(url, body, headers) {
  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type':
          'application/x-www-form-urlencoded; charset=UTF-8',
        accept: 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 SolarCentral/5.0',
        ...headers
      },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual'
    },
    20000
  );
}

async function getByLegacySession(c) {
  if (!c.user || !c.password) {
    throw new SolarConnectorError(
      'Configure API_TOKEN ou USER + PASSWORD deste acesso.',
      'CONFIG'
    );
  }

  const base = legacyBase(c);
  const loginUrl = new URL('login', base).toString();

  const loginRes = await postForm(
    loginUrl,
    {
      account: c.user,
      password: c.password,
      validateCode: ''
    },
    {
      origin: new URL(base).origin,
      referer: base
    }
  );

  const login = await parseLegacyJson(loginRes, 'Login');

  if (Number(login?.result) !== 1) {
    throw new SolarConnectorError(
      login?.msg ||
        login?.message ||
        'Login Growatt recusado. Use preferencialmente o API Token.',
      'AUTH',
      login
    );
  }

  const cookie = cookieHeader(loginRes.headers);

  if (!cookie) {
    throw new SolarConnectorError(
      'Growatt autenticou, mas não retornou cookie de sessão.',
      'AUTH_COOKIE'
    );
  }

  const headers = {
    cookie,
    referer: base,
    'user-agent': 'Mozilla/5.0 SolarCentral/5.0',
    accept: 'application/json, text/plain, */*'
  };

  const listRes = await fetchWithTimeout(
    new URL('index/getPlantListTitle', base),
    { headers, redirect: 'follow' },
    20000
  );

  const plantsRaw = await parseLegacyJson(
    listRes,
    'Lista de usinas'
  );

  const rawList = Array.isArray(plantsRaw)
    ? plantsRaw
    : plantsRaw?.obj?.datas ||
      plantsRaw?.data ||
      [];

  let plants = Array.isArray(rawList) ? rawList : [];

  if (c.plant_id) {
    plants = plants.filter(
      p =>
        String(p.id ?? p.plantId) ===
        String(c.plant_id)
    );
  }

  const out = [];

  for (const p of plants.slice(0, 20)) {
    const plantId = String(p.id ?? p.plantId ?? '');
    if (!plantId) continue;

    let plantData = {};
    let devices = [];

    try {
      const r = await fetchWithTimeout(
        new URL(
          `panel/getPlantData?plantId=${encodeURIComponent(plantId)}`,
          base
        ),
        { method: 'POST', headers },
        20000
      );

      const j = await parseLegacyJson(r, 'Dados da usina');
      plantData = j?.obj || j?.data || j || {};
    } catch (e) {
      plantData = { _error: e.message };
    }

    try {
      const r = await postForm(
        new URL('panel/getDevicesByPlantList', base).toString(),
        { plantId, currPage: '1' },
        headers
      );

      const j = await parseLegacyJson(r, 'Dispositivos');

      devices =
        j?.obj?.datas ||
        j?.data?.datas ||
        j?.data ||
        [];

      if (!Array.isArray(devices)) devices = [];
    } catch {
      devices = [];
    }

    const dnorm = devices.map(d => ({
      sn: d.sn || d.deviceSn || '',
      name:
        d.alias ||
        d.deviceModel ||
        d.deviceTypeName ||
        d.sn ||
        'Dispositivo',
      status: normalizeStatus(d.status),
      power_kw:
        numberOf(d.pac) !== null
          ? numberOf(d.pac) / 1000
          : null,
      today_kwh: numberOf(d.eDay),
      month_kwh: numberOf(d.eMonth),
      total_kwh: numberOf(d.eTotal),
      nominal_kw: numberOf(d.nominalPower),
      updated_at: isoFromAny(
        d.lastUpdateDateTime || d.timeServer
      ),
      type: d.deviceTypeName || d.deviceType || '',
      raw: d
    }));

    const sum = key => {
      const vals = dnorm
        .map(d => d[key])
        .filter(v => Number.isFinite(v));

      return vals.length
        ? vals.reduce((a, b) => a + b, 0)
        : null;
    };

    const summary = summarizeDevices(dnorm);

    out.push(
      compactObject({
        id: plantId,
        name:
          p.plantName ||
          plantData.plantName ||
          c.plant ||
          `Usina ${plantId}`,

        status:
          summary.online_devices > 0
            ? 'online'
            : summary.total_devices
              ? 'offline'
              : 'unknown',

        capacity_kw: numberOf(plantData.nominalPower),
        power_kw: sum('power_kw'),
        today_kwh: sum('today_kwh'),
        month_kwh: sum('month_kwh'),
        total_kwh:
          numberOf(plantData.eTotal) ??
          sum('total_kwh'),

        updated_at:
          dnorm
            .map(d => d.updated_at)
            .filter(Boolean)
            .sort()
            .at(-1) || null,

        ...summary,
        devices: dnorm,
        raw: {
          plant: p,
          plantData
        }
      })
    );
  }

  return {
    provider: 'shinephone',
    source: 'Growatt ShineServer (sessão web - fallback)',
    plants: out,
    checked_at: new Date().toISOString(),
    note:
      'Fallback por usuário/senha. Para produção, configure SOLAR_SHINEPHONE_XX_API_TOKEN.'
  };
}

// -----------------------------------------------------------------------------
// Entrada pública do conector
// -----------------------------------------------------------------------------

export async function getShinePhoneData(c) {
  // API Token SEMPRE tem prioridade.
  if (c.api_token) {
    return getByOpenApiToken(c);
  }

  return getByLegacySession(c);
}
