// ======================================================
// API • ALERTA DE USINA SOLAR
// VERSÃO SEM TEMPLATE
// ======================================================
//
// ENVIA MENSAGEM DE TEXTO DIRETA PELO WHATSAPP
//
// RECEBE:
//
// {
//   "provider": "shinephone",
//   "station_id": "9263687",
//   "station_name": "Fazenda Maria Padaria",
//   "status": "offline",
//   "company": "Mercatto Delícia",
//   "label": "Mercatto",
//   "slot": 1,
//   "checked_at": "2026-09-08T22:30:00.000Z"
// }
//
// CREDENCIAIS:
//
// PHONE_OTTO
// TOKEN_PHONE_OTTO
//
// SEGURANÇA:
//
// ALERTA_INTERNAL_SECRET
//
// OU:
//
// SESSION_SECRET
//
// ======================================================


// ======================================================
// WHATSAPP
// ======================================================

const PHONE_NUMBER_ID =
  process.env.PHONE_OTTO ||
  "1052011798001845";


const WHATSAPP_TOKEN =
  process.env.TOKEN_PHONE_OTTO;


// ======================================================
// META GRAPH API
// ======================================================

const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ||
  "v19.0";


// ======================================================
// FUSO
// ======================================================

const TIMEZONE =
  "America/Bahia";


// ======================================================
// NÚMEROS QUE RECEBERÃO
// ======================================================

const NUMEROS = [

  "557798253249",

  "557799761436",

  "557798315510"

];


// ======================================================
// NORMALIZAR TEXTO
// ======================================================

function text(
  value,
  fallback = ""
){

  if(
    value === undefined ||
    value === null
  ){

    return fallback;

  }


  const result =
    String(value)
      .trim();


  return result || fallback;

}


// ======================================================
// NORMALIZAR STATUS
// ======================================================

function normalizeStatus(
  value
){

  return text(
    value
  )
    .toLowerCase();

}


// ======================================================
// STATUS BONITO
// ======================================================

function statusLabel(
  status
){

  switch(
    normalizeStatus(status)
  ){

    case "offline":

      return "🔴 OFFLINE";


    case "online":

      return "🟢 ONLINE";


    case "alarm":

      return "🟠 EM ALARME";


    case "warning":

      return "🟡 ATENÇÃO";


    case "unknown":

      return "⚪ DESCONHECIDO";


    default:

      return text(
        status,
        "DESCONHECIDO"
      ).toUpperCase();

  }

}


// ======================================================
// PLATAFORMA
// ======================================================

function providerLabel(
  provider
){

  switch(
    text(provider)
      .toLowerCase()
  ){

    case "shinephone":

      return "Growatt / ShinePhone";


    case "growatt":

      return "Growatt / ShinePhone";


    case "isolarcloud":

      return "Sungrow / iSolarCloud";


    case "elekeeper":

      return "SAJ / Elekeeper";


    case "saj":

      return "SAJ / Elekeeper";


    case "solarman":

      return "SOLARMAN Smart";


    default:

      return text(
        provider,
        "Solar Central"
      );

  }

}


// ======================================================
// DATA / HORA
// ======================================================

function formatDateTime(
  value
){

  let date;


  try{

    date =
      value
        ? new Date(value)
        : new Date();


    if(
      Number.isNaN(
        date.getTime()
      )
    ){

      date =
        new Date();

    }

  }catch{

    date =
      new Date();

  }


  try{

    const formatted =
      new Intl.DateTimeFormat(

        "pt-BR",

        {

          timeZone:
            TIMEZONE,

          day:
            "2-digit",

          month:
            "2-digit",

          year:
            "numeric",

          hour:
            "2-digit",

          minute:
            "2-digit",

          second:
            "2-digit",

          hour12:
            false

        }

      ).format(
        date
      );


    return formatted
      .replace(
        ", ",
        " às "
      );

  }catch{

    return date
      .toISOString();

  }

}


// ======================================================
// SEGREDO INTERNO
// ======================================================

function getExpectedSecret(){

  return (

    process.env.ALERTA_INTERNAL_SECRET ||

    process.env.SESSION_SECRET ||

    ""

  );

}


// ======================================================
// DEFINE SE DEVE ENVIAR
// ======================================================

function shouldSendAlert(
  status
){

  /*
   * POR ENQUANTO:
   *
   * somente OFFLINE envia.
   */

  return (
    normalizeStatus(
      status
    ) ===
    "offline"
  );

}


// ======================================================
// MONTA A MENSAGEM
// ======================================================

function buildMessage({

  stationName,

  company,

  provider,

  status,

  checkedAt

}){

  return [

    "⚠️ *ALERTA DE MONITORAMENTO SOLAR*",

    "",

    "Foi detectada uma alteração no monitoramento da estação solar.",

    "",

    `☀️ *Estação:* ${text(
      stationName,
      "Não identificada"
    )}`,

    `🏢 *Empresa:* ${text(
      company,
      "Não informada"
    )}`,

    `🌐 *Plataforma:* ${providerLabel(
      provider
    )}`,

    `📡 *Status:* ${statusLabel(
      status
    )}`,

    `🕒 *Detectado em:* ${formatDateTime(
      checkedAt
    )}`,

    "",

    "⚠️ Verifique a comunicação da usina, o datalogger e o funcionamento dos inversores.",

    "",

    "☀️ *Solar Central*",
    "_Monitoramento automático de usinas_"

  ].join(
    "\n"
  );

}


// ======================================================
// ENVIA TEXTO PELO WHATSAPP
// ======================================================

async function enviarWhatsApp({

  numero,

  stationName,

  company,

  provider,

  status,

  checkedAt

}){

  const mensagem =
    buildMessage({

      stationName,

      company,

      provider,

      status,

      checkedAt

    });


  const url =

    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;


  // ====================================================
  // PAYLOAD SEM TEMPLATE
  // ====================================================

  const payload = {

    messaging_product:
      "whatsapp",

    recipient_type:
      "individual",

    to:
      numero,

    type:
      "text",

    text:{

      preview_url:
        false,

      body:
        mensagem

    }

  };


  // ====================================================
  // ENVIO META
  // ====================================================

  const response =
    await fetch(

      url,

      {

        method:
          "POST",

        headers:{

          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify(
            payload
          )

      }

    );


  // ====================================================
  // RESPOSTA META
  // ====================================================

  let metaJson;


  try{

    metaJson =
      await response.json();

  }catch{

    metaJson = {

      error:{

        message:
          "META NÃO RETORNOU JSON"

      }

    };

  }


  // ====================================================
  // LOG
  // ====================================================

  console.log(

    "[SOLAR WHATSAPP SEM TEMPLATE]",

    JSON.stringify({

      numero,

      station_name:
        stationName,

      company,

      provider:

        providerLabel(
          provider
        ),

      status:

        statusLabel(
          status
        ),

      checked_at:

        formatDateTime(
          checkedAt
        ),

      http_status:
        response.status,

      meta:
        metaJson

    })

  );


  return {

    numero,

    ok:
      response.ok,

    http_status:
      response.status,

    meta:
      metaJson

  };

}


// ======================================================
// HANDLER PRINCIPAL VERCEL
// ======================================================

export default async function handler(
  req,
  res
){

  try{


    // ==================================================
    // SOMENTE POST
    // ==================================================

    if(
      req.method !==
      "POST"
    ){

      return res
        .status(405)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "METHOD NOT ALLOWED",

          metodo_esperado:
            "POST"

        });

    }


    // ==================================================
    // TOKEN WHATSAPP
    // ==================================================

    if(
      !WHATSAPP_TOKEN
    ){

      return res
        .status(500)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "TOKEN_PHONE_OTTO NÃO CONFIGURADO NA VERCEL"

        });

    }


    // ==================================================
    // PHONE NUMBER ID
    // ==================================================

    if(
      !PHONE_NUMBER_ID
    ){

      return res
        .status(500)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "PHONE_OTTO NÃO CONFIGURADO NA VERCEL"

        });

    }


    // ==================================================
    // SEGURANÇA
    // ==================================================

    const expectedSecret =
      getExpectedSecret();


    if(
      !expectedSecret
    ){

      return res
        .status(500)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "SESSION_SECRET OU ALERTA_INTERNAL_SECRET NÃO CONFIGURADO"

        });

    }


    const receivedSecret =

      req.headers[
        "x-alert-secret"
      ]

      ||

      "";


    if(
      receivedSecret !==
      expectedSecret
    ){

      console.warn(

        "[SOLAR ALERTA] CHAMADA NÃO AUTORIZADA"

      );


      return res
        .status(401)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "NÃO AUTORIZADO"

        });

    }


    // ==================================================
    // BODY
    // ==================================================

    const body =
      req.body || {};


    // ==================================================
    // DADOS RECEBIDOS
    // ==================================================

    const provider =
      text(
        body.provider,
        "solar"
      );


    const stationId =
      body.station_id ??
      null;


    const stationName =
      text(
        body.station_name
      );


    const status =
      normalizeStatus(
        body.status
      );


    const company =
      text(
        body.company,
        "Não informada"
      );


    const label =
      text(
        body.label
      );


    const slot =
      body.slot ??
      null;


    const checkedAt =
      body.checked_at ||
      new Date()
        .toISOString();


    // ==================================================
    // VALIDA ESTAÇÃO
    // ==================================================

    if(
      !stationName
    ){

      return res
        .status(400)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "station_name É OBRIGATÓRIO"

        });

    }


    // ==================================================
    // VALIDA STATUS
    // ==================================================

    if(
      !status
    ){

      return res
        .status(400)
        .json({

          ok:
            false,

          erro:
            true,

          mensagem:
            "status É OBRIGATÓRIO"

        });

    }


    // ==================================================
    // OBJETO DO ALERTA
    // ==================================================

    const alerta = {

      provider,

      provider_name:

        providerLabel(
          provider
        ),

      station_id:
        stationId,

      station_name:
        stationName,

      status,

      status_label:

        statusLabel(
          status
        ),

      company,

      label,

      slot,

      checked_at:
        checkedAt,

      checked_at_formatted:

        formatDateTime(
          checkedAt
        )

    };


    // ==================================================
    // LOG
    // ==================================================

    console.log(

      "[ALERTA SOLAR RECEBIDO]",

      JSON.stringify(
        alerta
      )

    );


    // ==================================================
    // SE NÃO ESTIVER OFFLINE
    // ==================================================

    if(
      !shouldSendAlert(
        status
      )
    ){

      return res
        .status(200)
        .json({

          ok:
            true,

          alerta_recebido:
            true,

          alerta_disparado:
            false,

          whatsapp_enviado:
            false,

          motivo:
            "STATUS NÃO CONFIGURADO PARA DISPARAR ALERTA",

          alerta

        });

    }


    // ==================================================
    // ENVIA PARA TODOS
    // ==================================================

    const resultados =
      [];


    for(
      const numero of
      NUMEROS
    ){

      try{


        const resultado =
          await enviarWhatsApp({

            numero,

            stationName,

            company,

            provider,

            status,

            checkedAt

          });


        resultados.push(
          resultado
        );


      }catch(error){


        console.error(

          "[ERRO ENVIO WHATSAPP SOLAR]",

          numero,

          error?.message ||
          error

        );


        resultados.push({

          numero,

          ok:
            false,

          erro:
            error?.message ||
            "ERRO AO ENVIAR WHATSAPP"

        });

      }

    }


    // ==================================================
    // CONTAGEM
    // ==================================================

    const enviados =
      resultados.filter(

        item =>
          item.ok === true

      ).length;


    const falhas =
      resultados.filter(

        item =>
          item.ok !== true

      ).length;


    // ==================================================
    // NENHUM FUNCIONOU
    // ==================================================

    if(
      enviados === 0
    ){

      return res
        .status(502)
        .json({

          ok:
            false,

          alerta_recebido:
            true,

          alerta_disparado:
            true,

          whatsapp_enviado:
            false,

          enviados:
            0,

          falhas,

          total_numeros:
            NUMEROS.length,

          modo:
            "texto_sem_template",

          alerta,

          resultados

        });

    }


    // ==================================================
    // SUCESSO
    // ==================================================

    return res
      .status(200)
      .json({

        ok:
          true,

        alerta_recebido:
          true,

        alerta_disparado:
          true,

        whatsapp_enviado:
          true,

        enviados,

        falhas,

        total_numeros:
          NUMEROS.length,

        modo:
          "texto_sem_template",

        alerta,

        resultados

      });


  }catch(error){


    console.error(

      "[ERRO API ALERTA SOLAR]",

      error?.stack ||
      error?.message ||
      error

    );


    return res
      .status(500)
      .json({

        ok:
          false,

        erro:
          true,

        mensagem:
          error?.message ||
          "ERRO INTERNO NA API DE ALERTA"

      });

  }

}
