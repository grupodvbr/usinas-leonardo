import {
  readCredentials,
  integrationMissing
} from '../lib/core.mjs';

import {
  getProviderData
} from '../lib/connectors/index.mjs';


/* =========================================================
   OTTO SOLAR • MONITOR AUTOMÁTICO
   =========================================================

   OBJETIVO

   - Executar no servidor
   - Não depende do index.html
   - Não depende do painel aberto
   - Consulta TODAS as integrações
   - Verifica TODAS as usinas
   - Detecta OFFLINE
   - Envia para /api/alerta
   - Compatível com Vercel Cron
   - Pode ser chamado manualmente
   - Evita que erro de uma plataforma derrube as outras

   PROVIDERS

   - ShinePhone / Growatt
   - iSolarCloud / Sungrow
   - Elekeeper / SAJ
   - SOLARMAN

   ========================================================= */


/* =========================================================
   CONFIGURAÇÃO
   ========================================================= */

const TIMEZONE =
  'America/Bahia';

const REQUEST_TIMEOUT =
  Number(
    process.env.MONITOR_REQUEST_TIMEOUT ||
    55000
  );

const ALERT_TIMEOUT =
  Number(
    process.env.ALERTA_REQUEST_TIMEOUT ||
    15000
  );


/* =========================================================
   RESPONSE
   ========================================================= */

function responseJson(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'no-store, no-cache, must-revalidate',

        'Pragma':
          'no-cache'
      }
    }
  );
}


/* =========================================================
   TEXTO
   ========================================================= */

function text(
  value,
  fallback = ''
) {

  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const result =
    String(value).trim();

  return result || fallback;
}


/* =========================================================
   NORMALIZA STATUS
   ========================================================= */

function normalizeStatus(
  value
) {

  const status =
    text(value)
      .toLowerCase()
      .trim();

  if (
    status === 'offline' ||
    status === 'off-line' ||
    status === 'off_line' ||
    status === 'disconnected' ||
    status === 'disconnect' ||
    status === 'inactive'
  ) {
    return 'offline';
  }

  if (
    status === 'online' ||
    status === 'normal' ||
    status === 'running' ||
    status === 'connected'
  ) {
    return 'online';
  }

  if (
    status === 'alarm' ||
    status === 'fault' ||
    status === 'error'
  ) {
    return 'alarm';
  }

  if (
    status === 'warning' ||
    status === 'warn'
  ) {
    return 'warning';
  }

  return status || 'unknown';
}


/* =========================================================
   NOME DO PROVIDER
   ========================================================= */

function providerName(
  provider
) {

  switch (
    text(provider).toLowerCase()
  ) {

    case 'shinephone':
      return 'Growatt / ShinePhone';

    case 'growatt':
      return 'Growatt / ShinePhone';

    case 'isolarcloud':
      return 'Sungrow / iSolarCloud';

    case 'elekeeper':
      return 'SAJ / Elekeeper';

    case 'saj':
      return 'SAJ / Elekeeper';

    case 'solarman':
      return 'SOLARMAN Smart';

    default:
      return text(
        provider,
        'Solar'
      );
  }
}


/* =========================================================
   URL BASE DO PROJETO
   ========================================================= */

function getBaseUrl(
  request
) {

  /*
   * MELHOR OPÇÃO:
   *
   * Configure na Vercel:
   *
   * APP_URL=https://seu-projeto.vercel.app
   */

  if (
    process.env.APP_URL
  ) {

    return String(
      process.env.APP_URL
    )
      .replace(
        /\/+$/,
        ''
      );
  }


  /*
   * URL ESPECÍFICA DO ALERTA
   *
   * Se estiver configurada:
   *
   * ALERTA_API_URL=https://site.vercel.app/api/alerta
   *
   * pegamos apenas a origem.
   */

  if (
    process.env.ALERTA_API_URL
  ) {

    try {

      const url =
        new URL(
          process.env.ALERTA_API_URL
        );

      return url.origin;

    } catch {
      // continua
    }
  }


  /*
   * VERCEL PRODUÇÃO
   */

  const production =
    process.env
      .VERCEL_PROJECT_PRODUCTION_URL;

  if (
    production
  ) {

    const host =
      String(production);

    return (
      /^https?:\/\//i.test(host)
        ? host
        : `https://${host}`
    )
      .replace(
        /\/+$/,
        ''
      );
  }


  /*
   * DEPLOY ATUAL
   */

  const vercel =
    process.env
      .VERCEL_URL;

  if (
    vercel
  ) {

    const host =
      String(vercel);

    return (
      /^https?:\/\//i.test(host)
        ? host
        : `https://${host}`
    )
      .replace(
        /\/+$/,
        ''
      );
  }


  /*
   * ÚLTIMO FALLBACK:
   * origem da própria requisição
   */

  try {

    return new URL(
      request.url
    ).origin;

  } catch {

    return '';
  }
}


/* =========================================================
   URL DA API DE ALERTA
   ========================================================= */

function getAlertUrl(
  request
) {

  if (
    process.env.ALERTA_API_URL
  ) {

    return String(
      process.env.ALERTA_API_URL
    );
  }

  const base =
    getBaseUrl(
      request
    );

  if (!base) {
    return null;
  }

  return (
    `${base}/api/alerta`
  );
}


/* =========================================================
   SEGREDO DO ALERTA
   ========================================================= */

function getAlertSecret() {

  return (

    process.env
      .ALERTA_INTERNAL_SECRET

    ||

    process.env
      .SESSION_SECRET

    ||

    ''

  );
}


/* =========================================================
   SEGURANÇA DO MONITOR MANUAL
   ========================================================= */

function getMonitorSecret() {

  return (

    process.env
      .MONITOR_SECRET

    ||

    process.env
      .CRON_SECRET

    ||

    process.env
      .ALERTA_INTERNAL_SECRET

    ||

    process.env
      .SESSION_SECRET

    ||

    ''

  );
}


/* =========================================================
   IDENTIFICA VERCEL CRON
   ========================================================= */

function isVercelCron(
  request
) {

  const userAgent =
    text(
      request.headers.get(
        'user-agent'
      )
    )
      .toLowerCase();

  return (
    userAgent.includes(
      'vercel-cron'
    )
  );
}


/* =========================================================
   AUTORIZAÇÃO
   ========================================================= */

function isAuthorized(
  request
) {

  /*
   * Vercel Cron pode executar.
   */

  if (
    isVercelCron(
      request
    )
  ) {
    return true;
  }


  /*
   * Também permite Bearer CRON_SECRET,
   * padrão da Vercel.if (!isAuthorized(request))
   */

  const expected =
    getMonitorSecret();

  if (!expected) {

    /*
     * Sem segredo configurado:
     * não deixa endpoint público.
     */

    return false;
  }


  const authorization =
    text(
      request.headers.get(
        'authorization'
      )
    );

  if (
    authorization ===
    `Bearer ${expected}`
  ) {
    return true;
  }


  /*
   * Permite chamada manual:
   *
   * x-monitor-secret
   */

  const internal =
    text(
      request.headers.get(
        'x-monitor-secret'
      )
    );

  if (
    internal &&
    internal === expected
  ) {
    return true;
  }


  /*
   * Compatibilidade:
   * x-alert-secret
   */

  const alertSecret =
    text(
      request.headers.get(
        'x-alert-secret'
      )
    );

  if (
    alertSecret &&
    alertSecret === expected
  ) {
    return true;
  }


  return false;
}


/* =========================================================
   FETCH COM TIMEOUT
   ========================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 15000
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      timeout
    );

  try {

    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal
      }
    );

  } finally {

    clearTimeout(
      timer
    );
  }
}


/* =========================================================
   EXECUTA PROVIDER COM TIMEOUT
   ========================================================= */

async function providerWithTimeout(
  credential
) {

  return await Promise.race([

    getProviderData(
      credential
    ),

    new Promise(
      (_, reject) => {

        setTimeout(
          () => {

            const error =
              new Error(
                'Tempo limite excedido consultando a plataforma.'
              );

            error.code =
              'PROVIDER_TIMEOUT';

            reject(
              error
            );

          },
          REQUEST_TIMEOUT
        );

      }
    )

  ]);
}


/* =========================================================
   RETORNA ARRAY DE USINAS
   ========================================================= */

function extractPlants(
  data
) {

  if (
    Array.isArray(
      data?.plants
    )
  ) {
    return data.plants;
  }

  if (
    Array.isArray(
      data?.stations
    )
  ) {
    return data.stations;
  }

  if (
    Array.isArray(
      data?.sites
    )
  ) {
    return data.sites;
  }

  return [];
}


/* =========================================================
   ID DA USINA
   ========================================================= */

function getPlantId(
  plant,
  index
) {

  return (

    plant?.id

    ??

    plant?.plant_id

    ??

    plant?.station_id

    ??

    plant?.ps_id

    ??

    plant?.sn

    ??

    plant?.device_sn

    ??

    `plant-${index + 1}`

  );
}


/* =========================================================
   NOME DA USINA
   ========================================================= */

function getPlantName(
  plant,
  credential,
  index
) {

  return text(

    plant?.name

    ??

    plant?.plant_name

    ??

    plant?.station_name

    ??

    plant?.ps_name

    ??

    credential?.plant,

    `Usina ${index + 1}`

  );
}


/* =========================================================
   STATUS DA USINA
   ========================================================= */

function getPlantStatus(
  plant
) {

  /*
   * Primeiro confia no status já calculado
   * pelos seus conectores.
   */

  const direct =
    normalizeStatus(
      plant?.status
    );

  if (
    direct !== 'unknown'
  ) {
    return direct;
  }


  /*
   * Fallback baseado nos equipamentos.
   */

  const total =
    Number(
      plant?.total_devices ||
      0
    );

  const online =
    Number(
      plant?.online_devices ||
      0
    );

  const offline =
    Number(
      plant?.offline_devices ||
      0
    );

  const alarm =
    Number(
      plant?.alarm_devices ||
      0
    );


  if (
    alarm > 0
  ) {
    return 'alarm';
  }


  /*
   * Se existem equipamentos,
   * nenhum está online
   * e pelo menos um está offline:
   * estação offline.
   */

  if (
    total > 0 &&
    online === 0 &&
    offline > 0
  ) {
    return 'offline';
  }


  /*
   * Se tem equipamento online,
   * consideramos a estação online.
   */

  if (
    online > 0
  ) {
    return 'online';
  }


  return 'unknown';
}


/* =========================================================
   ENVIA ALERTA
   ========================================================= */

async function sendAlert({
  request,
  credential,
  provider,
  plant,
  index,
  status,
  checkedAt
}) {

  const url =
    getAlertUrl(
      request
    );

  if (!url) {

    return {
      ok: false,
      sent: false,
      reason:
        'ALERTA_URL_UNAVAILABLE'
    };
  }


  const secret =
    getAlertSecret();

  if (!secret) {

    return {
      ok: false,
      sent: false,
      reason:
        'ALERTA_SECRET_UNAVAILABLE'
    };
  }


  const payload = {

    provider:
      provider,

    station_id:
      getPlantId(
        plant,
        index
      ),

    station_name:
      getPlantName(
        plant,
        credential,
        index
      ),

    status:
      status,

    company:
      text(
        credential?.company,
        'Não informado'
      ),

    label:
      text(
        credential?.label
      ),

    slot:
      credential?.slot ??
      null,

    checked_at:
      checkedAt

  };


  try {

    const response =
      await fetchWithTimeout(

        url,

        {

          method:
            'POST',

          headers: {

            'Content-Type':
              'application/json',

            'x-alert-secret':
              secret,

            'User-Agent':
              'OTTO-Solar-Monitor/1.0'

          },

          body:
            JSON.stringify(
              payload
            )

        },

        ALERT_TIMEOUT

      );


    let result = {};

    try {

      result =
        await response.json();

    } catch {

      result = {};
    }


    if (
      !response.ok
    ) {

      return {

        ok:
          false,

        sent:
          false,

        http_status:
          response.status,

        payload,

        response:
          result

      };
    }


    return {

      ok:
        true,

      sent:
        result?.whatsapp_enviado === true
        ||
        result?.alerta_disparado === true
        ||
        response.ok,

      http_status:
        response.status,

      payload,

      response:
        result

    };


  } catch (
    error
  ) {

    return {

      ok:
        false,

      sent:
        false,

      payload,

      error:
        error?.name ===
        'AbortError'

          ? 'Timeout chamando /api/alerta.'

          : (
              error?.message ||
              'Erro chamando /api/alerta.'
            )

    };
  }
}


/* =========================================================
   MONITORA UMA INTEGRAÇÃO
   ========================================================= */

async function monitorCredential(
  request,
  credential
) {

  const provider =
    text(
      credential?.app_id
    );


  const result = {

    integration: {

      provider,

      provider_name:
        providerName(
          provider
        ),

      slot:
        credential?.slot ??
        null,

      label:
        text(
          credential?.label
        ),

      company:
        text(
          credential?.company
        ),

      plant:
        text(
          credential?.plant
        )

    },

    ok:
      false,

    plants:
      [],

    alerts:
      [],

    error:
      null

  };


  /*
   * Verifica credenciais.
   */

  const missing =
    integrationMissing(
      credential
    );


  if (
    Array.isArray(missing) &&
    missing.length
  ) {

    result.error =
      'Integração não configurada.';

    result.missing =
      missing;

    return result;
  }


  /*
   * Consulta provider.
   */

  let data;


  try {

    data =
      await providerWithTimeout(
        credential
      );

  } catch (
    error
  ) {

    result.error =
      error?.message ||
      'Erro consultando plataforma.';

    result.code =
      error?.code ||
      'UPSTREAM_ERROR';

    return result;
  }


  const checkedAt =
    data?.checked_at ||
    new Date()
      .toISOString();


  const plants =
    extractPlants(
      data
    );


  result.ok =
    true;

  result.checked_at =
    checkedAt;

  result.source =
    data?.source ||
    null;

  result.total_plants =
    plants.length;


  /*
   * Percorre TODAS as usinas.
   */

  for (
    let index = 0;
    index < plants.length;
    index++
  ) {

    const plant =
      plants[index];


    const status =
      getPlantStatus(
        plant
      );


    const normalizedPlant = {

      id:
        getPlantId(
          plant,
          index
        ),

      name:
        getPlantName(
          plant,
          credential,
          index
        ),

      status,

      power_kw:
        plant?.power_kw ??
        null,

      today_kwh:
        plant?.today_kwh ??
        null,

      month_kwh:
        plant?.month_kwh ??
        null,

      total_devices:
        plant?.total_devices ??
        null,

      online_devices:
        plant?.online_devices ??
        null,

      offline_devices:
        plant?.offline_devices ??
        null,

      alarm_devices:
        plant?.alarm_devices ??
        null

    };


    result.plants.push(
      normalizedPlant
    );


    /*
     * =====================================================
     * OFFLINE
     * =====================================================
     *
     * Aqui está a parte que faltava principalmente
     * para o iSolarCloud.
     *
     * Independentemente do provider:
     *
     * status === offline
     *
     * chama /api/alerta.
     * =====================================================
     */

    if (
      status ===
      'offline'
    ) {

      console.warn(

        '[OTTO MONITOR] USINA OFFLINE',

        JSON.stringify({

          provider,

          company:
            credential?.company,

          station_id:
            normalizedPlant.id,

          station_name:
            normalizedPlant.name,

          checked_at:
            checkedAt

        })

      );


      const alert =
        await sendAlert({

          request,

          credential,

          provider,

          plant,

          index,

          status,

          checkedAt

        });


      result.alerts.push({

        station_id:
          normalizedPlant.id,

        station_name:
          normalizedPlant.name,

        status,

        ...alert

      });

    }

  }


  result.offline =
    result.plants.filter(
      plant =>
        plant.status ===
        'offline'
    ).length;


  result.online =
    result.plants.filter(
      plant =>
        plant.status ===
        'online'
    ).length;


  result.alarm =
    result.plants.filter(
      plant =>
        plant.status ===
        'alarm'
    ).length;


  result.unknown =
    result.plants.filter(
      plant =>
        plant.status ===
        'unknown'
    ).length;


  return result;
}


/* =========================================================
   HANDLER
   ========================================================= */

export default {

  async fetch(
    request
  ) {

    const startedAt =
      Date.now();


    /* =====================================================
       MÉTODO
       ===================================================== */

    if (
      request.method !==
      'GET'
    ) {

      return responseJson(
        {
          ok: false,
          error:
            'Método não permitido.'
        },
        405
      );
    }




    const checkedAt =
      new Date()
        .toISOString();


    console.log(

      '[OTTO MONITOR] INICIANDO',

      JSON.stringify({

        checked_at:
          checkedAt,

        timezone:
          TIMEZONE

      })

    );


    /* =====================================================
       CARREGA TODAS AS INTEGRAÇÕES
       ===================================================== */

    let credentials;


    try {

      credentials =
        readCredentials();

    } catch (
      error
    ) {

      console.error(
        '[OTTO MONITOR] erro lendo credenciais',
        error
      );


      return responseJson(
        {
          ok: false,
          error:
            'Não foi possível carregar as integrações.',
          detail:
            error?.message ||
            null
        },
        500
      );
    }


    if (
      !Array.isArray(
        credentials
      )
    ) {

      credentials = [];
    }


    /* =====================================================
       RESULTADOS
       ===================================================== */

    const results =
      [];


    /*
     * Executa sequencialmente para não explodir
     * rate limit das plataformas.
     */

    for (
      const credential
      of credentials
    ) {

      try {

        const result =
          await monitorCredential(
            request,
            credential
          );

        results.push(
          result
        );

      } catch (
        error
      ) {

        console.error(

          '[OTTO MONITOR] ERRO INTEGRAÇÃO',

          credential?.app_id,
          credential?.slot,

          error

        );


        results.push({

          ok:
            false,

          integration: {

            provider:
              credential?.app_id ||
              null,

            slot:
              credential?.slot ??
              null,

            label:
              credential?.label ||
              null,

            company:
              credential?.company ||
              null

          },

          plants:
            [],

          alerts:
            [],

          error:
            error?.message ||
            'Erro inesperado.'

        });

      }

    }


    /* =====================================================
       RESUMO
       ===================================================== */

    const allPlants =
      results.flatMap(
        item =>
          Array.isArray(item.plants)
            ? item.plants
            : []
      );


    const allAlerts =
      results.flatMap(
        item =>
          Array.isArray(item.alerts)
            ? item.alerts
            : []
      );


    const offline =
      allPlants.filter(
        plant =>
          plant.status ===
          'offline'
      );


    const online =
      allPlants.filter(
        plant =>
          plant.status ===
          'online'
      );


    const alarm =
      allPlants.filter(
        plant =>
          plant.status ===
          'alarm'
      );


    const alertsSent =
      allAlerts.filter(
        alert =>
          alert.sent === true
      );


    const alertsFailed =
      allAlerts.filter(
        alert =>
          alert.sent !== true
      );


    const integrationsOk =
      results.filter(
        item =>
          item.ok === true
      ).length;


    const integrationsFailed =
      results.filter(
        item =>
          item.ok !== true
      ).length;


    const duration =
      Date.now() -
      startedAt;


    /* =====================================================
       LOG FINAL
       ===================================================== */

    console.log(

      '[OTTO MONITOR] FINALIZADO',

      JSON.stringify({

        integrations:
          credentials.length,

        plants:
          allPlants.length,

        online:
          online.length,

        offline:
          offline.length,

        alarm:
          alarm.length,

        alerts:
          allAlerts.length,

        alerts_sent:
          alertsSent.length,

        alerts_failed:
          alertsFailed.length,

        duration_ms:
          duration

      })

    );


    /* =====================================================
       RETORNO
       ===================================================== */

    return responseJson({

      ok:
        integrationsOk > 0
        ||
        credentials.length === 0,

      service:
        'OTTO Solar Monitor',

      automatic:
        isVercelCron(
          request
        ),

      checked_at:
        checkedAt,

      timezone:
        TIMEZONE,

      duration_ms:
        duration,

      summary: {

        integrations_total:
          credentials.length,

        integrations_ok:
          integrationsOk,

        integrations_failed:
          integrationsFailed,

        plants_total:
          allPlants.length,

        plants_online:
          online.length,

        plants_offline:
          offline.length,

        plants_alarm:
          alarm.length,

        alerts_attempted:
          allAlerts.length,

        alerts_sent:
          alertsSent.length,

        alerts_failed:
          alertsFailed.length

      },

      offline_plants:
        offline,

      alerts:
        allAlerts,

      integrations:
        results

    });

  }

};
