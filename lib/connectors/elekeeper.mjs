import {
  SolarConnectorError,
  fetchWithTimeout,
  numberOf,
  normalizeStatus,
  isoFromAny,
  compactObject,
} from '../solar-utils.mjs';

const DEFAULT_BASE = 'https://intl-developer.saj-electric.com/prod-api';
const LANGUAGE = 'en_US';
const REQUEST_TIMEOUT = 20000;
const MAX_PLANTS = 30;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Accepta tanto:
 *   https://intl-developer.saj-electric.com
 * quanto:
 *   https://intl-developer.saj-electric.com/prod-api
 *
 * O OpenAPI da SAJ usa /prod-api como prefixo. Isso evita 404/502 quando
 * SOLAR_ELEKEEPER_XX_API_BASE foi configurada apenas com o host do portal.
 */
function baseUrl(c = {}) {
  let base = String(c.api_base || DEFAULT_BASE).trim().replace(/\/+$/, '');
  if (!base) base = DEFAULT_BASE;
  if (!/\/prod-api$/i.test(base)) base += '/prod-api';
  return base;
}

function apiUrl(base, path, params = {}) {
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function sajMessage(payload, fallback) {
  return String(
    payload?.msg ||
    payload?.message ||
    payload?.errMsg ||
    payload?.error ||
    fallback ||
    'Falha na API da Elekeeper.'
  ).trim();
}

function sajCode(payload) {
  if (payload?.code !== undefined && payload?.code !== null) return Number(payload.code);
  if (payload?.errCode !== undefined && payload?.errCode !== null && payload?.errCode !== '') {
    const n = Number(payload.errCode);
    return Number.isFinite(n) ? n : payload.errCode;
  }
  return null;
}

function isSuccess(payload) {
  const code = sajCode(payload);
  if (code === null) return true;
  return Number(code) === 200 || Number(code) === 0;
}

function authHint(code) {
  const n = Number(code);
  if (n === 100009) return 'APP_ID ou APP_SECRET não existem na SAJ.';
  if (n === 200014) return 'O aplicativo Elekeeper ainda não foi publicado/liberado no Open Platform.';
  if (n === 200010) return 'A SAJ não reconheceu o accessToken.';
  if (n === 200015) return 'O aplicativo não está autorizado para consultar esta usina/recurso.';
  if (n === 10004) return 'Falha de autenticação na SAJ.';
  if (n === 10005) return 'O developer não possui permissão para este recurso.';
  if (n === 10006) return 'A SAJ recusou a chamada por parâmetro inválido ou excesso de requisições.';
  return '';
}

function makeRequester(base) {
  let lastRequestAt = 0;

  return async function request(path, { params = {}, token = '', retries = 2 } = {}) {
    // A documentação pública da SAJ informa limite baixo de chamadas.
    // Um pequeno espaçamento evita respostas 10006/429 em sequência.
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < 210) await sleep(210 - elapsed);
    lastRequestAt = Date.now();

    const url = apiUrl(base, path, params);
    const headers = {
      accept: 'application/json',
      'content-language': LANGUAGE,
      'user-agent': 'SolarCentral-Elekeeper/5.0',
    };
    if (token) headers.accessToken = token;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT);
        const text = await res.text();
        let data;

        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw new SolarConnectorError(
            `Elekeeper retornou uma resposta inválida no endpoint ${path} (HTTP ${res.status}).`,
            'INVALID_JSON',
            { path, status: res.status, body: text.slice(0, 500) }
          );
        }

        if (!res.ok) {
          const message = sajMessage(data, `Elekeeper respondeu HTTP ${res.status}.`);
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attempt < retries) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw new SolarConnectorError(
            `${message} (HTTP ${res.status})`,
            res.status === 401 || res.status === 403 ? 'AUTH' : 'HTTP_ERROR',
            { path, status: res.status, response: data }
          );
        }

        // A SAJ pode devolver HTTP 200 e ainda assim informar erro no JSON.
        if (!isSuccess(data)) {
          const code = sajCode(data);
          const message = sajMessage(data, 'Falha na Elekeeper.');
          const retryable = Number(code) === 10001 || Number(code) === 10006 || Number(code) === 10016;
          if (retryable && attempt < retries) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          const hint = authHint(code);
          throw new SolarConnectorError(
            `Elekeeper: ${message}${code !== null ? ` [código ${code}]` : ''}${hint ? ` — ${hint}` : ''}`,
            [100009, 200014, 200010, 200015, 10004, 10005].includes(Number(code)) ? 'AUTH' : 'UPSTREAM',
            { path, code, response: data }
          );
        }

        return data;
      } catch (err) {
        lastError = err;
        if (err instanceof SolarConnectorError && err.code !== 'TIMEOUT') throw err;
        if (attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
      }
    }

    if (lastError instanceof SolarConnectorError) throw lastError;
    throw new SolarConnectorError(
      `Não foi possível conectar à Elekeeper no endpoint ${path}: ${lastError?.message || 'erro de rede'}.`,
      'NETWORK',
      { path }
    );
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * A SAJ/Elekeeper não mantém exatamente o mesmo envelope em todas as versões
 * do Open Platform. Dependendo da conta/endpoint, a lista pode vir em:
 * rows, data.rows, data.list, data.records, data, list, records etc.
 */
function extractRows(payload) {
  const candidates = [
    payload?.rows,
    payload?.list,
    payload?.records,
    payload?.items,
    payload?.data?.rows,
    payload?.data?.list,
    payload?.data?.records,
    payload?.data?.items,
    payload?.data?.content,
    payload?.data,
    payload?.result?.rows,
    payload?.result?.list,
    payload?.result?.records,
    payload?.result?.items,
    payload?.result,
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractTotalPages(payload, currentPage = 1, pageSize = 100, rowCount = 0) {
  const candidates = [
    payload?.totalPage,
    payload?.totalPages,
    payload?.pages,
    payload?.data?.totalPage,
    payload?.data?.totalPages,
    payload?.data?.pages,
    payload?.result?.totalPage,
    payload?.result?.totalPages,
    payload?.result?.pages,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }

  const totals = [
    payload?.total,
    payload?.totalCount,
    payload?.data?.total,
    payload?.data?.totalCount,
    payload?.result?.total,
    payload?.result?.totalCount,
  ];
  for (const value of totals) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n / pageSize));
  }

  // Se veio uma página cheia e a API não informou total, permite tentar a próxima.
  return rowCount >= pageSize ? currentPage + 1 : currentPage;
}

function plantIdOf(value = {}) {
  return String(
    value?.plantId ??
    value?.plantID ??
    value?.plant_id ??
    value?.stationId ??
    value?.stationID ??
    value?.station_id ??
    value?.id ??
    ''
  ).trim();
}

function plantNameOf(value = {}) {
  return String(
    value?.plantName ??
    value?.plant_name ??
    value?.stationName ??
    value?.station_name ??
    value?.name ??
    ''
  ).trim();
}

function getNestedData(device = {}) {
  const candidates = [
    device.inverterData,
    device.emsModuleData,
    device.electricMeterData,
    device.chargerData,
    device.batteryData,
    device.loadMonitorData,
    device.data,
  ];
  return candidates.find(v => v && typeof v === 'object' && !Array.isArray(v)) || {};
}

function deviceStatus(device = {}) {
  const nested = getNestedData(device);
  return normalizeStatus(
    device.isOnline ??
    device.online ??
    device.status ??
    nested.isOnline ??
    nested.online ??
    nested.status
  );
}

function normalizeDevice(device = {}, fallbackPlantId = '') {
  const nested = getNestedData(device);
  const sn = String(
    device.sn ||
    device.deviceSn ||
    nested.sn ||
    nested.deviceSn ||
    ''
  );

  return compactObject({
    sn,
    name: device.deviceName || nested.deviceName || device.modelType || nested.modelType || sn || 'Dispositivo',
    type: device.deviceType ?? nested.deviceType,
    model: device.modelType || nested.modelType || nested.deviceModel,
    plant_id: String(device.plantId || nested.plantId || fallbackPlantId || ''),
    status: deviceStatus(device),
    alarm: device.isAlarm ?? nested.isAlarm,
    raw: device,
  });
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function numberFrom(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    const n = numberOf(value);
    if (n !== null) return n;
  }
  return null;
}

function stringFrom(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function flattenScalars(obj, prefix = '', depth = 0, out = {}) {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenScalars(value, path, depth + 1, out);
    } else if (!Array.isArray(value)) {
      out[path] = value;
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

function metricFrom(stats = {}, details = {}) {
  const flat = { ...flattenScalars(details), ...flattenScalars(stats) };

  // powerNow é usado pela própria integração comunitária SAJ e é expresso em W.
  let powerKw = numberFrom(flat, [
    'power_kw', 'powerKw', 'currentPowerKw',
  ]);
  if (powerKw === null) {
    const powerW = numberFrom(flat, [
      'powerNow', 'pvPower', 'totalPvPower', 'totalPVPower',
      'generationPower', 'activePower', 'outputPower',
    ]);
    if (powerW !== null) powerKw = powerW / 1000;
  }

  const todayKwh = numberFrom(flat, [
    'todayPvEnergy', 'dayPvEnergy', 'todayEnergy', 'dailyEnergy',
    'dayEnergy', 'todayGeneration', 'dayGeneration',
  ]);

  const monthKwh = numberFrom(flat, [
    'monthPvEnergy', 'monthlyPvEnergy', 'monthEnergy', 'monthlyEnergy',
    'monthGeneration',
  ]);

  const yearKwh = numberFrom(flat, [
    'yearPvEnergy', 'yearEnergy', 'annualPvEnergy', 'annualEnergy',
    'yearGeneration',
  ]);

  const totalKwh = numberFrom(flat, [
    'totalPvEnergy', 'totalEnergy', 'totalGeneration', 'cumulativeEnergy',
  ]);

  const batterySoc = numberFrom(flat, [
    'batterySoc', 'batterySOC', 'batSoc', 'batSOC', 'soc',
  ]);

  return compactObject({
    power_kw: powerKw,
    today_kwh: todayKwh,
    month_kwh: monthKwh,
    year_kwh: yearKwh,
    total_kwh: totalKwh,
    battery_soc: batterySoc,
  });
}

async function getAccessToken(request, c) {
  const payload = await request('/open/api/access_token', {
    params: { appId: c.app_id_key, appSecret: c.app_secret },
  });

  const token = String(payload?.data?.access_token || '').trim();
  if (!token) {
    throw new SolarConnectorError(
      sajMessage(payload, 'A Elekeeper não retornou access_token.'),
      'AUTH',
      payload
    );
  }

  return token;
}

async function listAuthorizedPlants(request, c, token) {
  const rows = [];
  let page = 1;
  let totalPage = 1;

  do {
    const payload = await request('/open/api/developer/plant/page', {
      token,
      params: {
        appId: c.app_id_key,
        pageSize: 100,
        pageNum: page,
      },
    });

    const pageRows = extractRows(payload);
    rows.push(...pageRows);
    totalPage = extractTotalPages(payload, page, 100, pageRows.length);
    page += 1;
  } while (page <= totalPage && page <= 10);

  return rows;
}

async function listAuthorizedDevices(request, c, token) {
  const rows = [];
  let page = 1;
  let totalPage = 1;

  do {
    const payload = await request('/open/api/developer/device/page', {
      token,
      params: {
        appId: c.app_id_key,
        pageSize: 100,
        pageNum: page,
      },
    });

    const pageRows = extractRows(payload);
    rows.push(...pageRows);
    totalPage = extractTotalPages(payload, page, 100, pageRows.length);
    page += 1;
  } while (page <= totalPage && page <= 10);

  return rows;
}

function plantsFromDevices(deviceRows = []) {
  return uniqBy(
    deviceRows
      .map(d => {
        const nested = getNestedData(d);
        const plantId = plantIdOf(d) || plantIdOf(nested);
        if (!plantId) return null;
        return {
          plantId,
          plantName: plantNameOf(d) || plantNameOf(nested),
          country: d?.country || nested?.country || '',
        };
      })
      .filter(Boolean),
    p => p.plantId
  );
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getElekeeperData(c) {
  if (!c.app_id_key || !c.app_secret) {
    throw new SolarConnectorError(
      'Elekeeper exige SOLAR_ELEKEEPER_XX_APP_ID e SOLAR_ELEKEEPER_XX_APP_SECRET do Open Platform.',
      'CONFIG'
    );
  }

  const base = baseUrl(c);
  const request = makeRequester(base);
  const token = await getAccessToken(request, c);

  let plantRows = [];
  let developerDevices = [];
  let plantListError = null;

  // Caminho principal oficial: lista de usinas autorizadas ao developer.
  try {
    plantRows = await listAuthorizedPlants(request, c, token);
  } catch (err) {
    plantListError = err;
  }

  // Fallback oficial: lista de dispositivos autorizados também traz plantId/plantName.
  // Isso evita transformar em 502 um caso em que a conta consegue ler dispositivos,
  // mas a listagem de usinas está indisponível/limitada.
  if (!plantRows.length) {
    try {
      developerDevices = await listAuthorizedDevices(request, c, token);
      plantRows = plantsFromDevices(developerDevices);
    } catch {
      // O próximo fallback usa PLANT_ID explícito, se configurado.
    }
  }

  // Se o usuário informou PLANT_ID na Vercel, ele deve poder ser consultado mesmo
  // quando o endpoint de paginação de usinas falhar.
  // Normaliza nomes de campos porque algumas respostas usam stationId/id/name.
  plantRows = plantRows
    .map(row => {
      const plantId = plantIdOf(row);
      if (!plantId) return null;
      return {
        ...row,
        plantId,
        plantName: plantNameOf(row),
      };
    })
    .filter(Boolean);

  if (c.plant_id) {
    const wanted = String(c.plant_id).trim();
    const matched = plantRows.filter(p => plantIdOf(p) === wanted);
    plantRows = matched.length ? matched : [{ plantId: wanted, plantName: c.plant || c.label || `Usina ${wanted}` }];
  }

  plantRows = uniqBy(plantRows, p => plantIdOf(p)).slice(0, MAX_PLANTS);

  if (!plantRows.length && plantListError) {
    throw plantListError;
  }

  const plants = [];

  for (const row of plantRows) {
    const plantId = plantIdOf(row);
    if (!plantId) continue;

    const detailsPayload = await safeCall(() => request('/open/api/plant/details', {
      token,
      params: { plantId },
    }));

    const statsPayload = await safeCall(() => request('/open/api/plant/getPlantStatisticsData', {
      token,
      params: {
        plantId,
        clientDate: new Date().toLocaleString('sv-SE', { timeZone: 'America/Bahia' }),
      },
    }));

    let plantDeviceRows = [];
    const devicePayload = await safeCall(() => request('/open/api/plant/getPlantAllDeviceList', {
      token,
      params: { plantId, userId: '' },
    }));

    plantDeviceRows = extractRows(devicePayload);
    if (!plantDeviceRows.length) {
      // Se já temos /developer/device/page, aproveita como fallback.
      if (!developerDevices.length) {
        developerDevices = await safeCall(() => listAuthorizedDevices(request, c, token)) || [];
      }
      plantDeviceRows = developerDevices.filter(d => {
        const nested = getNestedData(d);
        return (plantIdOf(d) || plantIdOf(nested)) === plantId;
      });
    }

    const details = detailsPayload?.data && typeof detailsPayload.data === 'object' ? detailsPayload.data : {};
    const stats = statsPayload?.data && typeof statsPayload.data === 'object' ? statsPayload.data : {};
    const devices = plantDeviceRows.map(d => normalizeDevice(d, plantId));
    const metrics = metricFrom(stats, details);

    const onlineDevices = devices.filter(d => d.status === 'online').length;
    const alarmDevices = devices.filter(d => d.status === 'alarm' || Number(d.alarm) === 1).length;
    let status = 'unknown';
    if (alarmDevices > 0) status = 'alarm';
    else if (onlineDevices > 0) status = 'online';
    else if (devices.length > 0) status = 'offline';

    plants.push(compactObject({
      id: plantId,
      name: plantNameOf(row) || plantNameOf(details) || c.plant || `Usina ${plantId}`,
      status,
      capacity_kw: numberFrom(details, ['systemPower', 'capacity', 'installedCapacity']),
      ...metrics,
      city: stringFrom(details, ['city']),
      province: stringFrom(details, ['province', 'state']),
      country: stringFrom(details, ['country', 'countryName']) || row.country || '',
      address: stringFrom(details, ['fullAddress', 'address']),
      currency: stringFrom(details, ['currency', 'currencyName']),
      total_devices: devices.length,
      online_devices: onlineDevices,
      alarm_devices: alarmDevices,
      updated_at: isoFromAny(
        stats.updateTime ||
        stats.lastUpdateTime ||
        stats.dataTime ||
        stats.invTime ||
        details.updateTime
      ),
      devices,
      raw: {
        plant: row,
        details,
        stats,
      },
    }));
  }

  return {
    provider: 'elekeeper',
    source: 'SAJ Elekeeper Open Platform',
    api_base: base,
    plants,
    checked_at: new Date().toISOString(),
  };
}
