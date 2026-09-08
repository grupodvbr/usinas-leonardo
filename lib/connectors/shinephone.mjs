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
 * ============================================================================
 * SHINEPHONE / GROWATT
 * ============================================================================
 *
 * MÉTODO PRINCIPAL:
 * Growatt OpenAPI V1 usando API Token.
 *
 * Variável Vercel:
 * SOLAR_SHINEPHONE_01_API_TOKEN
 *
 * MÉTODO ALTERNATIVO:
 * USER + PASSWORD pela sessão web antiga do ShineServer.
 *
 * Esta versão prioriza:
 * - estabilidade;
 * - poucas chamadas à Growatt;
 * - evitar payloads gigantes;
 * - evitar rate limit;
 * - remover dispositivos duplicados;
 * - dados reais da planta;
 * - geração hoje;
 * - geração no mês;
 * - geração total;
 * - potência atual;
 * - capacidade instalada;
 * - status;
 * - inversores/dispositivos;
 *
 * ============================================================================
 */


/* ============================================================================
   CONFIGURAÇÃO DE URL
============================================================================ */

function cleanBase(value = '') {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}


function openApiBase(c) {
  const configured = cleanBase(c.api_base);

  /*
   * Se estiver configurado o antigo server.growatt.com,
   * não devemos utilizá-lo para OpenAPI.
   */
  if (
    !configured ||
    /server\.growatt\.com/i.test(configured)
  ) {
    return 'https://openapi.growatt.com/v1/';
  }

  /*
   * Permite configurar:
   *
   * https://openapi.growatt.com
   *
   * ou
   *
   * https://openapi.growatt.com/v1
   */
  if (/\/v1$/i.test(configured)) {
    return `${configured}/`;
  }

  return `${configured}/v1/`;
}


function legacyBase(c) {
  const configured = cleanBase(c.api_base);

  if (
    configured &&
    !/openapi.*growatt/i.test(configured)
  ) {
    return `${configured}/`;
  }

  return 'https://server.growatt.com/';
}


/* ============================================================================
   HELPERS
============================================================================ */

function pickNumber(obj, keys) {
  if (!obj) return null;

  for (const key of keys) {
    const value = numberOf(obj?.[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}


function pickText(obj, keys) {
  if (!obj) return '';

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


function normalizeCapacityKw(value) {
  const n = numberOf(value);

  if (n === null) {
    return null;
  }

  /*
   * Algumas contas retornam capacidade em kW,
   * outras podem retornar W.
   */
  if (n > 1000) {
    return n / 1000;
  }

  return n;
}


function todayIso() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function firstDayOfMonth(dateString) {
  return `${dateString.slice(0, 7)}-01`;
}


function safeIso(value) {
  if (!value) return null;

  try {
    return isoFromAny(value);
  } catch {
    return null;
  }
}


/* ============================================================================
   RESPOSTA HTTP / JSON
============================================================================ */

async function readJson(res, label) {
  const text = await res.text();

  let data = {};

  try {
    data = text
      ? JSON.parse(text)
      : {};
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


/* ============================================================================
   GROWATT OPENAPI
============================================================================ */

async function openApiGet(c, path, params = {}) {
  if (!c.api_token) {
    throw new SolarConnectorError(
      'API Token Growatt não configurado.',
      'CONFIG'
    );
  }

  const base = openApiBase(c);

  const url = new URL(
    path.replace(/^\/+/, ''),
    base
  );

  Object.entries(params)
    .forEach(([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === ''
      ) {
        return;
      }

      url.searchParams.set(
        key,
        String(value)
      );
    });

  const res = await fetchWithTimeout(
    url.toString(),
    {
      method: 'GET',

      headers: {
        token: c.api_token,

        accept:
          'application/json',

        'user-agent':
          'SolarCentral/6.0 GrowattOpenAPI'
      },

      redirect: 'follow'
    },
    25000
  );

  const json = await readJson(
    res,
    `Growatt OpenAPI /${path}`
  );

  /*
   * Growatt OpenAPI:
   *
   * error_code = 0
   * significa sucesso.
   */
  const errorCode = Number(
    json?.error_code ??
    json?.code ??
    0
  );

  if (errorCode !== 0) {
    let code = 'GROWATT_API';

    if (
      errorCode === 10004 ||
      errorCode === 10005
    ) {
      code = 'AUTH';
    }

    if (
      errorCode === 10012 ||
      /frequent/i.test(
        String(json?.error_msg || '')
      )
    ) {
      code = 'RATE_LIMIT';
    }

    throw new SolarConnectorError(
      json?.error_msg ||
        json?.message ||
        `Growatt retornou erro ${errorCode}.`,
      code,
      json
    );
  }

  return json?.data ?? json;
}


/* ============================================================================
   LISTA DE PLANTAS
============================================================================ */

async function getPlantList(c) {
  const data = await openApiGet(
    c,
    'plant/list',
    {
      page: 1,
      perpage: 100
    }
  );

  const rows =
    data?.plants ??
    data?.plant_list ??
    data?.list ??
    data?.data ??
    [];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows;
}


/* ============================================================================
   DETALHES DA PLANTA
============================================================================ */

async function getPlantDetails(
  c,
  plantId
) {
  try {
    return await openApiGet(
      c,
      'plant/details',
      {
        plant_id: plantId
      }
    );
  } catch {
    return {};
  }
}


/* ============================================================================
   DADOS PRINCIPAIS DA PLANTA
============================================================================ */

async function getPlantOverview(
  c,
  plantId
) {
  return await openApiGet(
    c,
    'plant/data',
    {
      plant_id: plantId
    }
  );
}


/* ============================================================================
   POTÊNCIA DO DIA

   Só usamos quando plant/data NÃO fornece current_power.
   Isso evita uma chamada desnecessária para cada atualização.
============================================================================ */

async function getPlantPower(
  c,
  plantId
) {
  try {
    return await openApiGet(
      c,
      'plant/power',
      {
        plant_id: plantId,
        date: todayIso()
      }
    );
  } catch {
    return {};
  }
}


function latestPowerKw(powerData) {
  const rows =
    powerData?.powers ??
    powerData?.data ??
    powerData?.list ??
    [];

  if (
    !Array.isArray(rows) ||
    !rows.length
  ) {
    return null;
  }

  /*
   * O Growatt não necessariamente entrega a série
   * ordenada.
   */
  const values = rows
    .map(row => {
      const power = numberOf(
        row?.power ??
        row?.value
      );

      if (power === null) {
        return null;
      }

      return {
        power,
        time:
          row?.time ??
          row?.date ??
          null
      };
    })
    .filter(Boolean);

  if (!values.length) {
    return null;
  }

  values.sort((a, b) => {
    return String(a.time || '')
      .localeCompare(
        String(b.time || '')
      );
  });

  const latest = values.at(-1);

  /*
   * /plant/power retorna potência em W.
   */
  return latest.power / 1000;
}


/* ============================================================================
   ENERGIA DO MÊS

   ATENÇÃO:
   No JSON real da sua conta a Growatt retorna:

   monthly_energy

   portanto este valor é usado diretamente.

   Só chamamos /plant/energy se ele não existir.
============================================================================ */

async function getMonthEnergy(
  c,
  plantId
) {
  const today = todayIso();

  try {
    const data = await openApiGet(
      c,
      'plant/energy',
      {
        plant_id: plantId,
        start_date:
          firstDayOfMonth(today),

        end_date: today,

        time_unit: 'month',

        page: 1,

        perpage: 100
      }
    );

    const rows =
      data?.energys ??
      data?.energies ??
      data?.energy ??
      data?.list ??
      [];

    if (Array.isArray(rows)) {
      const values = rows
        .map(row =>
          numberOf(
            row?.energy ??
            row?.value ??
            row?.eMonth
          )
        )
        .filter(Number.isFinite);

      if (values.length) {
        return values.reduce(
          (total, value) =>
            total + value,
          0
        );
      }
    }

    return pickNumber(
      data,
      [
        'monthly_energy',
        'month_energy',
        'energy'
      ]
    );
  } catch {
    return null;
  }
}


/* ============================================================================
   DISPOSITIVOS
============================================================================ */

async function getDeviceList(
  c,
  plantId
) {
  try {
    const data = await openApiGet(
      c,
      'device/list',
      {
        plant_id: plantId,
        page: 1,
        perpage: 100
      }
    );

    const rows =
      data?.devices ??
      data?.device_list ??
      data?.list ??
      data?.data ??
      [];

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows;
  } catch {
    return [];
  }
}


/* ============================================================================
   STATUS DISPOSITIVO
============================================================================ */

function deviceStatus(d) {
  /*
   * No JSON real Growatt:
   *
   * lost: true
   *
   * significa comunicação perdida.
   */
  if (
    d?.lost === true ||
    String(d?.lost)
      .toLowerCase() === 'true'
  ) {
    return 'offline';
  }

  const normalized =
    normalizeStatus(
      d?.status
    );

  if (
    normalized === 'unknown' &&
    d?.lost === false
  ) {
    return 'online';
  }

  return normalized;
}


/* ============================================================================
   NORMALIZAÇÃO DOS DISPOSITIVOS
============================================================================ */

function normalizeDevice(d) {
  return compactObject({
    sn:
      pickText(
        d,
        [
          'device_sn',
          'deviceSn',
          'sn'
        ]
      ),

    name:
      pickText(
        d,
        [
          'alias',
          'name',
          'device_name',
          'model',
          'device_model'
        ]
      ) ||
      pickText(
        d,
        [
          'device_sn',
          'deviceSn',
          'sn'
        ]
      ) ||
      'Dispositivo',

    type:
      pickText(
        d,
        [
          'device_type_name',
          'deviceTypeName',
          'type',
          'device_type'
        ]
      ),

    model:
      pickText(
        d,
        [
          'model',
          'device_model',
          'deviceModel'
        ]
      ),

    datalogger_sn:
      pickText(
        d,
        [
          'datalogger_sn',
          'dataloggerSn'
        ]
      ),

    status:
      deviceStatus(d),

    updated_at:
      safeIso(
        d?.last_update_time ??
        d?.lastUpdateTime ??
        d?.last_update
      ),

    raw: d
  });
}


/* ============================================================================
   REMOVE DISPOSITIVOS DUPLICADOS

   No JSON que você mostrou, por exemplo:

   QFETDCA02B

   aparece:
   type 1
   type 4

   mas é o mesmo equipamento.

   Daremos preferência ao type 4 (MAX).
============================================================================ */

function deduplicateDevices(
  devices
) {
  const map = new Map();

  for (const device of devices) {
    const key =
      device.sn ||
      `${device.name}-${device.datalogger_sn}`;

    if (!map.has(key)) {
      map.set(
        key,
        device
      );

      continue;
    }

    const previous =
      map.get(key);

    const previousType =
      Number(previous.type);

    const currentType =
      Number(device.type);

    /*
     * Growatt type 4 = MAX
     */
    if (
      currentType === 4 &&
      previousType !== 4
    ) {
      map.set(
        key,
        device
      );

      continue;
    }

    /*
     * Se um estiver online,
     * preservamos o online.
     */
    if (
      device.status === 'online' &&
      previous.status !== 'online'
    ) {
      map.set(
        key,
        device
      );
    }
  }

  return Array.from(
    map.values()
  );
}


/* ============================================================================
   FILTRO DA PLANTA
============================================================================ */

function filterPlants(
  plants,
  c
) {
  let list = [...plants];

  /*
   * PLANT_ID tem prioridade absoluta.
   */
  if (c.plant_id) {
    return list.filter(p => {
      const id =
        p?.plant_id ??
        p?.plantId ??
        p?.id;

      return (
        String(id) ===
        String(c.plant_id)
      );
    });
  }

  /*
   * Se o nome cadastrado na Vercel
   * corresponder exatamente,
   * selecionamos essa planta.
   */
  if (
    c.plant &&
    list.length > 1
  ) {
    const wanted =
      String(c.plant)
        .trim()
        .toLowerCase();

    const matches =
      list.filter(p => {
        const name =
          pickText(
            p,
            [
              'name',
              'plant_name',
              'plantName'
            ]
          )
            .toLowerCase();

        return name === wanted;
      });

    if (matches.length) {
      list = matches;
    }
  }

  return list;
}


/* ============================================================================
   STATUS DA PLANTA
============================================================================ */

function determinePlantStatus({
  devices,
  powerKw,
  todayKwh,
  overview,
  plant
}) {
  const summary =
    summarizeDevices(
      devices
    );

  if (
    summary.total_devices > 0
  ) {
    if (
      summary.alarm_devices > 0
    ) {
      return 'alarm';
    }

    if (
      summary.online_devices > 0
    ) {
      return 'online';
    }

    /*
     * Todos os dispositivos com lost=true
     */
    return 'offline';
  }

  /*
   * Se não temos dispositivos,
   * mas recebemos telemetria atual,
   * consideramos online.
   */
  if (
    Number.isFinite(powerKw) &&
    powerKw > 0
  ) {
    return 'online';
  }

  if (
    Number.isFinite(todayKwh) &&
    todayKwh > 0
  ) {
    return 'online';
  }

  /*
   * Não vamos interpretar diretamente
   * plant.status porque os códigos variam
   * entre versões da API.
   */
  return 'unknown';
}


/* ============================================================================
   OPENAPI PRINCIPAL
============================================================================ */

async function getByApiToken(c) {
  if (!c.api_token) {
    throw new SolarConnectorError(
      'Configure SOLAR_SHINEPHONE_XX_API_TOKEN.',
      'CONFIG'
    );
  }

  let plants =
    await getPlantList(c);

  plants =
    filterPlants(
      plants,
      c
    );

  if (!plants.length) {
    return {
      provider:
        'shinephone',

      source:
        'Growatt OpenAPI V1',

      plants: [],

      checked_at:
        new Date().toISOString(),

      note:
        'O API Token foi aceito, mas nenhuma usina foi encontrada.'
    };
  }

  const result = [];

  /*
   * Limite defensivo.
   */
  for (
    const plant of
      plants.slice(0, 50)
  ) {
    const plantId =
      String(
        plant?.plant_id ??
        plant?.plantId ??
        plant?.id ??
        ''
      );

    if (!plantId) {
      continue;
    }

    /*
     * Estas três chamadas são suficientes
     * para quase tudo.
     */
    const [
      details,
      overview,
      deviceRows
    ] =
      await Promise.all([
        getPlantDetails(
          c,
          plantId
        ),

        getPlantOverview(
          c,
          plantId
        ),

        getDeviceList(
          c,
          plantId
        )
      ]);

    /*
     * ==============================
     * DISPOSITIVOS
     * ==============================
     */

    let devices =
      deviceRows.map(
        normalizeDevice
      );

    devices =
      deduplicateDevices(
        devices
      );

    const summary =
      summarizeDevices(
        devices
      );


    /*
     * ==============================
     * POTÊNCIA ATUAL
     * ==============================
     *
     * Seu JSON real possui:
     *
     * current_power
     */

    let powerKw =
      pickNumber(
        overview,
        [
          'current_power',
          'currentPower',
          'pac',
          'power'
        ]
      );

    /*
     * Somente se plant/data não fornecer
     * potência, chamamos plant/power.
     */
    if (powerKw === null) {
      const powerData =
        await getPlantPower(
          c,
          plantId
        );

      powerKw =
        latestPowerKw(
          powerData
        );
    }


    /*
     * ==============================
     * ENERGIA HOJE
     * ==============================
     */

    const todayKwh =
      pickNumber(
        overview,
        [
          'today_energy',
          'todayEnergy',
          'e_day',
          'eDay'
        ]
      );


    /*
     * ==============================
     * ENERGIA MÊS
     * ==============================
     *
     * IMPORTANTE:
     *
     * Seu JSON retorna:
     *
     * monthly_energy
     */

    let monthKwh =
      pickNumber(
        overview,
        [
          'monthly_energy',
          'month_energy',
          'monthEnergy',
          'e_month',
          'eMonth'
        ]
      );

    /*
     * Só chama o histórico se
     * monthly_energy não veio.
     */
    if (monthKwh === null) {
      monthKwh =
        await getMonthEnergy(
          c,
          plantId
        );
    }


    /*
     * ==============================
     * ENERGIA ANO
     * ==============================
     */

    const yearKwh =
      pickNumber(
        overview,
        [
          'yearly_energy',
          'year_energy',
          'yearEnergy',
          'e_year',
          'eYear'
        ]
      );


    /*
     * ==============================
     * ENERGIA TOTAL
     * ==============================
     */

    const totalKwh =
      pickNumber(
        overview,
        [
          'total_energy',
          'totalEnergy',
          'e_total',
          'eTotal'
        ]
      ) ??
      pickNumber(
        plant,
        [
          'total_energy',
          'totalEnergy'
        ]
      );


    /*
     * ==============================
     * CAPACIDADE
     * ==============================
     */

    const capacityKw =
      normalizeCapacityKw(
        details?.peak_power ??
        overview?.peak_power_actual ??
        plant?.peak_power ??
        details?.nominal_power ??
        plant?.nominal_power
      );


    /*
     * ==============================
     * ÚLTIMA ATUALIZAÇÃO
     * ==============================
     */

    const updatedAt =
      safeIso(
        overview?.last_update_time ??
        overview?.last_update ??
        overview?.lastUpdateTime
      ) ||
      devices
        .map(
          d =>
            d.updated_at
        )
        .filter(Boolean)
        .sort()
        .at(-1) ||
      null;


    /*
     * ==============================
     * STATUS
     * ==============================
     */

    const status =
      determinePlantStatus({
        devices,
        powerKw,
        todayKwh,
        overview,
        plant
      });


    /*
     * ==============================
     * LOCALIZAÇÃO
     * ==============================
     */

    const city =
      pickText(
        details,
        ['city']
      ) ||
      pickText(
        plant,
        ['city']
      );

    const country =
      pickText(
        details,
        ['country']
      ) ||
      pickText(
        plant,
        ['country']
      );

    const timezone =
      pickText(
        details,
        ['timezone']
      ) ||
      pickText(
        overview,
        ['timezone']
      );


    /*
     * ==============================
     * DATALOGGERS
     * ==============================
     */

    const dataloggers =
      Array.isArray(
        details?.dataloggers
      )
        ? details.dataloggers
        : [];


    /*
     * ==============================
     * RESULTADO
     * ==============================
     */

    result.push(
      compactObject({
        id:
          plantId,

        name:
          pickText(
            plant,
            [
              'name',
              'plant_name',
              'plantName'
            ]
          ) ||
          pickText(
            details,
            ['name']
          ) ||
          c.plant ||
          `Usina ${plantId}`,

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

        updated_at:
          updatedAt,

        city,

        country,

        timezone,

        latitude:
          numberOf(
            details?.latitude ??
            plant?.latitude
          ),

        longitude:
          numberOf(
            details?.longitude ??
            plant?.longitude
          ),

        total_devices:
          summary.total_devices,

        online_devices:
          summary.online_devices,

        offline_devices:
          summary.total_devices -
          summary.online_devices,

        alarm_devices:
          summary.alarm_devices,

        devices,

        dataloggers,

        /*
         * IMPORTANTE:
         *
         * NÃO colocamos a série inteira de
         * plant/power dentro de raw.
         *
         * Isso evita respostas gigantes,
         * lentidão e possíveis 502 na Vercel.
         */
        raw: {
          plant,
          details,
          overview
        }
      })
    );
  }

  return {
    provider:
      'shinephone',

    source:
      'Growatt OpenAPI V1 (API Token)',

    plants:
      result,

    checked_at:
      new Date().toISOString(),

    note:
      'Integração Growatt usando API Token oficial.'
  };
}


/* ============================================================================
   FALLBACK — LOGIN WEB ANTIGO
============================================================================ */

function cookieHeader(headers) {
  const array =
    typeof headers.getSetCookie ===
      'function'
      ? headers.getSetCookie()
      : [];

  const raw =
    array.length
      ? array
      : [
          headers.get(
            'set-cookie'
          )
        ].filter(Boolean);

  return raw
    .map(
      value =>
        value.split(';')[0]
    )
    .filter(Boolean)
    .join('; ');
}


async function parseLegacyJson(
  res,
  label
) {
  const text =
    await res.text();

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new SolarConnectorError(
      `${label}: Growatt não retornou JSON. Pode haver CAPTCHA.`,
      'GROWATT_RESPONSE',
      text.slice(0, 500)
    );
  }
}


async function postForm(
  url,
  body,
  headers
) {
  return fetchWithTimeout(
    url,
    {
      method: 'POST',

      headers: {
        'content-type':
          'application/x-www-form-urlencoded; charset=UTF-8',

        accept:
          'application/json, text/plain, */*',

        'user-agent':
          'Mozilla/5.0 SolarCentral/6.0',

        ...headers
      },

      body:
        new URLSearchParams(
          body
        ).toString(),

      redirect:
        'manual'
    },
    20000
  );
}


async function getByLegacySession(c) {
  if (
    !c.user ||
    !c.password
  ) {
    throw new SolarConnectorError(
      'Configure API_TOKEN ou USER + PASSWORD.',
      'CONFIG'
    );
  }

  const base =
    legacyBase(c);

  const loginUrl =
    new URL(
      'login',
      base
    ).toString();

  const loginRes =
    await postForm(
      loginUrl,

      {
        account:
          c.user,

        password:
          c.password,

        validateCode:
          ''
      },

      {
        origin:
          new URL(base).origin,

        referer:
          base
      }
    );

  const login =
    await parseLegacyJson(
      loginRes,
      'Login Growatt'
    );

  if (
    Number(
      login?.result
    ) !== 1
  ) {
    throw new SolarConnectorError(
      login?.msg ||
        login?.message ||
        'Login Growatt recusado.',
      'AUTH',
      login
    );
  }

  const cookie =
    cookieHeader(
      loginRes.headers
    );

  if (!cookie) {
    throw new SolarConnectorError(
      'Growatt não retornou cookie de sessão.',
      'AUTH_COOKIE'
    );
  }

  const headers = {
    cookie,

    referer:
      base,

    'user-agent':
      'Mozilla/5.0 SolarCentral/6.0',

    accept:
      'application/json, text/plain, */*'
  };


  /*
   * LISTA DE PLANTAS
   */

  const listRes =
    await fetchWithTimeout(
      new URL(
        'index/getPlantListTitle',
        base
      ),

      {
        headers,
        redirect: 'follow'
      },

      20000
    );

  const plantsRaw =
    await parseLegacyJson(
      listRes,
      'Lista de usinas'
    );

  const rawList =
    Array.isArray(
      plantsRaw
    )
      ? plantsRaw
      : (
          plantsRaw?.obj?.datas ||
          plantsRaw?.data ||
          []
        );

  let plants =
    Array.isArray(
      rawList
    )
      ? rawList
      : [];


  if (c.plant_id) {
    plants =
      plants.filter(
        plant =>
          String(
            plant?.id ??
            plant?.plantId
          ) ===
          String(
            c.plant_id
          )
      );
  }


  const result = [];


  for (
    const plant of
      plants.slice(0, 20)
  ) {
    const plantId =
      String(
        plant?.id ??
        plant?.plantId ??
        ''
      );

    if (!plantId) {
      continue;
    }


    let plantData = {};

    let devicesRaw = [];


    /*
     * DADOS DA PLANTA
     */

    try {
      const res =
        await fetchWithTimeout(
          new URL(
            `panel/getPlantData?plantId=${encodeURIComponent(
              plantId
            )}`,
            base
          ),

          {
            method: 'POST',
            headers
          },

          20000
        );

      const json =
        await parseLegacyJson(
          res,
          'Dados da usina'
        );

      plantData =
        json?.obj ||
        json?.data ||
        json ||
        {};
    } catch (error) {
      plantData = {
        _error:
          error.message
      };
    }


    /*
     * DISPOSITIVOS
     */

    try {
      const res =
        await postForm(
          new URL(
            'panel/getDevicesByPlantList',
            base
          ).toString(),

          {
            plantId,
            currPage: '1'
          },

          headers
        );

      const json =
        await parseLegacyJson(
          res,
          'Dispositivos'
        );

      devicesRaw =
        json?.obj?.datas ||
        json?.data?.datas ||
        json?.data ||
        [];

      if (
        !Array.isArray(
          devicesRaw
        )
      ) {
        devicesRaw = [];
      }
    } catch {
      devicesRaw = [];
    }


    let devices =
      devicesRaw.map(
        device => {
          return compactObject({
            sn:
              device?.sn ||
              device?.deviceSn ||
              '',

            name:
              device?.alias ||
              device?.deviceModel ||
              device?.deviceTypeName ||
              device?.sn ||
              'Dispositivo',

            status:
              normalizeStatus(
                device?.status
              ),

            power_kw:
              numberOf(
                device?.pac
              ) !== null
                ? numberOf(
                    device?.pac
                  ) / 1000
                : null,

            today_kwh:
              numberOf(
                device?.eDay
              ),

            month_kwh:
              numberOf(
                device?.eMonth
              ),

            total_kwh:
              numberOf(
                device?.eTotal
              ),

            nominal_kw:
              numberOf(
                device?.nominalPower
              ),

            updated_at:
              safeIso(
                device?.lastUpdateDateTime ||
                device?.timeServer
              ),

            type:
              device?.deviceTypeName ||
              device?.deviceType ||
              '',

            raw:
              device
          });
        }
      );


    devices =
      deduplicateDevices(
        devices
      );


    const summary =
      summarizeDevices(
        devices
      );


    const sum =
      key => {
        const values =
          devices
            .map(
              device =>
                device[key]
            )
            .filter(
              Number.isFinite
            );

        return values.length
          ? values.reduce(
              (
                total,
                value
              ) =>
                total +
                value,
              0
            )
          : null;
      };


    result.push(
      compactObject({
        id:
          plantId,

        name:
          plant?.plantName ||
          plantData?.plantName ||
          c.plant ||
          `Usina ${plantId}`,

        status:
          summary.online_devices > 0
            ? 'online'
            : (
                summary.total_devices
                  ? 'offline'
                  : 'unknown'
              ),

        capacity_kw:
          numberOf(
            plantData?.nominalPower
          ),

        power_kw:
          sum(
            'power_kw'
          ),

        today_kwh:
          sum(
            'today_kwh'
          ),

        month_kwh:
          sum(
            'month_kwh'
          ),

        total_kwh:
          numberOf(
            plantData?.eTotal
          ) ??
          sum(
            'total_kwh'
          ),

        updated_at:
          devices
            .map(
              device =>
                device.updated_at
            )
            .filter(Boolean)
            .sort()
            .at(-1) ||
          null,

        total_devices:
          summary.total_devices,

        online_devices:
          summary.online_devices,

        alarm_devices:
          summary.alarm_devices,

        devices,

        raw: {
          plant,
          plantData
        }
      })
    );
  }


  return {
    provider:
      'shinephone',

    source:
      'Growatt ShineServer - sessão web',

    plants:
      result,

    checked_at:
      new Date().toISOString(),

    note:
      'Fallback por usuário/senha. Recomenda-se usar API Token.'
  };
}


/* ============================================================================
   FUNÇÃO PRINCIPAL
============================================================================ */

export async function getShinePhoneData(c) {
  /*
   * Se API_TOKEN existir,
   * ele é SEMPRE usado.
   */
  if (c.api_token) {
    return await getByApiToken(
      c
    );
  }

  /*
   * USER/PASSWORD fica somente
   * como compatibilidade.
   */
  return await getByLegacySession(
    c
  );
}
