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
 * PRINCIPAL:
 * Growatt OpenAPI V1 + API Token
 *
 * VERCEL:
 *
 * SOLAR_SHINEPHONE_01_API_TOKEN
 *
 * OPCIONAIS:
 *
 * SOLAR_SHINEPHONE_01_LABEL
 * SOLAR_SHINEPHONE_01_COMPANY
 * SOLAR_SHINEPHONE_01_PLANT
 * SOLAR_SHINEPHONE_01_PLANT_ID
 * SOLAR_SHINEPHONE_01_API_BASE
 *
 * ALERTA:
 *
 * Quando status = offline:
 *
 * POST /api/alerta
 *
 * JSON:
 *
 * {
 *   "provider": "shinephone",
 *   "station_id": "...",
 *   "station_name": "...",
 *   "status": "offline",
 *   "company": "...",
 *   "label": "...",
 *   "slot": 1,
 *   "checked_at": "..."
 * }
 *
 * ============================================================================
 */


/* ============================================================================
   CONFIGURAÇÕES
============================================================================ */

const OPENAPI_DEFAULT =
  'https://openapi.growatt.com/v1/';

const LEGACY_DEFAULT =
  'https://server.growatt.com/';

const REQUEST_TIMEOUT =
  25000;


/*
 * Consideramos o dado desatualizado
 * se estiver há mais de 6 horas sem atualização.
 */
const STALE_HOURS =
  6;


/* ============================================================================
   URL
============================================================================ */

function cleanBase(value = '') {

  return String(
    value || ''
  )
    .trim()
    .replace(/\/+$/, '');
}


function openApiBase(c) {

  const configured =
    cleanBase(
      c.api_base
    );


  if (
    !configured ||
    /server\.growatt\.com/i.test(
      configured
    )
  ) {

    return OPENAPI_DEFAULT;
  }


  if (
    /\/v1$/i.test(
      configured
    )
  ) {

    return `${configured}/`;
  }


  return `${configured}/v1/`;
}


function legacyBase(c) {

  const configured =
    cleanBase(
      c.api_base
    );


  if (
    configured &&
    !/openapi.*growatt/i.test(
      configured
    )
  ) {

    return `${configured}/`;
  }


  return LEGACY_DEFAULT;
}


/* ============================================================================
   HELPERS
============================================================================ */

function pickNumber(
  obj,
  keys
) {

  if (!obj) {
    return null;
  }


  for (
    const key of keys
  ) {

    const value =
      numberOf(
        obj?.[key]
      );


    if (
      value !== null
    ) {

      return value;
    }
  }


  return null;
}


function pickText(
  obj,
  keys
) {

  if (!obj) {
    return '';
  }


  for (
    const key of keys
  ) {

    const value =
      obj?.[key];


    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {

      return String(
        value
      ).trim();
    }
  }


  return '';
}


function normalizeCapacityKw(
  value
) {

  const n =
    numberOf(
      value
    );


  if (
    n === null
  ) {

    return null;
  }


  /*
   * Alguns retornos usam W.
   */
  if (
    n > 1000
  ) {

    return n / 1000;
  }


  return n;
}


function todayIso() {

  return new Date()
    .toISOString()
    .slice(
      0,
      10
    );
}


function firstDayOfMonth(
  date
) {

  return `${date.slice(0, 7)}-01`;
}


function safeIso(
  value
) {

  if (!value) {
    return null;
  }


  try {

    return isoFromAny(
      value
    );

  } catch {

    return null;
  }
}


/* ============================================================================
   VERIFICA SE O DADO ESTÁ ANTIGO
============================================================================ */

function isStale(
  value,
  hours = STALE_HOURS
) {

  if (!value) {
    return true;
  }


  let text =
    String(
      value
    ).trim();


  /*
   * Growatt costuma retornar:
   *
   * 2026-08-25 10:14:01
   */
  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:/.test(
      text
    )
  ) {

    text =
      text.replace(
        ' ',
        'T'
      );
  }


  const timestamp =
    Date.parse(
      text
    );


  if (
    Number.isNaN(
      timestamp
    )
  ) {

    return true;
  }


  const age =
    Date.now() -
    timestamp;


  return (
    age >
    hours *
    60 *
    60 *
    1000
  );
}


/* ============================================================================
   VERIFICA SE ATUALIZOU RECENTEMENTE
============================================================================ */

function isFresh(
  value,
  minutes = 90
) {

  if (!value) {
    return false;
  }


  let text =
    String(
      value
    ).trim();


  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:/.test(
      text
    )
  ) {

    text =
      text.replace(
        ' ',
        'T'
      );
  }


  const timestamp =
    Date.parse(
      text
    );


  if (
    Number.isNaN(
      timestamp
    )
  ) {

    return false;
  }


  const age =
    Math.abs(
      Date.now() -
      timestamp
    );


  return (
    age <=
    minutes *
    60 *
    1000
  );
}


/* ============================================================================
   JSON HTTP
============================================================================ */

async function readJson(
  res,
  label
) {

  const text =
    await res.text();


  let data =
    {};


  try {

    data =
      text
        ? JSON.parse(
            text
          )
        : {};

  } catch {

    throw new SolarConnectorError(

      `${label}: a Growatt não retornou JSON.`,

      'GROWATT_RESPONSE',

      text.slice(
        0,
        600
      )
    );
  }


  if (
    !res.ok
  ) {

    throw new SolarConnectorError(

      `${label}: Growatt respondeu HTTP ${res.status}.`,

      'GROWATT_HTTP',

      data
    );
  }


  return data;
}


/* ============================================================================
   OPENAPI GET
============================================================================ */

async function openApiGet(
  c,
  path,
  params = {}
) {

  if (
    !c.api_token
  ) {

    throw new SolarConnectorError(

      'API Token Growatt não configurado.',

      'CONFIG'
    );
  }


  const base =
    openApiBase(
      c
    );


  const url =
    new URL(

      path.replace(
        /^\/+/,
        ''
      ),

      base
    );


  for (
    const [
      key,
      value
    ] of Object.entries(
      params
    )
  ) {

    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {

      continue;
    }


    url.searchParams.set(

      key,

      String(
        value
      )
    );
  }


  const res =
    await fetchWithTimeout(

      url.toString(),

      {

        method:
          'GET',

        headers: {

          token:
            c.api_token,

          accept:
            'application/json',

          'user-agent':
            'SolarCentral/8.0 GrowattOpenAPI'
        },

        redirect:
          'follow'
      },

      REQUEST_TIMEOUT
    );


  const json =
    await readJson(

      res,

      `Growatt OpenAPI /${path}`
    );


  const errorCode =
    Number(

      json?.error_code ??

      json?.code ??

      0
    );


  if (
    errorCode !== 0
  ) {

    let code =
      'GROWATT_API';


    if (
      errorCode === 10004 ||
      errorCode === 10005
    ) {

      code =
        'AUTH';
    }


    if (
      errorCode === 10012 ||

      /frequent/i.test(
        String(
          json?.error_msg || ''
        )
      )
    ) {

      code =
        'RATE_LIMIT';
    }


    throw new SolarConnectorError(

      json?.error_msg ||

      json?.message ||

      `Growatt retornou erro ${errorCode}.`,

      code,

      json
    );
  }


  return (
    json?.data ??
    json
  );
}


/* ============================================================================
   PLANT LIST
============================================================================ */

async function getPlantList(
  c
) {

  const data =
    await openApiGet(

      c,

      'plant/list',

      {

        page:
          1,

        perpage:
          100
      }
    );


  const rows =

    data?.plants ??

    data?.plant_list ??

    data?.list ??

    data?.data ??

    [];


  return Array.isArray(
    rows
  )
    ? rows
    : [];
}


/* ============================================================================
   PLANT DATA

   API PRINCIPAL PARA:
   - potência
   - geração hoje
   - mês
   - ano
   - total
============================================================================ */

async function getPlantOverview(
  c,
  plantId
) {

  return await openApiGet(

    c,

    'plant/data',

    {

      plant_id:
        plantId
    }
  );
}


/* ============================================================================
   HISTÓRICO DE ENERGIA
============================================================================ */

async function getPlantEnergy(
  c,
  plantId,
  startDate,
  endDate,
  timeUnit
) {

  try {

    return await openApiGet(

      c,

      'plant/energy',

      {

        plant_id:
          plantId,

        start_date:
          startDate,

        end_date:
          endDate,

        time_unit:
          timeUnit,

        page:
          1,

        perpage:
          100
      }
    );

  } catch {

    return null;
  }
}


/* ============================================================================
   ENCONTRA VALOR DE ENERGIA NUM RETORNO
============================================================================ */

function extractEnergy(
  data
) {

  if (
    data === null ||
    data === undefined
  ) {

    return null;
  }


  /*
   * Caso venha diretamente:
   *
   * {
   *   energy: 35.4
   * }
   */
  if (
    typeof data ===
    'object' &&
    !Array.isArray(
      data
    )
  ) {

    const direct =
      pickNumber(

        data,

        [
          'energy',
          'value',
          'today_energy',
          'todayEnergy',
          'day_energy',
          'dayEnergy',
          'e_day',
          'eDay',
          'month_energy',
          'monthly_energy',
          'eMonth'
        ]
      );


    if (
      direct !== null
    ) {

      return direct;
    }
  }


  const possibleArrays = [

    data?.energys,
    data?.energies,
    data?.energy_list,
    data?.energyList,
    data?.list,
    data?.records,
    data?.data

  ];


  for (
    const rows of
      possibleArrays
  ) {

    if (
      !Array.isArray(
        rows
      )
    ) {

      continue;
    }


    const values =
      [];


    for (
      const row of rows
    ) {

      const value =
        pickNumber(

          row,

          [
            'energy',
            'value',
            'today_energy',
            'todayEnergy',
            'day_energy',
            'dayEnergy',
            'e_day',
            'eDay',
            'month_energy',
            'monthly_energy',
            'eMonth'
          ]
        );


      if (
        value !== null
      ) {

        values.push(
          value
        );
      }
    }


    if (
      values.length === 1
    ) {

      return values[0];
    }


    if (
      values.length > 1
    ) {

      return values.reduce(

        (
          total,
          value
        ) =>
          total +
          value,

        0
      );
    }
  }


  return null;
}


/* ============================================================================
   GERAÇÃO DO DIA - FALLBACK
============================================================================ */

async function getTodayEnergy(
  c,
  plantId
) {

  const today =
    todayIso();


  const data =
    await getPlantEnergy(

      c,

      plantId,

      today,

      today,

      'day'
    );


  return extractEnergy(
    data
  );
}


/* ============================================================================
   GERAÇÃO DO MÊS - FALLBACK
============================================================================ */

async function getMonthEnergy(
  c,
  plantId
) {

  const today =
    todayIso();


  const data =
    await getPlantEnergy(

      c,

      plantId,

      firstDayOfMonth(
        today
      ),

      today,

      'month'
    );


  return extractEnergy(
    data
  );
}


/* ============================================================================
   DISPOSITIVOS
============================================================================ */

async function getDeviceList(
  c,
  plantId
) {

  try {

    const data =
      await openApiGet(

        c,

        'device/list',

        {

          plant_id:
            plantId,

          page:
            1,

          perpage:
            100
        }
      );


    const rows =

      data?.devices ??

      data?.device_list ??

      data?.list ??

      data?.data ??

      [];


    return Array.isArray(
      rows
    )
      ? rows
      : [];

  } catch {

    return [];
  }
}


/* ============================================================================
   STATUS DO DISPOSITIVO
============================================================================ */

function deviceStatus(
  d
) {

  /*
   * Growatt:
   *
   * lost = true
   *
   * significa perda de comunicação.
   */
  if (
    d?.lost === true ||

    String(
      d?.lost
    ).toLowerCase() ===
      'true'
  ) {

    return 'offline';
  }


  const status =
    normalizeStatus(
      d?.status
    );


  if (
    status ===
      'unknown' &&

    d?.lost === false
  ) {

    return 'online';
  }


  return status;
}


/* ============================================================================
   NORMALIZA DISPOSITIVO
============================================================================ */

function normalizeDevice(
  d
) {

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
      )

      ||

      pickText(
        d,
        [
          'device_sn',
          'deviceSn',
          'sn'
        ]
      )

      ||

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
      deviceStatus(
        d
      ),


    updated_at:

      safeIso(

        d?.last_update_time ??

        d?.lastUpdateTime ??

        d?.last_update
      ),


    raw:
      d
  });
}


/* ============================================================================
   REMOVE DUPLICADOS
============================================================================ */

function deduplicateDevices(
  devices
) {

  const map =
    new Map();


  for (
    const device of devices
  ) {

    const key =

      device.sn

      ||

      `${device.name}-${device.datalogger_sn}`;


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        device
      );

      continue;
    }


    const previous =
      map.get(
        key
      );


    const previousType =
      Number(
        previous.type
      );


    const currentType =
      Number(
        device.type
      );


    /*
     * type 4 = MAX
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


    if (
      device.status ===
        'online' &&

      previous.status !==
        'online'
    ) {

      map.set(
        key,
        device
      );
    }
  }


  return [
    ...map.values()
  ];
}


/* ============================================================================
   FILTRO DAS PLANTAS
============================================================================ */

function filterPlants(
  plants,
  c
) {

  let list =
    [...plants];


  /*
   * PLANT_ID é o mais seguro.
   */
  if (
    c.plant_id
  ) {

    return list.filter(

      plant => {

        const id =

          plant?.plant_id ??

          plant?.plantId ??

          plant?.id;


        return (
          String(
            id
          ) ===
          String(
            c.plant_id
          )
        );
      }
    );
  }


  /*
   * Se houver mais de uma usina,
   * tenta pelo nome exato.
   */
  if (
    c.plant &&
    list.length > 1
  ) {

    const wanted =
      String(
        c.plant
      )
        .trim()
        .toLowerCase();


    const matches =
      list.filter(

        plant => {

          const name =
            pickText(

              plant,

              [
                'name',
                'plant_name',
                'plantName'
              ]
            )
              .toLowerCase();


          return (
            name ===
            wanted
          );
        }
      );


    if (
      matches.length
    ) {

      list =
        matches;
    }
  }


  return list;
}


/* ============================================================================
   STATUS DA USINA
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


  const updateTime =

    overview?.last_update_time ??

    overview?.last_update ??

    overview?.lastUpdateTime;


  /*
   * Se a Growatt acabou de enviar dados,
   * consideramos online mesmo que device/list
   * esteja atrasado.
   */
  if (
    isFresh(
      updateTime,
      90
    )
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


  /*
   * Se temos energia hoje e o dado
   * não é antigo, também consideramos online.
   */
  if (
    Number.isFinite(
      todayKwh
    ) &&
    todayKwh > 0 &&
    !isStale(
      updateTime
    )
  ) {

    return 'online';
  }


  if (
    summary.alarm_devices >
    0
  ) {

    return 'alarm';
  }


  if (
    summary.online_devices >
    0
  ) {

    return 'online';
  }


  /*
   * Todos os dispositivos perderam comunicação.
   */
  if (
    summary.total_devices > 0 &&
    summary.online_devices === 0
  ) {

    return 'offline';
  }


  /*
   * Se plant/list explicitamente
   * disser que está offline.
   */
  const plantStatus =
    normalizeStatus(
      plant?.status
    );


  if (
    plantStatus ===
    'offline'
  ) {

    return 'offline';
  }


  return 'unknown';
}


/* ============================================================================
   URL DA API DE ALERTA
============================================================================ */

function alertaUrl() {

  /*
   * Você pode configurar manualmente:
   *
   * ALERTA_API_URL=https://seusite.vercel.app/api/alerta
   */
  if (
    process.env.ALERTA_API_URL
  ) {

    return String(
      process.env.ALERTA_API_URL
    );
  }


  /*
   * Produção Vercel.
   */
  const host =

    process.env
      .VERCEL_PROJECT_PRODUCTION_URL

    ||

    process.env
      .VERCEL_URL;


  if (!host) {
    return null;
  }


  const base =
    /^https?:\/\//i.test(
      host
    )

      ?

      host

      :

      `https://${host}`;


  return (
    `${base.replace(/\/+$/, '')}/api/alerta`
  );
}


/* ============================================================================
   ENVIA ALERTA OFFLINE
============================================================================ */

async function sendOfflineAlert(
  c,
  plant
) {

  const url =
    alertaUrl();


  if (!url) {

    return {
      sent: false,
      reason: 'ALERTA_URL_UNAVAILABLE'
    };
  }


  /*
   * Usa uma chave interna.
   *
   * Se quiser criar uma específica:
   *
   * ALERTA_INTERNAL_SECRET
   *
   * Senão utiliza SESSION_SECRET.
   */
  const secret =

    process.env
      .ALERTA_INTERNAL_SECRET

    ||

    process.env
      .SESSION_SECRET

    ||

    '';


  if (!secret) {

    return {
      sent: false,
      reason: 'ALERTA_SECRET_UNAVAILABLE'
    };
  }


  const payload = {

    provider:
      'shinephone',

    station_id:
      plant.id,

    station_name:
      plant.name,

    status:
      plant.status,

    company:
      c.company || '',

    label:
      c.label || '',

    slot:
      c.slot || null,

    checked_at:
      new Date()
        .toISOString()
  };


  try {

    const res =
      await fetchWithTimeout(

        url,

        {

          method:
            'POST',

          headers: {

            'content-type':
              'application/json',

            'x-alert-secret':
              secret,

            'user-agent':
              'SolarCentral/8.0 Alert'
          },

          body:
            JSON.stringify(
              payload
            )
        },

        10000
      );


    /*
     * O erro do alerta NÃO deve
     * derrubar o monitoramento solar.
     */
    if (
      !res.ok
    ) {

      return {

        sent: false,

        status:
          res.status
      };
    }


    return {

      sent: true,

      status:
        res.status
    };

  } catch (
    error
  ) {

    return {

      sent: false,

      error:
        error?.message ||
        'Falha ao enviar alerta.'
    };
  }
}


/* ============================================================================
   OPENAPI PRINCIPAL
============================================================================ */

async function getByApiToken(
  c
) {

  if (
    !c.api_token
  ) {

    throw new SolarConnectorError(

      'Configure SOLAR_SHINEPHONE_XX_API_TOKEN.',

      'CONFIG'
    );
  }


  let plants =
    await getPlantList(
      c
    );


  plants =
    filterPlants(
      plants,
      c
    );


  if (
    !plants.length
  ) {

    return {

      provider:
        'shinephone',

      source:
        'Growatt OpenAPI V1 (API Token)',

      plants:
        [],

      checked_at:
        new Date()
          .toISOString(),

      note:
        'O API Token foi aceito, mas nenhuma usina foi encontrada.'
    };
  }


  const result =
    [];


  for (
    const plant of
      plants.slice(
        0,
        50
      )
  ) {

    const plantId =
      String(

        plant?.plant_id ??

        plant?.plantId ??

        plant?.id ??

        ''
      );


    if (
      !plantId
    ) {

      continue;
    }


    /*
     * Duas chamadas principais
     * em paralelo.
     */
    const [
      overview,
      deviceRows
    ] =
      await Promise.all([

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
     * ========================================================
     * DISPOSITIVOS
     * ========================================================
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
     * ========================================================
     * POTÊNCIA
     * ========================================================
     */

    const plantPowerW =
      pickNumber(

        plant,

        [
          'current_power',
          'currentPower',
          'pac',
          'power'
        ]
      );


    const overviewPowerW =
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
     * Growatt OpenAPI:
     * plant.current_power normalmente vem em W.
     * overview.current_power pode retornar 0 mesmo com geração ativa.
     * Priorizamos o valor da planta e convertemos W -> kW.
     */
    const rawPowerW =
      plantPowerW !== null
        ? plantPowerW
        : overviewPowerW;


    const powerKw =
      rawPowerW !== null
        ? rawPowerW / 1000
        : null;


    /*
     * ========================================================
     * HOJE
     * ========================================================
     */

    let todayKwh =
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
     * ========================================================
     * MÊS
     * ========================================================
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
     * ========================================================
     * ANO
     * ========================================================
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
     * ========================================================
     * TOTAL
     * ========================================================
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
      )

      ??

      pickNumber(

        plant,

        [
          'total_energy',
          'totalEnergy'
        ]
      );


    /*
     * ========================================================
     * CAPACIDADE
     * ========================================================
     */

    const capacityKw =
      normalizeCapacityKw(

        overview?.peak_power_actual

        ??

        plant?.peak_power

        ??

        plant?.nominal_power

        ??

        plant?.nominalPower
      );


    /*
     * ========================================================
     * STATUS PRELIMINAR
     * ========================================================
     */

    let status =
      determinePlantStatus({

        devices,

        powerKw,

        todayKwh,

        overview,

        plant
      });


    /*
     * ========================================================
     * FALLBACK "HOJE"
     *
     * Se:
     *
     * - não veio today_energy
     * OU
     * - veio 0 e estação está offline
     * OU
     * - dado está desatualizado
     *
     * consulta /plant/energy
     * usando time_unit=day.
     * ========================================================
     */

    const updateTime =

      overview?.last_update_time

      ??

      overview?.last_update

      ??

      overview?.lastUpdateTime;


    const needsTodayFallback =

      todayKwh === null

      ||

      (
        todayKwh === 0 &&
        status === 'offline'
      )

      ||

      (
        todayKwh === 0 &&
        isStale(
          updateTime
        )
      );


    if (
      needsTodayFallback
    ) {

      const fallbackToday =
        await getTodayEnergy(

          c,

          plantId
        );


      if (
        fallbackToday !== null
      ) {

        todayKwh =
          fallbackToday;
      }
    }


    /*
     * ========================================================
     * FALLBACK MÊS
     * ========================================================
     */

    if (
      monthKwh === null
    ) {

      monthKwh =
        await getMonthEnergy(

          c,

          plantId
        );
    }


    /*
     * Recalcula o status depois
     * dos fallbacks.
     */
    status =
      determinePlantStatus({

        devices,

        powerKw,

        todayKwh,

        overview,

        plant
      });


    /*
     * ========================================================
     * NOME
     * ========================================================
     */

    const name =

      pickText(

        plant,

        [
          'name',
          'plant_name',
          'plantName'
        ]
      )

      ||

      c.plant

      ||

      `Usina ${plantId}`;


    /*
     * ========================================================
     * ATUALIZAÇÃO
     * ========================================================
     */

    const updatedAt =
      safeIso(

        updateTime
      )

      ||

      devices
        .map(
          device =>
            device.updated_at
        )
        .filter(Boolean)
        .sort()
        .at(-1)

      ||

      null;


    /*
     * ========================================================
     * OBJETO FINAL
     * ========================================================
     */

    const plantResult =
      compactObject({

        id:
          plantId,

        name,

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

        city:

          pickText(
            plant,
            [
              'city'
            ]
          ),

        country:

          pickText(
            plant,
            [
              'country'
            ]
          ),

        latitude:
          numberOf(
            plant?.latitude
          ),

        longitude:
          numberOf(
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

        /*
         * Não colocamos aqui:
         *
         * token
         * senha
         * credenciais
         */
        raw: {

          plant,

          overview
        }
      });


    /*
     * ========================================================
     * ALERTA OFFLINE
     * ========================================================
     */

    if (
      status ===
      'offline'
    ) {

      const alertResult =
        await sendOfflineAlert(

          c,

          plantResult
        );


      /*
       * Só para você conseguir
       * confirmar no JSON se foi disparado.
       */
      plantResult.alert = {

        triggered:
          true,

        sent:
          Boolean(
            alertResult?.sent
          )
      };

    } else {

      plantResult.alert = {

        triggered:
          false,

        sent:
          false
      };
    }


    result.push(
      plantResult
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
      new Date()
        .toISOString(),

    note:
      'Growatt OpenAPI com fallback diário e alerta automático para estações offline.'
  };
}


/* ============================================================================
   FALLBACK LEGADO
============================================================================ */

function cookieHeader(
  headers
) {

  const array =

    typeof headers
      .getSetCookie ===
      'function'

      ?

      headers.getSetCookie()

      :

      [];


  const raw =

    array.length

      ?

      array

      :

      [
        headers.get(
          'set-cookie'
        )
      ].filter(
        Boolean
      );


  return raw

    .map(
      value =>
        value.split(
          ';'
        )[0]
    )

    .filter(
      Boolean
    )

    .join(
      '; '
    );
}


/* ============================================================================
   JSON LEGADO
============================================================================ */

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

      text.slice(
        0,
        500
      )
    );
  }
}


/* ============================================================================
   POST FORM
============================================================================ */

async function postForm(
  url,
  body,
  headers
) {

  return fetchWithTimeout(

    url,

    {

      method:
        'POST',

      headers: {

        'content-type':
          'application/x-www-form-urlencoded; charset=UTF-8',

        accept:
          'application/json, text/plain, */*',

        'user-agent':
          'Mozilla/5.0 SolarCentral/8.0',

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


/* ============================================================================
   FALLBACK USER/PASSWORD
============================================================================ */

async function getByLegacySession(
  c
) {

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
    legacyBase(
      c
    );


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
          new URL(
            base
          ).origin,

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
      'Mozilla/5.0 SolarCentral/8.0',

    accept:
      'application/json, text/plain, */*'
  };


  const listRes =
    await fetchWithTimeout(

      new URL(

        'index/getPlantListTitle',

        base
      ),

      {

        headers,

        redirect:
          'follow'
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

      ?

      plantsRaw

      :

      (
        plantsRaw?.obj?.datas

        ||

        plantsRaw?.data

        ||

        []
      );


  let plants =

    Array.isArray(
      rawList
    )

      ?

      rawList

      :

      [];


  if (
    c.plant_id
  ) {

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


  const result =
    [];


  for (
    const plant of
      plants.slice(
        0,
        20
      )
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


    let plantData =
      {};


    let devicesRaw =
      [];


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

            method:
              'POST',

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

        json?.obj

        ||

        json?.data

        ||

        json

        ||

        {};

    } catch (
      error
    ) {

      plantData = {

        _error:
          error?.message
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

            currPage:
              '1'
          },

          headers
        );


      const json =
        await parseLegacyJson(

          res,

          'Dispositivos'
        );


      devicesRaw =

        json?.obj?.datas

        ||

        json?.data?.datas

        ||

        json?.data

        ||

        [];


      if (
        !Array.isArray(
          devicesRaw
        )
      ) {

        devicesRaw =
          [];
      }

    } catch {

      devicesRaw =
        [];
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

                ?

                numberOf(
                  device?.pac
                ) / 1000

                :

                null,


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

                device?.lastUpdateDateTime

                ||

                device?.timeServer
              ),


            type:

              device?.deviceTypeName

              ||

              device?.deviceType

              ||

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

          ?

          values.reduce(

            (
              total,
              value
            ) =>
              total +
              value,

            0
          )

          :

          null;
      };


    const name =

      plant?.plantName

      ||

      plantData?.plantName

      ||

      c.plant

      ||

      `Usina ${plantId}`;


    const status =

      summary.online_devices > 0

        ?

        'online'

        :

        (
          summary.total_devices

            ?

            'offline'

            :

            'unknown'
        );


    const plantResult =
      compactObject({

        id:
          plantId,

        name,

        status,

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
          )

          ??

          sum(
            'total_kwh'
          ),

        updated_at:

          devices

            .map(
              device =>
                device.updated_at
            )

            .filter(
              Boolean
            )

            .sort()

            .at(-1)

          ||

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
      });


    /*
     * ALERTA TAMBÉM NO FALLBACK
     */
    if (
      status ===
      'offline'
    ) {

      const alertResult =
        await sendOfflineAlert(

          c,

          plantResult
        );


      plantResult.alert = {

        triggered:
          true,

        sent:
          Boolean(
            alertResult?.sent
          )
      };

    } else {

      plantResult.alert = {

        triggered:
          false,

        sent:
          false
      };
    }


    result.push(
      plantResult
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
      new Date()
        .toISOString(),

    note:
      'Fallback por usuário/senha.'
  };
}


/* ============================================================================
   EXPORT PRINCIPAL
============================================================================ */

export async function getShinePhoneData(
  c
) {

  /*
   * API TOKEN SEMPRE TEM PRIORIDADE.
   */
  if (
    c.api_token
  ) {

    return await getByApiToken(
      c
    );
  }


  return await getByLegacySession(
    c
  );
}
