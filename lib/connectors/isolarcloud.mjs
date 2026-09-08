import {
  SolarConnectorError,
  fetchJson,
  numberOf,
  normalizeStatus,
  compactObject,
  classifyMetric,
  normalizeMetricValue
} from '../solar-utils.mjs';

/**
 * ============================================================================
 * iSOLARCLOUD / SUNGROW - OPENAPI V1
 * ============================================================================
 *
 * Variáveis esperadas por acesso:
 *
 * SOLAR_ISOLARCLOUD_01_USER
 * SOLAR_ISOLARCLOUD_01_PASSWORD
 * SOLAR_ISOLARCLOUD_01_APP_KEY
 * SOLAR_ISOLARCLOUD_01_SECRET_KEY
 *
 * Opcionais:
 * SOLAR_ISOLARCLOUD_01_LABEL
 * SOLAR_ISOLARCLOUD_01_COMPANY
 * SOLAR_ISOLARCLOUD_01_PLANT
 * SOLAR_ISOLARCLOUD_01_PLANT_ID
 * SOLAR_ISOLARCLOUD_01_API_BASE
 *
 * O token NÃO precisa ser salvo na Vercel.
 *
 * O fluxo é:
 *
 * USER + PASSWORD + APP_KEY + SECRET_KEY
 *              ↓
 *       /openapi/login
 *              ↓
 *        TOKEN TEMPORÁRIO
 *              ↓
 *     CONSULTA DAS USINAS
 *
 * ============================================================================
 */

const DEFAULT_BASE_URL = 'https://gateway.isolarcloud.com.hk';
const REQUEST_TIMEOUT_MS = 25000;
const MAX_PLANTS = 50;
const MAX_DEVICE_TYPES = 12;
const MAX_POINTS_PER_TYPE = 60;

const POINT_META_CACHE_TTL_MS = 30 * 60 * 1000;

/*
 * Cache em memória.
 *
 * Na Vercel ele pode sobreviver enquanto a Function estiver "quente".
 * Isso reduz chamadas repetidas ao getOpenPointInfo.
 */
const pointMetaCache = new Map();


/* ============================================================================
   URL BASE
============================================================================ */

function baseUrl(c) {
  return String(
    c.api_base ||
    DEFAULT_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');
}


/* ============================================================================
   HELPERS
============================================================================ */

function pickText(obj, keys) {
  if (!obj) {
    return '';
  }

  for (const key of keys) {
    const value = obj?.[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return String(value).trim();
    }
  }

  return '';
}


function pickNumber(obj, keys) {
  if (!obj) {
    return null;
  }

  for (const key of keys) {
    const value = numberOf(
      obj?.[key]
    );

    if (value !== null) {
      return value;
    }
  }

  return null;
}


function pickName(obj) {
  return pickText(
    obj,
    [
      'ps_name',
      'plant_name',
      'name',
      'psName'
    ]
  );
}


function pickPlantId(obj) {
  return pickText(
    obj,
    [
      'ps_id',
      'psId',
      'plant_id',
      'plantId',
      'id'
    ]
  );
}


function pickDeviceKey(obj) {
  return pickText(
    obj,
    [
      'ps_key',
      'psKey'
    ]
  );
}


function pickDeviceSn(obj) {
  return pickText(
    obj,
    [
      'sn',
      'device_sn',
      'deviceSn',
      'dev_sn',
      'devSn'
    ]
  );
}


function pickDeviceName(
  obj,
  index = 0
) {
  return (
    pickText(
      obj,
      [
        'device_name',
        'deviceName',
        'dev_name',
        'devName',
        'name',
        'model'
      ]
    ) ||

    pickDeviceSn(obj) ||

    `Dispositivo ${index + 1}`
  );
}


/* ============================================================================
   CONVERSÕES
============================================================================ */

function normalizeCapacityKw(value) {
  const n = numberOf(value);

  if (n === null) {
    return null;
  }

  /*
   * Algumas contas retornam W,
   * outras retornam kW.
   */
  if (n > 1000) {
    return n / 1000;
  }

  return n;
}


function normalizePowerKw(
  value,
  unit = ''
) {
  let n = numberOf(value);

  if (n === null) {
    return null;
  }

  const u = String(unit || '')
    .trim()
    .toLowerCase();

  if (
    u === 'w' ||
    u.endsWith(' w')
  ) {
    return n / 1000;
  }

  if (
    u === 'mw' ||
    u.endsWith(' mw')
  ) {
    return n * 1000;
  }

  return n;
}


function normalizeEnergyKwh(
  value,
  unit = ''
) {
  let n = numberOf(value);

  if (n === null) {
    return null;
  }

  const u = String(unit || '')
    .trim()
    .toLowerCase();

  if (
    u === 'wh' ||
    u.endsWith(' wh')
  ) {
    return n / 1000;
  }

  if (
    u === 'mwh' ||
    u.endsWith(' mwh')
  ) {
    return n * 1000;
  }

  return n;
}


function normalizeSoc(
  value,
  unit = ''
) {
  let n = numberOf(value);

  if (n === null) {
    return null;
  }

  const u = String(unit || '');

  /*
   * Algumas respostas usam:
   *
   * 0.65 = 65%
   */
  if (
    u.includes('%') &&
    n >= 0 &&
    n <= 1
  ) {
    n *= 100;
  }

  return n;
}


function normalizeMetricByKind(
  kind,
  raw,
  unit
) {
  const generic =
    normalizeMetricValue(
      raw,
      unit
    );

  if (
    generic === null ||
    generic === undefined
  ) {
    return null;
  }

  switch (kind) {

    case 'power_kw':
    case 'load_kw':
    case 'grid_kw':
    case 'pv_power_kw':
    case 'battery_power_kw':

      return normalizePowerKw(
        generic,
        unit
      );


    case 'today_kwh':
    case 'month_kwh':
    case 'year_kwh':
    case 'total_kwh':
    case 'charge_kwh':
    case 'discharge_kwh':

      return normalizeEnergyKwh(
        generic,
        unit
      );


    case 'battery_soc':

      return normalizeSoc(
        generic,
        unit
      );


    default:

      return generic;
  }
}


/* ============================================================================
   INTERPRETAÇÃO DOS PONTOS DE MEDIÇÃO
============================================================================ */

function metricFromRows(
  pointDict,
  devicePoint
) {
  const out = {};
  const metrics = [];

  const dict =
    Array.isArray(pointDict)
      ? pointDict
      : Object.values(
          pointDict || {}
        );


  for (const meta of dict) {

    const id = String(
      meta?.point_id ??
      meta?.pointId ??
      ''
    );

    if (!id) {
      continue;
    }


    const key =
      `p${id}`;


    if (
      devicePoint?.[key] ===
      undefined
    ) {
      continue;
    }


    const name =
      meta?.point_name ||
      meta?.pointName ||
      key;


    const unit =
      meta?.show_unit ||
      meta?.storage_unit ||
      meta?.unit ||
      '';


    const raw =
      devicePoint[key];


    const kind =
      classifyMetric(
        name
      );


    const value =
      kind
        ? normalizeMetricByKind(
            kind,
            raw,
            unit
          )
        : normalizeMetricValue(
            raw,
            unit
          );


    /*
     * Salva o primeiro valor identificado
     * de cada categoria.
     */
    if (
      kind &&
      out[kind] === undefined &&
      value !== null &&
      value !== undefined
    ) {
      out[kind] =
        value;
    }


    metrics.push(
      compactObject({
        id,
        key,
        name,
        unit,

        value:
          raw,

        normalized_value:
          value,

        kind:
          kind ||
          undefined
      })
    );
  }


  return {
    out,
    metrics
  };
}


/* ============================================================================
   STATUS DOS DISPOSITIVOS
============================================================================ */

function summarizeDeviceStatuses(
  devices
) {
  let online = 0;
  let offline = 0;
  let alarm = 0;
  let unknown = 0;


  for (const d of devices) {

    const status =
      normalizeStatus(
        d?.device_state ??
        d?.device_status ??
        d?.status
      );


    if (
      status === 'online'
    ) {
      online++;
    }

    else if (
      status === 'offline'
    ) {
      offline++;
    }

    else if (
      status === 'alarm'
    ) {
      alarm++;
    }

    else {
      unknown++;
    }
  }


  return {

    total_devices:
      devices.length,

    online_devices:
      online,

    offline_devices:
      offline,

    alarm_devices:
      alarm,

    unknown_devices:
      unknown
  };
}


/* ============================================================================
   STATUS DA USINA
============================================================================ */

function normalizePlantStatus(
  rawStatus,
  deviceSummary,
  powerKw,
  todayKwh
) {
  const normalized =
    normalizeStatus(
      rawStatus
    );


  if (
    normalized !== 'unknown'
  ) {
    return normalized;
  }


  if (
    deviceSummary.alarm_devices > 0
  ) {
    return 'alarm';
  }


  if (
    deviceSummary.online_devices > 0
  ) {
    return 'online';
  }


  if (
    Number.isFinite(
      powerKw
    ) &&
    powerKw > 0
  ) {
    return 'online';
  }


  if (
    Number.isFinite(
      todayKwh
    ) &&
    todayKwh > 0
  ) {
    return 'online';
  }


  if (
    deviceSummary.total_devices > 0 &&
    deviceSummary.online_devices === 0
  ) {
    return 'offline';
  }


  return 'unknown';
}


/* ============================================================================
   ERROS DE TOKEN
============================================================================ */

function isTokenError(data) {

  const code =
    String(
      data?.result_code ??
      ''
    );


  const msg =
    String(
      data?.result_msg ??
      ''
    )
      .toLowerCase();


  return (
    code === 'E900' ||
    msg.includes('token') ||
    msg.includes('unauthorized')
  );
}


function upstreamError(
  data,
  path
) {
  return new SolarConnectorError(

    data?.result_msg ||

    `iSolarCloud result_code=${data?.result_code} em ${path}`,

    isTokenError(data)
      ? 'AUTH'
      : 'UPSTREAM',

    data
  );
}


/* ============================================================================
   POST BASE DA API
============================================================================ */

async function rawPost(
  base,
  path,
  c,
  token,
  payload = {}
) {

  const body = {

    appkey:
      c.app_key,

    lang:
      '_en_US',

    ...payload
  };


  /*
   * O login NÃO recebe token.
   *
   * Demais endpoints recebem.
   */
  if (
    token &&
    payload?.user_password === undefined
  ) {
    body.token =
      token;
  }


  const headers = {

    'content-type':
      'application/json',

    'user-agent':
      'SolarCentral/6.0 iSolarCloud',

    'x-access-key':
      c.secret_key,

    sys_code:
      '901'
  };


  if (token) {
    headers.token =
      token;
  }


  let response;


  try {

    response =
      await fetchJson(

        `${base}${path}`,

        {
          method:
            'POST',

          headers,

          body:
            JSON.stringify(
              body
            )
        },

        REQUEST_TIMEOUT_MS
      );

  }

  catch (error) {

    if (
      error instanceof
      SolarConnectorError
    ) {
      throw error;
    }


    throw new SolarConnectorError(

      `Falha ao comunicar com iSolarCloud em ${path}: ${
        error?.message ||
        error
      }`,

      'NETWORK',

      null
    );
  }


  /*
   * Compatibilidade com o fetchJson
   * já existente no seu projeto.
   */
  const data =
    response?.data ??
    response;


  if (
    !data ||
    typeof data !== 'object'
  ) {

    throw new SolarConnectorError(

      `iSolarCloud retornou resposta inválida em ${path}.`,

      'UPSTREAM_RESPONSE',

      data ??
      null
    );
  }


  return data;
}


/* ============================================================================
   LOGIN
============================================================================ */

async function doLogin(
  base,
  c
) {

  const data =
    await rawPost(

      base,

      '/openapi/login',

      c,

      null,

      {

        user_account:
          c.user,

        user_password:
          c.password,

        login_type:
          '1'
      }
    );


  if (
    String(
      data?.result_code
    ) !== '1'
  ) {

    throw upstreamError(
      data,
      '/openapi/login'
    );
  }


  const result =
    data?.result_data ||
    {};


  if (
    String(
      result?.login_state
    ) !== '1' ||
    !result?.token
  ) {

    throw new SolarConnectorError(

      result?.msg ||
      data?.result_msg ||
      'Login iSolarCloud recusado.',

      'AUTH',

      {

        login_state:
          result?.login_state ??
          null,

        result_code:
          data?.result_code ??
          null,

        result_msg:
          data?.result_msg ??
          null
      }
    );
  }


  return String(
    result.token
  );
}


/* ============================================================================
   CLIENTE DA API

   Faz login automático novamente se o token expirar.
============================================================================ */

function createClient(
  base,
  c
) {

  let token = null;


  async function login() {

    token =
      await doLogin(
        base,
        c
      );

    return token;
  }


  async function post(
    path,
    payload = {},
    allowRelogin = true
  ) {

    if (!token) {
      await login();
    }


    let data =
      await rawPost(

        base,

        path,

        c,

        token,

        payload
      );


    /*
     * TOKEN EXPIRADO:
     *
     * tenta login novamente apenas uma vez.
     */
    if (
      String(
        data?.result_code
      ) !== '1' &&

      allowRelogin &&

      isTokenError(
        data
      )
    ) {

      await login();


      data =
        await rawPost(

          base,

          path,

          c,

          token,

          payload
        );
    }


    if (
      String(
        data?.result_code
      ) !== '1'
    ) {

      throw upstreamError(
        data,
        path
      );
    }


    return (
      data?.result_data ||
      {}
    );
  }


  return {

    login,

    post
  };
}


/* ============================================================================
   LISTA DE USINAS
============================================================================ */

async function getPowerStations(
  client
) {

  const rows = [];

  let page = 1;


  /*
   * Máximo 10 páginas como proteção.
   */
  while (
    page <= 10
  ) {

    const result =
      await client.post(

        '/openapi/getPowerStationList',

        {
          curPage:
            page,

          size:
            100
        }
      );


    const pageList =

      result?.pageList ??

      result?.page_list ??

      [];


    if (
      !Array.isArray(
        pageList
      )
    ) {
      break;
    }


    rows.push(
      ...pageList
    );


    if (
      pageList.length < 100
    ) {
      break;
    }


    const rowCount =
      numberOf(

        result?.rowCount ??

        result?.row_count
      );


    if (
      rowCount !== null &&
      rows.length >= rowCount
    ) {
      break;
    }


    page++;
  }


  return rows;
}


/* ============================================================================
   DISPOSITIVOS DA USINA
============================================================================ */

async function getDevices(
  client,
  psId
) {

  const rows = [];

  let page = 1;


  while (
    page <= 10
  ) {

    const result =
      await client.post(

        '/openapi/getDeviceList',

        {

          ps_id:
            psId,

          curPage:
            page,

          size:
            100
        }
      );


    const pageList =

      result?.pageList ??

      result?.page_list ??

      [];


    if (
      !Array.isArray(
        pageList
      )
    ) {
      break;
    }


    rows.push(
      ...pageList
    );


    if (
      pageList.length < 100
    ) {
      break;
    }


    const rowCount =
      numberOf(

        result?.rowCount ??

        result?.row_count
      );


    if (
      rowCount !== null &&
      rows.length >= rowCount
    ) {
      break;
    }


    page++;
  }


  return rows;
}


/* ============================================================================
   CACHE DOS PONTOS
============================================================================ */

function pointCacheKey(
  base,
  deviceType
) {

  return (
    `${base}|${deviceType}`
  );
}


function getCachedPointMeta(
  base,
  deviceType
) {

  const key =
    pointCacheKey(
      base,
      deviceType
    );


  const row =
    pointMetaCache.get(
      key
    );


  if (!row) {
    return null;
  }


  if (
    Date.now() -
      row.savedAt >
    POINT_META_CACHE_TTL_MS
  ) {

    pointMetaCache.delete(
      key
    );

    return null;
  }


  return row.value;
}


function setCachedPointMeta(
  base,
  deviceType,
  value
) {

  pointMetaCache.set(

    pointCacheKey(
      base,
      deviceType
    ),

    {

      savedAt:
        Date.now(),

      value
    }
  );
}


/* ============================================================================
   METADADOS DOS PONTOS DE MEDIÇÃO
============================================================================ */

async function getOpenPointInfo(
  client,
  base,
  deviceType
) {

  const cached =
    getCachedPointMeta(
      base,
      deviceType
    );


  if (cached) {
    return cached;
  }


  const rows = [];

  let page = 1;


  while (
    page <= 10
  ) {

    const result =
      await client.post(

        '/openapi/getOpenPointInfo',

        {

          device_type:
            String(
              deviceType
            ),

          type:
            '2',

          curPage:
            page,

          size:
            100
        }
      );


    const pageList =
      result?.pageList ||
      [];


    if (
      !Array.isArray(
        pageList
      )
    ) {
      break;
    }


    rows.push(
      ...pageList
    );


    const rowCount =
      numberOf(
        result?.rowCount
      );


    if (
      !pageList.length ||

      pageList.length < 100 ||

      (
        rowCount !== null &&
        rows.length >= rowCount
      )
    ) {
      break;
    }


    page++;
  }


  setCachedPointMeta(

    base,

    deviceType,

    rows
  );


  return rows;
}


/* ============================================================================
   SELECIONA APENAS PONTOS ÚTEIS

   Evita pedir centenas de dados desnecessários.
============================================================================ */

function selectRelevantPoints(
  rows
) {

  const scored = [];


  for (const row of rows) {

    const name =

      row?.point_name ||

      row?.pointName ||

      '';


    const kind =
      classifyMetric(
        name
      );


    if (!kind) {
      continue;
    }


    const id =
      String(

        row?.point_id ??

        row?.pointId ??

        ''
      );


    if (!id) {
      continue;
    }


    scored.push({

      id,

      row,

      kind
    });
  }


  const seen =
    new Set();


  const result =
    [];


  for (
    const item of scored
  ) {

    if (
      seen.has(
        item.id
      )
    ) {
      continue;
    }


    seen.add(
      item.id
    );


    result.push(
      item.row
    );


    if (
      result.length >=
      MAX_POINTS_PER_TYPE
    ) {
      break;
    }
  }


  return result;
}


/* ============================================================================
   AGRUPA DISPOSITIVOS PELO TIPO
============================================================================ */

function groupDevicesByType(
  devices
) {

  const grouped =
    new Map();


  for (
    const device of devices
  ) {

    const type =
      Number(

        device?.device_type ??

        device?.deviceType
      );


    if (
      !Number.isFinite(
        type
      )
    ) {
      continue;
    }


    if (
      !grouped.has(
        type
      )
    ) {

      grouped.set(
        type,
        []
      );
    }


    grouped
      .get(type)
      .push(
        device
      );
  }


  return grouped;
}


/* ============================================================================
   RELACIONA TELEMETRIA COM DISPOSITIVO
============================================================================ */

function matchRealtimeRowsToDevices(
  group,
  listPoints
) {

  const byKey =
    new Map();


  for (
    const d of group
  ) {

    const key =
      pickDeviceKey(
        d
      );


    if (key) {
      byKey.set(
        key,
        d
      );
    }
  }


  return listPoints.map(
    (
      dp,
      index
    ) => {

      const responseKey =
        pickText(
          dp,
          [
            'ps_key',
            'psKey'
          ]
        );


      return {

        device:

          (
            responseKey &&
            byKey.get(
              responseKey
            )
          ) ||

          group[index] ||

          {},


        pointData:
          dp
      };
    }
  );
}


/* ============================================================================
   DADOS EM TEMPO REAL POR TIPO DE EQUIPAMENTO
============================================================================ */

async function collectRealtimeForType(

  client,

  base,

  deviceType,

  group

) {

  const metasAll =
    await getOpenPointInfo(

      client,

      base,

      deviceType
    );


  const metas =
    selectRelevantPoints(
      metasAll
    );


  const pointIds =
    metas

      .map(
        meta =>
          String(

            meta?.point_id ??

            meta?.pointId ??

            ''
          )
      )

      .filter(Boolean)

      .slice(
        0,
        MAX_POINTS_PER_TYPE
      );


  const keys =
    group

      .map(
        pickDeviceKey
      )

      .filter(Boolean);


  /*
   * Se não existem pontos reconhecidos,
   * ainda retornamos os equipamentos.
   */
  if (
    !pointIds.length ||
    !keys.length
  ) {

    return {

      primaryMetrics:
        {},

      devices:
        group.map(
          (
            d,
            index
          ) =>
            compactObject({

              sn:
                pickDeviceSn(
                  d
                ),

              name:
                pickDeviceName(
                  d,
                  index
                ),

              type:
                deviceType,

              status:
                normalizeStatus(

                  d?.device_state ??

                  d?.device_status ??

                  d?.status
                ),

              raw:
                d
            })
        )
    };
  }


  const rt =
    await client.post(

      '/openapi/getDeviceRealTimeData',

      {

        device_type:
          deviceType,

        ps_key_list:
          keys,

        point_id_list:
          pointIds,

        is_get_point_dict:
          '1'
      }
    );


  const listPoints =

    rt?.device_point_list ??

    rt?.devicePointList ??

    [];


  const pointDict =

    rt?.point_dict ??

    rt?.pointDict ??

    metas;


  if (
    !Array.isArray(
      listPoints
    )
  ) {

    return {

      primaryMetrics:
        {},

      devices:
        []
    };
  }


  const primaryMetrics =
    {};


  const deviceOut =
    [];


  const matched =
    matchRealtimeRowsToDevices(

      group,

      listPoints
    );


  for (
    let index = 0;

    index < matched.length;

    index++
  ) {

    const {
      device,
      pointData
    } =
      matched[index];


    const metricResult =
      metricFromRows(

        pointDict,

        pointData
      );


    for (
      const [
        key,
        value
      ] of Object.entries(
        metricResult.out
      )
    ) {

      if (
        primaryMetrics[key] ===
          undefined &&

        value !== null &&

        value !== undefined
      ) {

        primaryMetrics[key] =
          value;
      }
    }


    deviceOut.push(

      compactObject({

        sn:
          pickDeviceSn(
            device
          ),

        ps_key:
          pickDeviceKey(
            device
          ),

        name:
          pickDeviceName(
            device,
            index
          ),

        type:
          deviceType,

        status:
          normalizeStatus(

            device?.device_state ??

            device?.device_status ??

            device?.status
          ),

        metrics:
          metricResult.out,

        metric_points:
          metricResult.metrics,

        raw:
          device
      })
    );
  }


  return {

    primaryMetrics,

    devices:
      deviceOut
  };
}


/* ============================================================================
   JUNTA AS MÉTRICAS PRINCIPAIS
============================================================================ */

function mergePrimaryMetrics(
  target,
  source
) {

  for (
    const [
      key,
      value
    ] of Object.entries(
      source || {}
    )
  ) {

    if (
      target[key] ===
        undefined &&

      value !== null &&

      value !== undefined
    ) {

      target[key] =
        value;
    }
  }
}


/* ============================================================================
   FILTRO DE USINA
============================================================================ */

function filterPlants(
  rows,
  c
) {

  let result =
    [...rows];


  /*
   * PLANT_ID é o método mais preciso.
   */
  if (c.plant_id) {

    return result.filter(

      row =>

        String(
          pickPlantId(
            row
          )
        ) ===

        String(
          c.plant_id
        )
    );
  }


  /*
   * Se houver mais de uma usina,
   * tenta selecionar pelo nome exato.
   */
  if (
    c.plant &&
    result.length > 1
  ) {

    const wanted =
      String(
        c.plant
      )
        .trim()
        .toLowerCase();


    const exact =
      result.filter(

        row =>

          pickName(
            row
          )
            .trim()
            .toLowerCase() ===
          wanted
      );


    if (
      exact.length
    ) {

      result =
        exact;
    }
  }


  return result;
}


/* ============================================================================
   FALLBACK DE MÉTRICAS DA PRÓPRIA USINA
============================================================================ */

function fallbackPlantMetrics(
  p
) {

  return {

    power_kw:

      normalizePowerKw(

        pickNumber(
          p,
          [
            'current_power',
            'currentPower',
            'power',
            'ps_power',
            'psPower'
          ]
        ),

        pickText(
          p,
          [
            'power_unit',
            'powerUnit'
          ]
        )
      ),


    today_kwh:

      normalizeEnergyKwh(

        pickNumber(
          p,
          [
            'today_energy',
            'todayEnergy',
            'day_energy',
            'dayEnergy',
            'e_day',
            'eDay'
          ]
        ),

        pickText(
          p,
          [
            'energy_unit',
            'energyUnit'
          ]
        )
      ),


    month_kwh:

      normalizeEnergyKwh(

        pickNumber(
          p,
          [
            'month_energy',
            'monthEnergy',
            'monthly_energy',
            'e_month',
            'eMonth'
          ]
        ),

        pickText(
          p,
          [
            'energy_unit',
            'energyUnit'
          ]
        )
      ),


    year_kwh:

      normalizeEnergyKwh(

        pickNumber(
          p,
          [
            'year_energy',
            'yearEnergy',
            'yearly_energy',
            'e_year',
            'eYear'
          ]
        ),

        pickText(
          p,
          [
            'energy_unit',
            'energyUnit'
          ]
        )
      ),


    total_kwh:

      normalizeEnergyKwh(

        pickNumber(
          p,
          [
            'total_energy',
            'totalEnergy',
            'e_total',
            'eTotal'
          ]
        ),

        pickText(
          p,
          [
            'energy_unit',
            'energyUnit'
          ]
        )
      )
  };
}


/* ============================================================================
   FUNÇÃO PRINCIPAL
============================================================================ */

export async function getISolarCloudData(c) {

  /*
   * ============================================================
   * CONFERE CREDENCIAIS
   * ============================================================
   */

  if (!c.user) {

    throw new SolarConnectorError(

      'Configure USER deste acesso iSolarCloud.',

      'CONFIG'
    );
  }


  if (!c.password) {

    throw new SolarConnectorError(

      'Configure PASSWORD deste acesso iSolarCloud.',

      'CONFIG'
    );
  }


  if (!c.app_key) {

    throw new SolarConnectorError(

      'Configure APP_KEY do Developer Portal iSolarCloud.',

      'CONFIG'
    );
  }


  if (!c.secret_key) {

    throw new SolarConnectorError(

      'Configure SECRET_KEY do Developer Portal iSolarCloud.',

      'CONFIG'
    );
  }


  /*
   * ============================================================
   * CRIA CLIENTE
   * ============================================================
   */

  const base =
    baseUrl(c);


  const client =
    createClient(
      base,
      c
    );


  /*
   * ============================================================
   * LOGIN
   *
   * O TOKEN É GERADO AQUI AUTOMATICAMENTE.
   * ============================================================
   */

  await client.login();


  /*
   * ============================================================
   * USINAS
   * ============================================================
   */

  let rows =
    await getPowerStations(
      client
    );


  rows =
    filterPlants(
      rows,
      c
    );


  const plants =
    [];


  /*
   * ============================================================
   * PROCESSA CADA USINA
   * ============================================================
   */

  for (
    const p of
      rows.slice(
        0,
        MAX_PLANTS
      )
  ) {

    const psId =
      pickPlantId(
        p
      );


    if (!psId) {
      continue;
    }


    /*
     * ==========================================================
     * DISPOSITIVOS
     * ==========================================================
     */

    let devices =
      [];


    try {

      devices =
        await getDevices(
          client,
          psId
        );

    }

    catch {

      devices =
        [];
    }


    if (
      !Array.isArray(
        devices
      )
    ) {

      devices =
        [];
    }


    /*
     * ==========================================================
     * TELEMETRIA
     * ==========================================================
     */

    const primary =
      {};


    const deviceOut =
      [];


    const grouped =
      groupDevicesByType(
        devices
      );


    const groups =
      [
        ...grouped.entries()
      ]
        .slice(
          0,
          MAX_DEVICE_TYPES
        );


    for (
      const [
        deviceType,
        group
      ] of groups
    ) {

      try {

        const collected =
          await collectRealtimeForType(

            client,

            base,

            deviceType,

            group
          );


        mergePrimaryMetrics(

          primary,

          collected.primaryMetrics
        );


        deviceOut.push(
          ...collected.devices
        );

      }

      catch (error) {

        /*
         * Se falhar a telemetria daquele tipo,
         * não derruba a usina inteira.
         */
        for (
          let index = 0;
          index < group.length;
          index++
        ) {

          const d =
            group[index];


          deviceOut.push(

            compactObject({

              sn:
                pickDeviceSn(
                  d
                ),

              ps_key:
                pickDeviceKey(
                  d
                ),

              name:
                pickDeviceName(
                  d,
                  index
                ),

              type:
                deviceType,

              status:
                normalizeStatus(

                  d?.device_state ??

                  d?.device_status ??

                  d?.status
                ),

              error:
                error?.message ||
                'Falha ao consultar telemetria.',

              raw:
                d
            })
          );
        }
      }
    }


    /*
     * ==========================================================
     * GARANTE QUE TODOS OS EQUIPAMENTOS APAREÇAM
     * ==========================================================
     */

    const typedKeys =
      new Set(

        deviceOut

          .map(
            d =>
              d.ps_key ||
              d.sn
          )

          .filter(Boolean)
      );


    for (
      let index = 0;

      index < devices.length;

      index++
    ) {

      const d =
        devices[index];


      const key =
        pickDeviceKey(
          d
        ) ||
        pickDeviceSn(
          d
        );


      if (
        key &&
        typedKeys.has(
          key
        )
      ) {
        continue;
      }


      deviceOut.push(

        compactObject({

          sn:
            pickDeviceSn(
              d
            ),

          ps_key:
            pickDeviceKey(
              d
            ),

          name:
            pickDeviceName(
              d,
              index
            ),

          type:

            d?.device_type ??

            d?.deviceType ??

            undefined,

          status:
            normalizeStatus(

              d?.device_state ??

              d?.device_status ??

              d?.status
            ),

          raw:
            d
        })
      );
    }


    /*
     * ==========================================================
     * MÉTRICAS DA PRÓPRIA USINA
     * ==========================================================
     */

    const fallback =
      fallbackPlantMetrics(
        p
      );


    const statusSummary =
      summarizeDeviceStatuses(
        devices
      );


    /*
     * ==========================================================
     * POTÊNCIA
     * ==========================================================
     */

    const powerKw =

      primary.power_kw ??

      primary.pv_power_kw ??

      fallback.power_kw;


    /*
     * ==========================================================
     * GERAÇÃO HOJE
     * ==========================================================
     */

    const todayKwh =

      primary.today_kwh ??

      fallback.today_kwh;


    /*
     * ==========================================================
     * GERAÇÃO MÊS
     * ==========================================================
     */

    const monthKwh =

      primary.month_kwh ??

      fallback.month_kwh;


    /*
     * ==========================================================
     * GERAÇÃO ANO
     * ==========================================================
     */

    const yearKwh =

      primary.year_kwh ??

      fallback.year_kwh;


    /*
     * ==========================================================
     * GERAÇÃO TOTAL
     * ==========================================================
     */

    const totalKwh =

      primary.total_kwh ??

      fallback.total_kwh;


    /*
     * ==========================================================
     * CAPACIDADE INSTALADA
     * ==========================================================
     */

    const capacityKw =
      normalizeCapacityKw(

        p?.installed_power ??

        p?.installedPower ??

        p?.installed_capacity ??

        p?.installedCapacity ??

        p?.capacity ??

        p?.rated_power ??

        p?.ratedPower
      );


    /*
     * ==========================================================
     * STATUS
     * ==========================================================
     */

    const status =
      normalizePlantStatus(

        p?.ps_status ??

        p?.psStatus ??

        p?.status,

        statusSummary,

        powerKw,

        todayKwh
      );


    /*
     * ==========================================================
     * RESULTADO DA USINA
     * ==========================================================
     */

    plants.push(

      compactObject({

        id:
          psId,


        name:

          pickName(
            p
          ) ||

          c.plant ||

          `Usina ${psId}`,


        status,


        capacity_kw:
          capacityKw,


        power_kw:
          powerKw,


        today_kwh:
          todayKwh,


        month_kwh:
          monthKwh,


        year_kwh:
          yearKwh,


        total_kwh:
          totalKwh,


        /*
         * Consumo
         */
        load_kw:
          primary.load_kw,


        /*
         * Rede
         */
        grid_kw:
          primary.grid_kw,


        /*
         * Bateria
         */
        battery_soc:
          primary.battery_soc,


        battery_power_kw:
          primary.battery_power_kw,


        /*
         * Equipamentos
         */
        total_devices:
          statusSummary.total_devices,


        online_devices:
          statusSummary.online_devices,


        offline_devices:
          statusSummary.offline_devices,


        alarm_devices:
          statusSummary.alarm_devices,


        unknown_devices:
          statusSummary.unknown_devices,


        devices:
          deviceOut,


        /*
         * Mantemos somente os dados da usina.
         *
         * Não colocamos token,
         * senha,
         * APP KEY ou SECRET KEY.
         */
        raw: {

          plant:
            p
        }
      })
    );
  }


  /*
   * ============================================================
   * RESPOSTA FINAL
   * ============================================================
   */

  return {

    provider:
      'isolarcloud',


    source:
      'Sungrow iSolarCloud OpenAPI V1',


    plants,


    checked_at:
      new Date()
        .toISOString(),


    note:
      'O token do iSolarCloud é gerado automaticamente pelo backend usando USER, PASSWORD, APP_KEY e SECRET_KEY.'
  };
}
