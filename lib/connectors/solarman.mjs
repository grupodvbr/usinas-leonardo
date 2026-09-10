import crypto from 'node:crypto';

import {
  SolarConnectorError,
  fetchJson,
  numberOf,
  normalizeStatus,
  isoFromAny,
  compactObject
} from '../solar-utils.mjs';


/*
 * ============================================================================
 * SOLARMAN OPENAPI
 * ============================================================================
 *
 * Variáveis esperadas:
 *
 * SOLAR_SOLARMAN_01_USER
 * SOLAR_SOLARMAN_01_PASSWORD
 * SOLAR_SOLARMAN_01_APP_ID
 * SOLAR_SOLARMAN_01_APP_SECRET
 *
 * Opcionais:
 *
 * SOLAR_SOLARMAN_01_PLANT_ID
 * SOLAR_SOLARMAN_01_API_BASE
 *
 * Fallback financeiro opcional:
 *
 * SOLAR_SOLARMAN_01_TARIFF_BRL
 *
 * Exemplo:
 *
 * SOLAR_SOLARMAN_01_TARIFF_BRL=0.95
 *
 * IMPORTANTE:
 *
 * A SOLARMAN possui, nos dados básicos da usina:
 *
 * - currency
 * - mergeElectricPrice
 *
 * O conector usa esses campos para calcular o valor financeiro
 * da energia gerada.
 *
 * A geração diária, mensal e anual é obtida pela rota oficial:
 *
 * /station/v1.0/history
 *
 * timeType:
 *
 * 2 = dia
 * 3 = mês
 * 4 = ano
 *
 * Assim o front recebe:
 *
 * today_kwh
 * month_kwh
 * year_kwh
 * total_kwh
 *
 * além de:
 *
 * revenue_today
 * revenue_month
 * revenue_year
 * revenue_total
 *
 * e, quando a moeda é BRL:
 *
 * revenue_today_brl
 * revenue_month_brl
 * revenue_year_brl
 * revenue_total_brl
 * ============================================================================
 */


function baseUrl(
  c
) {

  return (
    c.api_base ||
    'https://globalapi.solarmanpv.com'
  ).replace(
    /\/+$/,
    ''
  );
}


async function post(
  base,
  path,
  body,
  token = null
) {

  const headers = {

    'content-type':
      'application/json',

    accept:
      'application/json',

    'user-agent':
      'SolarCentral/4.0'
  };


  if (token) {

    headers.authorization =
      `bearer ${token}`;
  }


  return (
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

      20000
    )
  ).data;
}


/* ============================================================================
   HELPERS
============================================================================ */


function cleanText(
  value
) {

  return String(
    value ?? ''
  ).trim();
}


function normalizeCurrency(
  value
) {

  const raw =
    cleanText(
      value
    ).toUpperCase();


  if (!raw) {
    return '';
  }


  if (
    raw === 'BRL' ||
    raw === 'R$' ||
    raw === 'REAL' ||
    raw === 'REAIS'
  ) {

    return 'BRL';
  }


  if (
    raw === 'USD' ||
    raw === 'US$' ||
    raw === '$'
  ) {

    return 'USD';
  }


  if (
    raw === 'EUR' ||
    raw === '€'
  ) {

    return 'EUR';
  }


  if (
    raw === 'CNY' ||
    raw === 'RMB' ||
    raw === '¥' ||
    raw === '￥'
  ) {

    return 'CNY';
  }


  return raw;
}


function slotNumber(
  c
) {

  return String(
    c?.slot || 1
  ).padStart(
    2,
    '0'
  );
}


function envTariffBrl(
  c
) {

  const slot =
    slotNumber(
      c
    );


  const names = [

    `SOLAR_SOLARMAN_${slot}_TARIFF_BRL`,

    'SOLAR_SOLARMAN_TARIFF_BRL'
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


function localDateParts() {

  const now =
    new Date();


  const year =
    now.getFullYear();


  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      '0'
    );


  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      '0'
    );


  return {
    year,
    month,
    day
  };
}


/* ============================================================================
   TOKEN
============================================================================ */


async function getToken(
  c,
  base
) {

  const passhash =

    crypto
      .createHash(
        'sha256'
      )
      .update(
        c.password
      )
      .digest(
        'hex'
      );


  const ident =

    c.user.includes(
      '@'
    )

      ? {
          email:
            c.user
        }

      : {
          username:
            c.user
        };


  const tokenData =
    await post(

      base,

      `/account/v1.0/token?appId=${encodeURIComponent(
        c.app_id_key
      )}&language=en`,

      {

        appSecret:
          c.app_secret,

        password:
          passhash,

        ...ident
      }
    );


  if (
    tokenData?.success ===
      false ||
    !tokenData?.access_token
  ) {

    throw new SolarConnectorError(

      tokenData?.msg ||
      tokenData?.code ||
      'Não foi possível obter token SOLARMAN.',

      'AUTH',

      tokenData
    );
  }


  return tokenData.access_token;
}


/* ============================================================================
   PLANTAS
============================================================================ */


async function getStationList(
  base,
  token
) {

  const list =
    await post(

      base,

      '/station/v1.0/list?language=en',

      {

        page: 1,
        size: 100
      },

      token
    );


  if (
    list?.success ===
      false
  ) {

    throw new SolarConnectorError(

      list?.msg ||
      'Falha ao listar usinas SOLARMAN.',

      'UPSTREAM',

      list
    );
  }


  return Array.isArray(
    list?.stationList
  )
    ? list.stationList
    : [];
}


async function getStationBase(
  base,
  token,
  stationId
) {

  try {

    const data =
      await post(

        base,

        '/station/v1.0/base?language=en',

        {
          stationId
        },

        token
      );


    if (
      data?.success ===
        false
    ) {

      return null;
    }


    return data;

  } catch {

    return null;
  }
}


async function getStationRealtime(
  base,
  token,
  stationId
) {

  try {

    const data =
      await post(

        base,

        '/station/v1.0/realTime?language=en',

        {
          stationId
        },

        token
      );


    if (
      data?.success ===
        false
    ) {

      return {
        _error:
          data?.msg ||
          data?.code ||
          'Falha na leitura realtime'
      };
    }


    return data;

  } catch (error) {

    return {
      _error:
        error?.message ||
        String(
          error
        )
    };
  }
}


/* ============================================================================
   HISTÓRICO DE GERAÇÃO
============================================================================ */


async function getStationHistory(
  base,
  token,
  stationId,
  timeType,
  startTime,
  endTime
) {

  try {

    const body = {

      stationId,
      timeType,
      startTime
    };


    if (endTime) {

      body.endTime =
        endTime;
    }


    const data =
      await post(

        base,

        '/station/v1.0/history?language=en',

        body,

        token
      );


    if (
      data?.success ===
        false
    ) {

      return [];
    }


    return Array.isArray(
      data?.stationDataItems
    )
      ? data.stationDataItems
      : [];

  } catch {

    return [];
  }
}


function sumGeneration(
  rows
) {

  let total = 0;
  let found = false;


  for (
    const row of rows || []
  ) {

    const value =
      numberOf(
        row?.generationValue
      );


    if (
      value !== null
    ) {

      total +=
        value;

      found =
        true;
    }
  }


  return found
    ? total
    : null;
}


async function loadEnergyPeriods(
  base,
  token,
  stationId
) {

  const {
    year,
    month,
    day
  } =
    localDateParts();


  const today =
    `${year}-${month}-${day}`;


  const currentMonth =
    `${year}-${month}`;


  const currentYear =
    String(
      year
    );


  const [
    todayRows,
    monthRows,
    yearRows
  ] =
    await Promise.all([

      getStationHistory(
        base,
        token,
        stationId,
        2,
        today,
        today
      ),

      getStationHistory(
        base,
        token,
        stationId,
        3,
        currentMonth,
        currentMonth
      ),

      getStationHistory(
        base,
        token,
        stationId,
        4,
        currentYear,
        currentYear
      )
    ]);


  return {

    today_kwh:
      sumGeneration(
        todayRows
      ),

    month_kwh:
      sumGeneration(
        monthRows
      ),

    year_kwh:
      sumGeneration(
        yearRows
      ),

    raw: {

      today:
        todayRows,

      month:
        monthRows,

      year:
        yearRows
    }
  };
}


/* ============================================================================
   FINANCEIRO
============================================================================ */


function financialData({
  c,
  station,
  stationBase,
  todayKwh,
  monthKwh,
  yearKwh,
  totalKwh
}) {

  /*
   * A SOLARMAN expõe no cadastro/base da estação:
   *
   * currency
   * mergeElectricPrice
   *
   * mergeElectricPrice = preço da energia / kWh.
   */
  let tariff =

    numberOf(
      stationBase?.mergeElectricPrice
    )

    ??

    numberOf(
      station?.mergeElectricPrice
    );


  let tariffSource =

    tariff !== null

      ? 'solarman'

      : null;


  let currency =

    normalizeCurrency(
      stationBase?.currency
    )

    ||

    normalizeCurrency(
      station?.currency
    );


  /*
   * Fallback opcional:
   * tarifa cadastrada manualmente na Vercel em BRL.
   */
  if (
    tariff === null
  ) {

    const manual =
      envTariffBrl(
        c
      );


    if (
      manual !== null
    ) {

      tariff =
        manual;

      tariffSource =
        'vercel';

      currency =
        'BRL';
    }
  }


  function calc(
    kwh
  ) {

    if (
      tariff === null ||
      kwh === null ||
      !Number.isFinite(
        Number(
          kwh
        )
      )
    ) {

      return null;
    }


    return (
      Number(
        kwh
      ) *
      tariff
    );
  }


  const revenueToday =
    calc(
      todayKwh
    );


  const revenueMonth =
    calc(
      monthKwh
    );


  const revenueYear =
    calc(
      yearKwh
    );


  const revenueTotal =
    calc(
      totalKwh
    );


  const hasRevenue =
    [
      revenueToday,
      revenueMonth,
      revenueYear,
      revenueTotal
    ].some(
      value =>
        value !== null
    );


  return {

    currency:
      currency || null,

    tariff_per_kwh:
      tariff,

    tariff_source:
      tariffSource,

    revenue_today:
      revenueToday,

    revenue_month:
      revenueMonth,

    revenue_year:
      revenueYear,

    revenue_total:
      revenueTotal,

    revenue_source:

      hasRevenue

        ? (
            tariffSource ===
              'solarman'

              ? 'calculated_from_solarman_tariff'

              : 'calculated_from_vercel_tariff'
          )

        : 'unavailable',

    revenue_today_brl:
      currency === 'BRL'
        ? revenueToday
        : null,

    revenue_month_brl:
      currency === 'BRL'
        ? revenueMonth
        : null,

    revenue_year_brl:
      currency === 'BRL'
        ? revenueYear
        : null,

    revenue_total_brl:
      currency === 'BRL'
        ? revenueTotal
        : null
  };
}


/* ============================================================================
   EXPORT PRINCIPAL
============================================================================ */


export async function getSolarmanData(
  c
) {

  if (
    !c.user ||
    !c.password ||
    !c.app_id_key ||
    !c.app_secret
  ) {

    throw new SolarConnectorError(

      'SOLARMAN exige USER, PASSWORD, APP_ID e APP_SECRET da OpenAPI.',

      'CONFIG'
    );
  }


  const base =
    baseUrl(
      c
    );


  const token =
    await getToken(
      c,
      base
    );


  let rows =
    await getStationList(
      base,
      token
    );


  if (
    c.plant_id
  ) {

    rows =
      rows.filter(
        x =>
          String(
            x.id
          ) ===
          String(
            c.plant_id
          )
      );
  }


  const plants = [];


  for (
    const s of rows.slice(
      0,
      30
    )
  ) {

    const stationId =
      s.id;


    const [
      rt,
      stationBase,
      energy
    ] =
      await Promise.all([

        getStationRealtime(
          base,
          token,
          stationId
        ),

        getStationBase(
          base,
          token,
          stationId
        ),

        loadEnergyPeriods(
          base,
          token,
          stationId
        )
      ]);


    const totalKwh =

      numberOf(
        rt?.generationTotal
      )

      ??

      numberOf(
        s?.generationTotal
      );


    const todayKwh =

      energy.today_kwh

      ??

      numberOf(
        rt?.generationToday
      )

      ??

      numberOf(
        s?.generationToday
      );


    const monthKwh =

      energy.month_kwh

      ??

      numberOf(
        rt?.generationMonth
      )

      ??

      numberOf(
        s?.generationMonth
      );


    const yearKwh =

      energy.year_kwh

      ??

      numberOf(
        rt?.generationYear
      )

      ??

      numberOf(
        s?.generationYear
      );


    const finance =
      financialData({

        c,

        station:
          s,

        stationBase,

        todayKwh,

        monthKwh,

        yearKwh,

        totalKwh
      });


    plants.push(

      compactObject({

        id:
          String(
            stationId
          ),

        name:

          stationBase?.name

          ||

          s.name

          ||

          c.plant

          ||

          `Usina ${stationId}`,


        status:
          normalizeStatus(
            s.networkStatus
          ),


        capacity_kw:

          numberOf(
            stationBase?.installedCapacity
          )

          ??

          numberOf(
            s.installedCapacity
          ),


        power_kw:

          numberOf(
            rt.generationPower ??
            s.generationPower
          ) !== null

            ? numberOf(
                rt.generationPower ??
                s.generationPower
              ) / 1000

            : null,


        load_kw:

          numberOf(
            rt.usePower
          ) !== null

            ? numberOf(
                rt.usePower
              ) / 1000

            : null,


        grid_kw:

          numberOf(
            rt.gridPower
          ) !== null

            ? numberOf(
                rt.gridPower
              ) / 1000

            : null,


        today_kwh:
          todayKwh,


        month_kwh:
          monthKwh,


        year_kwh:
          yearKwh,


        total_kwh:
          totalKwh,


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


        battery_soc:

          numberOf(
            rt.batterySoc ??
            s.batterySoc
          ),


        updated_at:

          isoFromAny(
            rt.lastUpdateTime ??
            s.lastUpdateTime
          ),


        network_status:
          s.networkStatus || null,


        raw: {

          station:
            s,

          station_base:
            stationBase,

          realtime:
            rt,

          history:
            energy.raw
        }
      })
    );
  }


  return {

    provider:
      'solarman',

    source:
      'SOLARMAN OpenAPI',

    plants,

    checked_at:
      new Date()
        .toISOString(),

    notes:
      'Usa histórico oficial SOLARMAN para geração diária/mensal/anual e currency + mergeElectricPrice para cálculo financeiro.'
  };
}
