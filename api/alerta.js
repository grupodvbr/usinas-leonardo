// ======================================================
// API • ALERTA DE USINA SOLAR
// ======================================================
//
// TEMPLATE:
// alerta_usina_solar
//
// CATEGORIA:
// UTILITY
//
// IDIOMA:
// pt_BR
//
// VARIÁVEIS DO TEMPLATE:
//
// {{1}} = Nome da estação
// {{2}} = Empresa
// {{3}} = Plataforma
// {{4}} = Status
// {{5}} = Data/Hora
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
// CREDENCIAIS WHATSAPP JÁ EXISTENTES:
//
// PHONE_OTTO
// TOKEN_PHONE_OTTO
//
// SEGURANÇA INTERNA:
//
// ALERTA_INTERNAL_SECRET
//
// OU, SE NÃO EXISTIR:
//
// SESSION_SECRET
//
// ======================================================


// ======================================================
// WHATSAPP • CONFIGURAÇÃO
// ======================================================

const PHONE_NUMBER_ID =
  process.env.PHONE_OTTO ||
  "1052011798001845";


const WHATSAPP_TOKEN =
  process.env.TOKEN_PHONE_OTTO;


// ======================================================
// GRAPH API
// ======================================================
//
// Mantive compatibilidade com sua API existente.
//
// Se quiser mudar a versão futuramente,
// basta criar na Vercel:
//
// META_GRAPH_VERSION
//
// ======================================================

const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION ||
  "v19.0";


// ======================================================
// TEMPLATE NOVO
// ======================================================

const TEMPLATE_NAME =
  process.env.WHATSAPP_TEMPLATE_SOLAR ||
  "alerta_usina_solar";


const TEMPLATE_LANGUAGE =
  "pt_BR";


// ======================================================
// FUSO HORÁRIO
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
// JSON RESPONSE
// ======================================================

function responseJson(
  data,
  status = 200
){

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      status,

      headers:{

        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store, no-cache, must-revalidate",

        "Pragma":
          "no-cache"

      }

    }

  );

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
// NORMALIZAR TEXTO
// ======================================================

function text(
  value,
  fallback = ""
){

  if(
    value === null ||
    value === undefined
  ){

    return fallback;

  }


  const result =
    String(value)
      .trim();


  return (
    result ||
    fallback
  );

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
// NOME BONITO DA PLATAFORMA
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
// DATA/HORA BRASIL
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

          hour12:
            false

        }

      ).format(
        date
      );


    /*
     * Normalmente:
     *
     * 08/09/2026, 19:35
     *
     * Queremos:
     *
     * 08/09/2026 às 19:35
     */

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
// VALIDA STATUS PARA ENVIO
// ======================================================

function shouldSendAlert(
  status
){

  /*
   * POR ENQUANTO:
   *
   * SOMENTE OFFLINE DISPARA WHATSAPP.
   *
   * Depois podemos adicionar:
   *
   * alarm
   * warning
   * voltou online
   */

  return (
    normalizeStatus(
      status
    ) ===
    "offline"
  );

}


// ======================================================
// CHAMADA META WHATSAPP
// ======================================================

async function sendTemplate({

  numero,

  stationName,

  company,

  provider,

  status,

  checkedAt

}){

  const url =

    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;


  // ====================================================
  // PARÂMETROS
  // ====================================================

  const parameterStation =
    text(
      stationName,
      "Usina sem identificação"
    );


  const parameterCompany =
    text(
      company,
      "Não informado"
    );


  const parameterProvider =
    providerLabel(
      provider
    );


  const parameterStatus =
    statusLabel(
      status
    );


  const parameterDate =
    formatDateTime(
      checkedAt
    );


  // ====================================================
  // PAYLOAD META
  // ====================================================

  const payload = {

    messaging_product:
      "whatsapp",

    recipient_type:
      "individual",

    to:
      numero,

    type:
      "template",

    template:{

      name:
        TEMPLATE_NAME,

      language:{

        code:
          TEMPLATE_LANGUAGE

      },

      components:[

        {

          type:
            "body",

          parameters:[

            // {{1}}
            {

              type:
                "text",

              text:
                parameterStation

            },


            // {{2}}
            {

              type:
                "text",

              text:
                parameterCompany

            },


            // {{3}}
            {

              type:
                "text",

              text:
                parameterProvider

            },


            // {{4}}
            {

              type:
                "text",

              text:
                parameterStatus

            },


            // {{5}}
            {

              type:
                "text",

              text:
                parameterDate

            }

          ]

        }

      ]

    }

  };


  // ====================================================
  // ENVIA
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
  // LOG VERCEL
  // ====================================================

  console.log(

    "[SOLAR WHATSAPP]",

    JSON.stringify({

      numero,

      station_name:
        parameterStation,

      company:
        parameterCompany,

      provider:
        parameterProvider,

      status:
        parameterStatus,

      date:
        parameterDate,

      template:
        TEMPLATE_NAME,

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

    template:
      TEMPLATE_NAME,

    meta:
      metaJson

  };

}


// ======================================================
// HANDLER PRINCIPAL
// ======================================================
//
// O projeto Solar Central utiliza:
// export default { async fetch(request) }
//
// ======================================================

export default {

  async fetch(
    request
  ){

    try{


      // ==================================================
      // MÉTODO
      // ==================================================

      if(
        request.method !==
        "POST"
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "METHOD NOT ALLOWED",

            metodo_esperado:
              "POST"

          },

          405

        );

      }


      // ==================================================
      // TOKEN META
      // ==================================================

      if(
        !WHATSAPP_TOKEN
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "TOKEN_PHONE_OTTO NÃO CONFIGURADO NA VERCEL"

          },

          500

        );

      }


      // ==================================================
      // PHONE NUMBER ID
      // ==================================================

      if(
        !PHONE_NUMBER_ID
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "PHONE_OTTO NÃO CONFIGURADO NA VERCEL"

          },

          500

        );

      }


      // ==================================================
      // SEGURANÇA INTERNA
      // ==================================================

      const expectedSecret =
        getExpectedSecret();


      if(
        !expectedSecret
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "SESSION_SECRET OU ALERTA_INTERNAL_SECRET NÃO CONFIGURADO"

          },

          500

        );

      }


      const receivedSecret =

        request.headers.get(
          "x-alert-secret"
        ) || "";


      if(
        receivedSecret !==
        expectedSecret
      ){

        console.warn(

          "[SOLAR ALERTA] CHAMADA NÃO AUTORIZADA"

        );


        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "NÃO AUTORIZADO"

          },

          401

        );

      }


      // ==================================================
      // JSON RECEBIDO
      // ==================================================

      let body;


      try{

        body =
          await request.json();

      }catch{

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "JSON INVÁLIDO"

          },

          400

        );

      }


      // ==================================================
      // DADOS
      // ==================================================

      const provider =
        text(
          body?.provider,
          "solar"
        );


      const stationId =
        body?.station_id ??
        null;


      const stationName =
        text(
          body?.station_name
        );


      const status =
        normalizeStatus(
          body?.status
        );


      const company =
        text(
          body?.company,
          "Não informado"
        );


      const label =
        text(
          body?.label
        );


      const slot =
        body?.slot ??
        null;


      const checkedAt =
        body?.checked_at ||
        new Date()
          .toISOString();


      // ==================================================
      // VALIDA ESTAÇÃO
      // ==================================================

      if(
        !stationName
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "station_name É OBRIGATÓRIO"

          },

          400

        );

      }


      // ==================================================
      // VALIDA STATUS
      // ==================================================

      if(
        !status
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "status É OBRIGATÓRIO"

          },

          400

        );

      }


      // ==================================================
      // OBJETO PADRÃO DO ALERTA
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
      // NÃO ESTÁ OFFLINE
      // ==================================================

      if(
        !shouldSendAlert(
          status
        )
      ){

        return responseJson({

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
      // ENVIA WHATSAPP
      // ==================================================

      const resultados =
        [];


      for(
        const numero of
        NUMEROS
      ){

        try{


          const resultado =
            await sendTemplate({

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

            "[ERRO ENVIO SOLAR]",

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
              "ERRO AO ENVIAR TEMPLATE"

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
      // NENHUM ENVIO FUNCIONOU
      // ==================================================

      if(
        enviados === 0
      ){

        return responseJson(

          {

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

            template:
              TEMPLATE_NAME,

            alerta,

            resultados

          },

          502

        );

      }


      // ==================================================
      // SUCESSO
      // ==================================================

      return responseJson({

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

        template:
          TEMPLATE_NAME,

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


      return responseJson(

        {

          ok:
            false,

          erro:
            true,

          mensagem:
            error?.message ||
            "ERRO INTERNO NA API DE ALERTA"

        },

        500

      );

    }

  }

};
