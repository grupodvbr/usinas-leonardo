import {
  SolarConnectorError,
  fetchJson,
  numberOf,
  normalizeStatus,
  compactObject,
  isoFromAny
} from '../solar-utils.mjs';

/**
 * ============================================================================
 * iSOLARCLOUD / SUNGROW - OPENAPI V1
 * ============================================================================
 *
 * VERCEL OBRIGATÓRIO:
 *
 * SOLAR_ISOLARCLOUD_01_USER
 * SOLAR_ISOLARCLOUD_01_PASSWORD
 * SOLAR_ISOLARCLOUD_01_APP_KEY
 * SOLAR_ISOLARCLOUD_01_SECRET_KEY
 *
 * OPCIONAIS:
 *
 * SOLAR_ISOLARCLOUD_01_LABEL
 * SOLAR_ISOLARCLOUD_01_COMPANY
 * SOLAR_ISOLARCLOUD_01_PLANT
 * SOLAR_ISOLARCLOUD_01_PLANT_ID
 * SOLAR_ISOLARCLOUD_01_API_BASE
 *
 * OPCIONAL - SOMENTE FALLBACK FINANCEIRO:
 *
 * SOLAR_ISOLARCLOUD_01_TARIFF_BRL
 *
 * Exemplo:
 * SOLAR_ISOLARCLOUD_01_TARIFF_BRL=0.95
 *
 * Se o iSolarCloud devolver today_income / month_income / total_income,
 * esses valores oficiais têm prioridade. A tarifa manual só é usada
 * quando o valor financeiro não vier da plataforma.
 *
 * O token é gerado automaticamente.
 * ============================================================================
 */

const DEFAULT_BASE_URL =
  'https://gateway.isolarcloud.com.hk';

const REQUEST_TIMEOUT_MS = 25000;

const MAX_PLANTS = 50;

/*
 * O próprio iSolarCloud trata a usina como
 * um pseudo-dispositivo do tipo 11.
 */
const PLANT_DEVICE_TYPE = 11;


/*
 * Pontos principais da própria usina.
 *
 * 83022 = geração diária
 * 83024 = geração total
 * 83033 = potência da planta
 * 83106 = potência da carga
 * 83252 = SOC bateria
 * 83328 = potência da rede
 * 83329 = potência fotovoltaica
 * 83330 = potência da carga
 */
const PLANT_POINTS = {

  '83022': {
    key: 'today_kwh',
    unit: 'Wh'
  },

  '83024': {
    key: 'total_kwh',
    unit: 'Wh'
  },

  '83033': {
    key: 'power_kw',
    unit: 'W'
  },

  '83106': {
    key: 'load_kw',
    unit: 'W'
  },

  '83252': {
    key: 'battery_soc',
    unit: '%'
  },

  '83328': {
    key: 'grid_kw',
    unit: 'W'
  },

  '83329': {
    key: 'pv_power_kw',
    unit: 'W'
  },

  '83330': {
    key: 'load_kw',
    unit: 'W'
  }
};


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

function cleanText(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value).trim();
}


function pickText(
  obj,
  keys
) {

  if (!obj) {
    return '';
  }

  for (const key of keys) {

    const value =
      obj?.[key];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {

      return String(value)
        .trim();
    }
  }

  return '';
}


function pickPlantId(
  obj
) {

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


function pickPlantName(
  obj
) {

  return pickText(
    obj,
    [
      'ps_name',
      'psName',
      'plant_name',
      'plantName',
      'name'
    ]
  );
}


function pickDeviceKey(
  obj
) {

  return pickText(
    obj,
    [
      'ps_key',
      'psKey'
    ]
  );
}


function pickDeviceSn(
  obj
) {

  return pickText(
    obj,
    [
      'device_sn',
      'deviceSn',
      'sn',
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
        'name'
      ]
    )

    ||

    pickDeviceSn(
      obj
    )

    ||

    `Dispositivo ${index + 1}`
  );
}


/* ============================================================================
   LEITURA DE CAMPOS { unit, value }
============================================================================ */

/*
 * IMPORTANTE:
 *
 * O iSolarCloud retorna vários números assim:
 *
 * {
 *   "unit": "kWh",
 *   "value": "741.5"
 * }
 *
 * Por isso não podemos usar numberOf()
 * diretamente no objeto inteiro.
 */
function measurement(
  raw,
  fallbackUnit = ''
) {

  if (
    raw === null ||
    raw === undefined ||
    raw === ''
  ) {

    return {
      value: null,
      unit: fallbackUnit
    };
  }


  if (
    typeof raw === 'object' &&
    !Array.isArray(raw)
  ) {

    const value =
      numberOf(
        raw.value ??
        raw.val ??
        raw.data
      );


    const unit =
      cleanText(
        raw.unit ??
        raw.show_unit ??
        raw.storage_unit ??
        fallbackUnit
      );


    return {
      value,
      unit
    };
  }


  return {

    value:
      numberOf(raw),

    unit:
      fallbackUnit
  };
}



/* ============================================================================
   FINANCEIRO / RECEITA
============================================================================ */

/*
 * O iSolarCloud/Sungrow expõe em respostas da planta campos UnitValue
 * como:
 *
 * today_income
 * month_income
 * total_income
 *
 * Exemplo:
 *
 * {
 *   "unit": "BRL",
 *   "value": "1234.56"
 * }
 *
 * Em algumas contas a unidade pode vir como "R$".
 */

function normalizeCurrency(
  value
) {

  const raw =
    cleanText(
      value
    )
      .toUpperCase();


  if (!raw) {
    return '';
  }


  if (
    raw === 'R$' ||
    raw === 'BRL' ||
    raw === 'REAL' ||
    raw === 'REAIS'
  ) {

    return 'BRL';
  }


  if (
    raw.includes(
      'BRL'
    )
  ) {

    return 'BRL';
  }


  if (
    raw === '$' ||
    raw === 'USD' ||
    raw === 'US$'
  ) {

    return 'USD';
  }


  if (
    raw === '€' ||
    raw === 'EUR'
  ) {

    return 'EUR';
  }


  if (
    raw === '¥' ||
    raw === '￥' ||
    raw === 'CNY' ||
    raw === 'RMB'
  ) {

    return 'CNY';
  }


  return raw;
}


function normalizeMoney(
  raw
) {

  const {
    value,
    unit
  } =
    measurement(
      raw,
      ''
    );


  return {

    value,

    currency:
      normalizeCurrency(
        unit
      )
  };
}


function firstMoney(
  ...rawValues
) {

  for (
    const raw of rawValues
  ) {

    const result =
      normalizeMoney(
        raw
      );


    if (
      result.value !== null
    ) {

      return result;
    }
  }


  return {
    value: null,
    currency: ''
  };
}


function envTariffBrl(
  c
) {

  const slot =
    String(
      c?.slot || 1
    ).padStart(
      2,
      '0'
    );


  const names = [

    `SOLAR_ISOLARCLOUD_${slot}_TARIFF_BRL`,

    'SOLAR_ISOLARCLOUD_TARIFF_BRL'
  ];


  for (
    const name of names
  ) {

    const value =
      numberOf(
        process.env[name]
      );


    if (
      value !== null &&
      Number.isFinite(
        value
      ) &&
      value >= 0
    ) {

      return value;
    }
  }


  return null;
}


function plantFinancialMetrics(
  p,
  c,
  {
    todayKwh,
    monthKwh,
    yearKwh,
    totalKwh
  }
) {

  /*
   * CAMPOS OFICIAIS DA PLANTA
   *
   * Referências do ecossistema iSolarCloud confirmam:
   * today_income
   * month_income
   * total_income
   *
   * Também tentamos aliases comuns para não quebrar entre regiões/versões.
   */

  const today =
    firstMoney(

      p?.today_income,

      p?.todayIncome,

      p?.day_income,

      p?.dayIncome
    );


  const month =
    firstMoney(

      p?.month_income,

      p?.monthIncome,

      p?.monthly_income,

      p?.monthlyIncome
    );


  const year =
    firstMoney(

      p?.year_income,

      p?.yearIncome,

      p?.yearly_income,

      p?.yearlyIncome
    );


  const total =
    firstMoney(

      p?.total_income,

      p?.totalIncome,

      p?.all_income,

      p?.allIncome
    );


  /*
   * Descobre a moeda pelos próprios UnitValue.
   */
  const currency =

    today.currency

    ||

    month.currency

    ||

    year.currency

    ||

    total.currency

    ||

    normalizeCurrency(
      p?.currency
    )

    ||

    normalizeCurrency(
      p?.currency_code
    )

    ||

    normalizeCurrency(
      p?.currencyCode
    );


  const manualTariff =
    envTariffBrl(
      c
    );


  let calculated =
    false;


  function withFallback(
    officialValue,
    energyKwh
  ) {

    /*
     * Valor oficial do iSolarCloud SEMPRE ganha.
     */
    if (
      officialValue !== null
    ) {

      return officialValue;
    }


    /*
     * Só calcula manualmente se houver tarifa BRL configurada.
     */
    if (
      manualTariff === null ||
      !Number.isFinite(
        energyKwh
      )
    ) {

      return null;
    }


    calculated =
      true;


    return (
      Number(
        energyKwh
      ) *
      manualTariff
    );
  }


  const revenueToday =
    withFallback(
      today.value,
      todayKwh
    );


  const revenueMonth =
    withFallback(
      month.value,
      monthKwh
    );


  const revenueYear =
    withFallback(
      year.value,
      yearKwh
    );


  const revenueTotal =
    withFallback(
      total.value,
      totalKwh
    );


  /*
   * Se houve cálculo pela variável *_TARIFF_BRL,
   * a moeda do cálculo é BRL.
   *
   * Quando só há valores oficiais, preservamos a moeda da Sungrow.
   */
  const finalCurrency =

    currency

    ||

    (
      calculated &&
      manualTariff !== null

        ? 'BRL'

        : ''
    );


  const hasOfficial =
    [
      today.value,
      month.value,
      year.value,
      total.value
    ].some(
      value =>
        value !== null
    );


  let source =
    'unavailable';


  if (
    hasOfficial &&
    calculated
  ) {

    source =
      'isolarcloud_with_tariff_fallback';

  } else if (
    hasOfficial
  ) {

    source =
      'isolarcloud';

  } else if (
    calculated
  ) {

    source =
      'calculated_from_vercel_tariff';
  }


  return {

    currency:
      finalCurrency || null,

    tariff_per_kwh:
      manualTariff,

    tariff_source:
      manualTariff !== null
        ? 'vercel'
        : null,

    revenue_today:
      revenueToday,

    revenue_month:
      revenueMonth,

    revenue_year:
      revenueYear,

    revenue_total:
      revenueTotal,

    revenue_source:
      source,

    /*
     * Campos explícitos para o front.
     * Só marcamos como BRL quando temos confirmação da moeda.
     */
    revenue_today_brl:
      finalCurrency === 'BRL'
        ? revenueToday
        : null,

    revenue_month_brl:
      finalCurrency === 'BRL'
        ? revenueMonth
        : null,

    revenue_year_brl:
      finalCurrency === 'BRL'
        ? revenueYear
        : null,

    revenue_total_brl:
      finalCurrency === 'BRL'
        ? revenueTotal
        : null
  };
}


/* ============================================================================
   POTÊNCIA → kW
============================================================================ */

function normalizePowerKw(
  raw,
  fallbackUnit = ''
) {

  const {
    value,
    unit
  } =
    measurement(
      raw,
      fallbackUnit
    );


  if (
    value === null
  ) {
    return null;
  }


  const u =
    String(
      unit || ''
    )
      .trim()
      .toLowerCase();


  if (
    u === 'w' ||
    u === 'wp'
  ) {

    return value / 1000;
  }


  if (
    u === 'mw'
  ) {

    return value * 1000;
  }


  /*
   * kW ou unidade ausente
   */
  return value;
}


/* ============================================================================
   ENERGIA → kWh
============================================================================ */

function normalizeEnergyKwh(
  raw,
  fallbackUnit = ''
) {

  const {
    value,
    unit
  } =
    measurement(
      raw,
      fallbackUnit
    );


  if (
    value === null
  ) {
    return null;
  }


  const u =
    String(
      unit || ''
    )
      .trim()
      .toLowerCase();


  if (
    u === 'wh'
  ) {

    return value / 1000;
  }


  if (
    u === 'mwh'
  ) {

    return value * 1000;
  }


  /*
   * Exemplo real da sua conta:
   *
   * 1.022 GWh
   *
   * vira:
   *
   * 1.022.000 kWh
   */
  if (
    u === 'gwh'
  ) {

    return value * 1_000_000;
  }


  /*
   * kWh ou unidade ausente
   */
  return value;
}


/* ============================================================================
   CAPACIDADE → kW / kWp
============================================================================ */

function normalizeCapacityKw(
  raw,
  fallbackUnit = ''
) {

  const {
    value,
    unit
  } =
    measurement(
      raw,
      fallbackUnit
    );


  if (
    value === null
  ) {
    return null;
  }


  const u =
    String(
      unit || ''
    )
      .trim()
      .toLowerCase();


  if (
    u === 'wp' ||
    u === 'w'
  ) {

    return value / 1000;
  }


  if (
    u === 'mwp' ||
    u === 'mw'
  ) {

    return value * 1000;
  }


  /*
   * kWp/kW
   */
  return value;
}


/* ============================================================================
   PORCENTAGEM
============================================================================ */

function normalizePercent(
  raw,
  fallbackUnit = '%'
) {

  const {
    value,
    unit
  } =
    measurement(
      raw,
      fallbackUnit
    );


  if (
    value === null
  ) {
    return null;
  }


  /*
   * Alguns pontos retornam:
   *
   * 0.75
   *
   * significando:
   *
   * 75%
   */
  if (
    String(unit).includes('%') &&
    value >= 0 &&
    value <= 1
  ) {

    return value * 100;
  }


  return value;
}


/* ============================================================================
   PRIMEIRO VALOR VÁLIDO
============================================================================ */

function firstNonNull(
  ...values
) {

  for (
    const value of values
  ) {

    if (
      value !== null &&
      value !== undefined &&
      value !== ''
    ) {

      return value;
    }
  }

  return null;
}


/* ============================================================================
   DATA
============================================================================ */

function safeIso(
  value
) {

  try {

    return isoFromAny(
      value
    );

  } catch {

    return value
      ? String(value)
      : null;
  }
}


/* ============================================================================
   TOKEN / ERROS
============================================================================ */

function isTokenError(
  data
) {

  const code =
    String(
      data?.result_code ??
      ''
    );


  const message =
    String(
      data?.result_msg ??
      ''
    )
      .toLowerCase();


  return (

    code === 'E900'

    ||

    message.includes(
      'token'
    )

    ||

    message.includes(
      'unauthorized'
    )
  );
}


function apiError(
  data,
  path
) {

  return new SolarConnectorError(

    data?.result_msg

    ||

    `iSolarCloud result_code=${data?.result_code} em ${path}`,

    isTokenError(
      data
    )
      ? 'AUTH'
      : 'UPSTREAM',

    data
  );
}


/* ============================================================================
   POST BASE
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
   * Não envia token no login.
   */
  if (
    token &&
    payload.user_password ===
      undefined
  ) {

    body.token =
      token;
  }


  const headers = {

    'content-type':
      'application/json',

    'user-agent':
      'SolarCentral/7.0 iSolarCloud',

    'x-access-key':
      c.secret_key,

    sys_code:
      '901'
  };


  if (token) {

    headers.token =
      token;
  }


  const response =
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


  const data =
    response?.data ??
    response;


  if (
    !data ||
    typeof data !==
      'object'
  ) {

    throw new SolarConnectorError(

      `Resposta inválida do iSolarCloud em ${path}.`,

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

    throw apiError(
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
    ) !== '1'

    ||

    !result?.token
  ) {

    throw new SolarConnectorError(

      result?.msg

      ||

      data?.result_msg

      ||

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
   CLIENTE API
============================================================================ */

function createClient(
  base,
  c
) {

  let token =
    null;


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
     * Se token expirou,
     * faz login novamente uma única vez.
     */
    if (
      String(
        data?.result_code
      ) !== '1'

      &&

      allowRelogin

      &&

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

      throw apiError(
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
   LISTA DAS USINAS
============================================================================ */

async function getPowerStations(
  client
) {

  const rows =
    [];


  let page =
    1;


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

      result?.pageList

      ??

      result?.page_list

      ??

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

        ??

        result?.row_count
      );


    if (
      !pageList.length
    ) {

      break;
    }


    if (
      pageList.length < 100
    ) {

      break;
    }


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
   LISTA DOS EQUIPAMENTOS
============================================================================ */

async function getDevices(
  client,
  psId
) {

  const rows =
    [];


  let page =
    1;


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

      result?.pageList

      ??

      result?.page_list

      ??

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

        ??

        result?.row_count
      );


    if (
      !pageList.length
    ) {

      break;
    }


    if (
      pageList.length < 100
    ) {

      break;
    }


    if (
      rowCount !== null &&
      rows.length >=
      rowCount
    ) {

      break;
    }


    page++;
  }


  return rows;
}


/* ============================================================================
   DADOS REALTIME DA PRÓPRIA USINA
============================================================================ */

/*
 * Essa parte é importante.
 *
 * O iSolarCloud possui um pseudo-dispositivo
 * representando a planta:
 *
 * device_type = 11
 *
 * ps_key:
 *
 * ID_USINA_11_0_0
 */
async function getPlantRealtime(
  client,
  psId
) {

  const psKey =
    `${psId}_${PLANT_DEVICE_TYPE}_0_0`;


  const pointIds =
    Object.keys(
      PLANT_POINTS
    );


  try {

    const result =
      await client.post(

        '/openapi/getDeviceRealTimeData',

        {

          device_type:
            PLANT_DEVICE_TYPE,

          ps_key_list:
            [
              psKey
            ],

          point_id_list:
            pointIds,

          is_get_point_dict:
            '0'
        }
      );


    const list =

      result?.device_point_list

      ??

      result?.devicePointList

      ??

      [];


    if (
      !Array.isArray(
        list
      )

      ||

      !list.length
    ) {

      return {};
    }


    const first =
      list[0];


    /*
     * Algumas respostas vêm:
     *
     * {
     *   device_point: {...}
     * }
     *
     * outras vêm diretamente.
     */
    const dp =

      first &&
      typeof first === 'object' &&
      first.device_point &&
      typeof first.device_point === 'object'

        ?

        first.device_point

        :

        first;


    if (
      !dp ||
      typeof dp !== 'object'
    ) {

      return {};
    }


    const out = {

      dev_status:
        dp.dev_status ??
        null,

      dev_fault_status:
        dp.dev_fault_status ??
        null
    };


    for (
      const [
        pointId,
        definition
      ] of Object.entries(
        PLANT_POINTS
      )
    ) {

      const raw =
        dp[
          `p${pointId}`
        ];


      if (
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === '--'
      ) {

        continue;
      }


      if (
        definition.key ===
          'power_kw'

        ||

        definition.key ===
          'load_kw'

        ||

        definition.key ===
          'grid_kw'

        ||

        definition.key ===
          'pv_power_kw'
      ) {

        out[
          definition.key
        ] =
          normalizePowerKw(
            raw,
            definition.unit
          );
      }


      else if (
        definition.key ===
        'battery_soc'
      ) {

        out[
          definition.key
        ] =
          normalizePercent(
            raw,
            definition.unit
          );
      }


      else {

        out[
          definition.key
        ] =
          normalizeEnergyKwh(
            raw,
            definition.unit
          );
      }
    }


    return compactObject(
      out
    );

  }

  catch {

    /*
     * Se realtime falhar,
     * continua utilizando
     * getPowerStationList.
     */
    return {};
  }
}


/* ============================================================================
   FILTRO DA USINA
============================================================================ */

function filterPlants(
  rows,
  c
) {

  let result =
    [...rows];


  /*
   * PLANT_ID tem prioridade.
   */
  if (
    c.plant_id
  ) {

    return result.filter(

      row =>

        String(
          pickPlantId(
            row
          )
        )
        ===
        String(
          c.plant_id
        )
    );
  }


  /*
   * Caso haja várias usinas,
   * procura pelo nome exato.
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

          pickPlantName(
            row
          )
            .trim()
            .toLowerCase()

          ===

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
   STATUS DO EQUIPAMENTO
============================================================================ */

function deviceStatus(
  raw
) {

  /*
   * Na resposta real da sua Sungrow:
   *
   * dev_status = 1
   *
   * representa ativo/online.
   */
  const devStatus =

    raw?.dev_status

    ??

    raw?.device_status

    ??

    raw?.device_state

    ??

    raw?.status;


  if (
    String(
      devStatus
    ) === '1'
  ) {

    return 'online';
  }


  if (
    String(
      devStatus
    ) === '0'
  ) {

    return 'offline';
  }


  /*
   * rel_state também aparece
   * na resposta real.
   */
  if (
    raw?.rel_state !==
      undefined

    &&

    raw?.rel_state !==
      null
  ) {

    if (
      String(
        raw.rel_state
      ) === '1'
    ) {

      return 'online';
    }


    if (
      String(
        raw.rel_state
      ) === '0'
    ) {

      return 'offline';
    }
  }


  return normalizeStatus(
    devStatus
  );
}


/* ============================================================================
   NORMALIZA OS EQUIPAMENTOS
============================================================================ */

function normalizeDevices(
  rows
) {

  const map =
    new Map();


  rows.forEach(
    (
      raw,
      index
    ) => {

      const psKey =
        pickDeviceKey(
          raw
        );


      const sn =
        pickDeviceSn(
          raw
        );


      const key =

        psKey

        ||

        `${sn}:${raw?.device_type ?? raw?.deviceType ?? index}`;


      const item =
        compactObject({

          sn,

          ps_key:
            psKey,

          name:
            pickDeviceName(
              raw,
              index
            ),

          type:
            raw?.device_type
            ??
            raw?.deviceType
            ??
            null,

          type_name:
            pickText(
              raw,
              [
                'type_name',
                'typeName'
              ]
            ),

          model:
            pickText(
              raw,
              [
                'device_model_code',
                'deviceModelCode',
                'device_model',
                'deviceModel'
              ]
            ),

          status:
            deviceStatus(
              raw
            ),

          communication_dev_sn:
            pickText(
              raw,
              [
                'communication_dev_sn',
                'communicationDevSn'
              ]
            ),

          updated_at:
            safeIso(

              raw?.rel_time

              ??

              raw?.last_update_time

              ??

              raw?.update_time
            ),

          raw
        });


      /*
       * ps_key é único.
       *
       * Isso também evita
       * equipamentos duplicados.
       */
      map.set(
        key,
        item
      );
    }
  );


  return [
    ...map.values()
  ];
}


/* ============================================================================
   RESUMO DOS EQUIPAMENTOS
============================================================================ */

function summarizeDevices(
  devices
) {

  let online =
    0;

  let offline =
    0;

  let alarm =
    0;

  let unknown =
    0;


  for (
    const device of devices
  ) {

    if (
      device.status ===
      'online'
    ) {

      online++;
    }


    else if (
      device.status ===
      'offline'
    ) {

      offline++;
    }


    else if (
      device.status ===
      'alarm'
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

function plantStatus(
  raw,
  realtime,
  summary,
  powerKw,
  todayKwh
) {

  const psStatus =

    raw?.ps_status

    ??

    raw?.psStatus

    ??

    raw?.status;


  /*
   * Na sua resposta real:
   *
   * ps_status = 1
   *
   * significa online/normal.
   */
  if (
    String(
      psStatus
    ) === '1'
  ) {

    return 'online';
  }


  const normalized =
    normalizeStatus(
      psStatus
    );


  if (
    normalized === 'online' ||
    normalized === 'offline' ||
    normalized === 'alarm'
  ) {

    return normalized;
  }


  if (
    String(
      realtime?.dev_status
    ) === '1'
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


  if (
    Number.isFinite(
      powerKw
    )

    &&

    powerKw > 0
  ) {

    return 'online';
  }


  if (
    Number.isFinite(
      todayKwh
    )

    &&

    todayKwh > 0
  ) {

    return 'online';
  }


  if (
    summary.total_devices >
      0

    &&

    summary.offline_devices ===
      summary.total_devices
  ) {

    return 'offline';
  }


  return 'unknown';
}


/* ============================================================================
   MÉTRICAS DA LISTA DA USINA
============================================================================ */

function plantListMetrics(
  p
) {

  /*
   * Aqui estão as correções mais importantes.
   *
   * SUA API REAL RETORNA:
   *
   * curr_power
   * today_energy
   * total_energy
   * total_capcity
   *
   * e esses campos são objetos:
   *
   * {
   *    unit: "...",
   *    value: "..."
   * }
   */

  return {

    power_kw:

      firstNonNull(

        normalizePowerKw(
          p?.curr_power
        ),

        normalizePowerKw(
          p?.current_power
        ),

        normalizePowerKw(
          p?.power
        )
      ),


    today_kwh:

      firstNonNull(

        normalizeEnergyKwh(
          p?.today_energy
        ),

        normalizeEnergyKwh(
          p?.day_energy
        ),

        normalizeEnergyKwh(
          p?.e_day
        )
      ),


    month_kwh:

      firstNonNull(

        normalizeEnergyKwh(
          p?.month_energy
        ),

        normalizeEnergyKwh(
          p?.monthly_energy
        ),

        normalizeEnergyKwh(
          p?.e_month
        )
      ),


    year_kwh:

      firstNonNull(

        normalizeEnergyKwh(
          p?.year_energy
        ),

        normalizeEnergyKwh(
          p?.yearly_energy
        ),

        normalizeEnergyKwh(
          p?.e_year
        )
      ),


    total_kwh:

      firstNonNull(

        normalizeEnergyKwh(
          p?.total_energy
        ),

        normalizeEnergyKwh(
          p?.e_total
        )
      ),


    capacity_kw:

      firstNonNull(

        /*
         * SIM:
         *
         * a API usa "capcity"
         * sem o segundo A.
         */
        normalizeCapacityKw(
          p?.total_capcity
        ),

        normalizeCapacityKw(
          p?.total_capacity
        ),

        normalizeCapacityKw(
          p?.installed_power
        ),

        normalizeCapacityKw(
          p?.installed_capacity
        ),

        normalizeCapacityKw(
          p?.capacity
        )
      )
  };
}


/* ============================================================================
   FUNÇÃO PRINCIPAL
============================================================================ */

export async function getISolarCloudData(
  c
) {

  /*
   * ==========================================================
   * CREDENCIAIS
   * ==========================================================
   */

  if (
    !c.user
  ) {

    throw new SolarConnectorError(

      'Configure USER deste acesso iSolarCloud.',

      'CONFIG'
    );
  }


  if (
    !c.password
  ) {

    throw new SolarConnectorError(

      'Configure PASSWORD deste acesso iSolarCloud.',

      'CONFIG'
    );
  }


  if (
    !c.app_key
  ) {

    throw new SolarConnectorError(

      'Configure APP_KEY do Developer Portal iSolarCloud.',

      'CONFIG'
    );
  }


  if (
    !c.secret_key
  ) {

    throw new SolarConnectorError(

      'Configure SECRET_KEY do Developer Portal iSolarCloud.',

      'CONFIG'
    );
  }


  /*
   * ==========================================================
   * API
   * ==========================================================
   */

  const base =
    baseUrl(
      c
    );


  const client =
    createClient(
      base,
      c
    );


  /*
   * Gera token automaticamente.
   */
  await client.login();


  /*
   * ==========================================================
   * USINAS
   * ==========================================================
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
   * ==========================================================
   * CADA USINA
   * ==========================================================
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
     * Busca equipamentos e
     * dados agregados da planta
     * em paralelo.
     */
    const [
      deviceRows,
      realtime
    ] =
      await Promise.all([

        getDevices(
          client,
          psId
        )
          .catch(
            () => []
          ),

        getPlantRealtime(
          client,
          psId
        )
          .catch(
            () => ({})
          )
      ]);


    /*
     * ========================================================
     * EQUIPAMENTOS
     * ========================================================
     */

    const devices =
      normalizeDevices(

        Array.isArray(
          deviceRows
        )

          ?

          deviceRows

          :

          []
      );


    const summary =
      summarizeDevices(
        devices
      );


    /*
     * ========================================================
     * DADOS DA LISTA
     * ========================================================
     */

    const listMetrics =
      plantListMetrics(
        p
      );


    /*
     * ========================================================
     * POTÊNCIA
     * ========================================================
     *
     * Primeiro realtime.
     *
     * Depois curr_power
     * do getPowerStationList.
     */

    const powerKw =
      firstNonNull(

        realtime.power_kw,

        realtime.pv_power_kw,

        listMetrics.power_kw
      );


    /*
     * ========================================================
     * GERAÇÃO HOJE
     * ========================================================
     */

    const todayKwh =
      firstNonNull(

        realtime.today_kwh,

        listMetrics.today_kwh
      );


    /*
     * ========================================================
     * GERAÇÃO TOTAL
     * ========================================================
     */

    const totalKwh =
      firstNonNull(

        realtime.total_kwh,

        listMetrics.total_kwh
      );


    /*
     * ========================================================
     * MÊS / ANO
     * ========================================================
     */

    const monthKwh =
      listMetrics.month_kwh;


    const yearKwh =
      listMetrics.year_kwh;


    /*
     * ========================================================
     * CAPACIDADE
     * ========================================================
     */

    const capacityKw =
      listMetrics.capacity_kw;


    /*
     * ========================================================
     * FINANCEIRO / RECEITA
     * ========================================================
     */

    const finance =
      plantFinancialMetrics(

        p,

        c,

        {
          todayKwh,
          monthKwh,
          yearKwh,
          totalKwh
        }
      );


    /*
     * ========================================================
     * STATUS
     * ========================================================
     */

    const status =
      plantStatus(

        p,

        realtime,

        summary,

        powerKw,

        todayKwh
      );


    /*
     * ========================================================
     * ÚLTIMA ATUALIZAÇÃO
     * ========================================================
     */

    const updatedAt =
      safeIso(

        p?.curr_power_update_time

        ??

        p?.today_energy_update_time

        ??

        p?.total_energy_update_time

        ??

        p?.update_time
      );


    /*
     * ========================================================
     * RESULTADO
     * ========================================================
     */

    plants.push(

      compactObject({

        id:
          psId,


        name:

          pickPlantName(
            p
          )

          ||

          c.plant

          ||

          `Usina ${psId}`,


        status,


        /*
         * CAPACIDADE
         */
        capacity_kw:
          capacityKw,


        /*
         * POTÊNCIA ATUAL
         */
        power_kw:
          powerKw,


        /*
         * GERAÇÃO HOJE
         */
        today_kwh:
          todayKwh,


        /*
         * GERAÇÃO MÊS
         */
        month_kwh:
          monthKwh,


        /*
         * GERAÇÃO ANO
         */
        year_kwh:
          yearKwh,


        /*
         * GERAÇÃO TOTAL
         */
        total_kwh:
          totalKwh,


        /*
         * FINANCEIRO / RECEITA
         */
        currency:
          finance.currency,


        tariff_per_kwh:
          finance.tariff_per_kwh,


        tariff_source:
          finance.tariff_source,


        revenue_today:
          finance.revenue_today,


        revenue_month:
          finance.revenue_month,


        revenue_year:
          finance.revenue_year,


        revenue_total:
          finance.revenue_total,


        revenue_source:
          finance.revenue_source,


        revenue_today_brl:
          finance.revenue_today_brl,


        revenue_month_brl:
          finance.revenue_month_brl,


        revenue_year_brl:
          finance.revenue_year_brl,


        revenue_total_brl:
          finance.revenue_total_brl,


        /*
         * CARGA
         */
        load_kw:

          firstNonNull(

            realtime.load_kw,

            null
          ),


        /*
         * REDE
         */
        grid_kw:

          firstNonNull(

            realtime.grid_kw,

            null
          ),


        /*
         * BATERIA
         */
        battery_soc:

          firstNonNull(

            realtime.battery_soc,

            null
          ),


        /*
         * EQUIPAMENTOS
         */
        total_devices:
          summary.total_devices,


        online_devices:
          summary.online_devices,


        offline_devices:
          summary.offline_devices,


        alarm_devices:
          summary.alarm_devices,


        unknown_devices:
          summary.unknown_devices,


        /*
         * LOCALIZAÇÃO
         */
        latitude:
          numberOf(
            p?.latitude
          ),


        longitude:
          numberOf(
            p?.longitude
          ),


        location:
          pickText(
            p,
            [
              'ps_location',
              'location',
              'address'
            ]
          ),


        timezone:
          pickText(
            p,
            [
              'ps_current_time_zone',
              'timezone'
            ]
          ),


        installed_at:
          p?.install_date ||
          null,


        updated_at:
          updatedAt,


        /*
         * DISPOSITIVOS
         */
        devices,


        /*
         * DEBUG
         *
         * NUNCA colocamos:
         *
         * senha
         * token
         * app key
         * secret key
         */
        raw: {

          plant:
            p,

          realtime
        }
      })
    );
  }


  /*
   * ==========================================================
   * RESPOSTA FINAL
   * ==========================================================
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
      'Dados da planta obtidos pela Monitoring API, incluindo receita oficial quando exposta pelo iSolarCloud. Token gerado automaticamente pelo backend.'
  };
}
