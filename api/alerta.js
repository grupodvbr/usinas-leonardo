// ======================================================
// API • ALERTA USINA SOLAR
// ======================================================
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
// SE STATUS = OFFLINE:
// envia WhatsApp para os números configurados.
//
// CREDENCIAIS:
// PHONE_OTTO
// TOKEN_PHONE_OTTO
//
// ======================================================


// ======================================================
// CONFIGURAÇÃO WHATSAPP
// ======================================================

const PHONE_NUMBER_ID =
  process.env.PHONE_OTTO ||
  "1052011798001845";


const WHATSAPP_TOKEN =
  process.env.TOKEN_PHONE_OTTO;


// ======================================================
// NÚMEROS QUE RECEBERÃO O ALERTA
// ======================================================

const NUMEROS = [

  "557798253249",

  "557799761436",

  "557798315510"

];


// ======================================================
// TEMPLATE WHATSAPP
// ======================================================
//
// Este é o mesmo template do código que você enviou.
//
// Ele possui 1 parâmetro no BODY.
//
// Por enquanto será enviado:
//
// "Fazenda Maria Padaria - OFFLINE"
//
// ======================================================

const TEMPLATE_NAME =
  "status_assistentes";


const TEMPLATE_LANGUAGE =
  "pt_BR";


// ======================================================
// RESPOSTA JSON
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
          "no-store, no-cache, must-revalidate"

      }

    }

  );

}


// ======================================================
// SEGREDO INTERNO
// ======================================================
//
// O shinephone.mjs envia:
//
// x-alert-secret
//
// Pode usar:
//
// ALERTA_INTERNAL_SECRET
//
// ou reaproveitar:
//
// SESSION_SECRET
//
// ======================================================

function getExpectedSecret(){

  return (

    process.env.ALERTA_INTERNAL_SECRET ||

    process.env.SESSION_SECRET ||

    ""

  );

}


// ======================================================
// NORMALIZAR STATUS
// ======================================================

function normalizeStatus(
  value
){

  return String(
    value || ""
  )
  .trim()
  .toLowerCase();

}


// ======================================================
// FORMATAR STATUS PARA WHATSAPP
// ======================================================

function statusLabel(
  status
){

  switch(status){

    case "offline":

      return "OFFLINE";


    case "online":

      return "ONLINE";


    case "alarm":

      return "EM ALARME";


    case "unknown":

      return "STATUS DESCONHECIDO";


    default:

      return String(
        status || "DESCONHECIDO"
      ).toUpperCase();

  }

}


// ======================================================
// ENVIAR TEMPLATE WHATSAPP
// ======================================================

async function enviarWhatsApp({

  numero,

  stationName,

  status

}){

  // ====================================================
  // TEXTO QUE ENTRA NA VARIÁVEL DO TEMPLATE
  // ====================================================

  const textoTemplate =
    `${stationName} - ${statusLabel(status)}`;


  // ====================================================
  // CHAMADA META GRAPH API
  // ====================================================

  const response =
    await fetch(

      `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,

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
          JSON.stringify({

            messaging_product:
              "whatsapp",

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

                    {

                      type:
                        "text",

                      text:
                        textoTemplate

                    }

                  ]

                }

              ]

            }

          })

      }

    );


  // ====================================================
  // RESPOSTA DA META
  // ====================================================

  let json =
    null;


  try{

    json =
      await response.json();

  }catch{

    json = {

      erro:
        "META NÃO RETORNOU JSON"

    };

  }


  // ====================================================
  // LOG VERCEL
  // ====================================================

  console.log(

    "[ALERTA SOLAR WHATSAPP]",

    JSON.stringify({

      numero,

      stationName,

      status,

      httpStatus:
        response.status,

      resposta:
        json

    })

  );


  return {

    numero,

    ok:
      response.ok,

    http_status:
      response.status,

    resposta:
      json

  };

}


// ======================================================
// HANDLER PRINCIPAL
// ======================================================

export default {

  async fetch(
    request
  ){

    try{


      // ==================================================
      // SOMENTE POST
      // ==================================================

      if(
        request.method !== "POST"
      ){

        return responseJson(

          {

            ok:
              false,

            erro:
              true,

            mensagem:
              "METHOD NOT ALLOWED"

          },

          405

        );

      }


      // ==================================================
      // CONFERE CREDENCIAIS WHATSAPP
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
              "TOKEN_PHONE_OTTO NÃO CONFIGURADO"

          },

          500

        );

      }


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
              "PHONE_OTTO NÃO CONFIGURADO"

          },

          500

        );

      }


      // ==================================================
      // SEGURANÇA DA API
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
      // LÊ JSON
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
      // RECEBE DADOS
      // ==================================================

      const provider =
        String(
          body?.provider ||
          "shinephone"
        );


      const stationId =
        body?.station_id ||
        null;


      const stationName =
        String(
          body?.station_name ||
          ""
        ).trim();


      const status =
        normalizeStatus(
          body?.status
        );


      const company =
        String(
          body?.company ||
          ""
        ).trim();


      const label =
        String(
          body?.label ||
          ""
        ).trim();


      const slot =
        body?.slot ??
        null;


      const checkedAt =
        body?.checked_at ||
        new Date()
          .toISOString();


      // ==================================================
      // VALIDA NOME DA ESTAÇÃO
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
              "station_name NÃO INFORMADO"

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
              "status NÃO INFORMADO"

          },

          400

        );

      }


      // ==================================================
      // MONTA JSON DO ALERTA
      // ==================================================

      const alerta = {

        provider,

        station_id:
          stationId,

        station_name:
          stationName,

        status,

        company,

        label,

        slot,

        checked_at:
          checkedAt

      };


      // ==================================================
      // LOG DO ALERTA
      // ==================================================

      console.log(

        "[ALERTA SOLAR RECEBIDO]",

        JSON.stringify(
          alerta
        )

      );


      // ==================================================
      // SE NÃO ESTIVER OFFLINE
      //
      // NÃO ENVIA WHATSAPP
      // ==================================================

      if(
        status !== "offline"
      ){

        return responseJson({

          ok:
            true,

          alerta_recebido:
            true,

          whatsapp_enviado:
            false,

          motivo:
            "ESTAÇÃO NÃO ESTÁ OFFLINE",

          alerta

        });

      }


      // ==================================================
      // ESTAÇÃO OFFLINE
      //
      // ENVIA PARA TODOS OS NÚMEROS
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

              status

            });


          resultados.push(
            resultado
          );


        }catch(err){


          console.error(

            "[ERRO WHATSAPP]",

            numero,

            err?.message ||
            err

          );


          resultados.push({

            numero,

            ok:
              false,

            erro:
              err?.message ||
              "ERRO AO ENVIAR WHATSAPP"

          });

        }

      }


      // ==================================================
      // TOTAL ENVIADOS
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
      // RESPOSTA FINAL
      // ==================================================

      return responseJson({

        ok:
          true,

        alerta_recebido:
          true,

        whatsapp_enviado:
          enviados > 0,

        enviados,

        falhas,

        total_numeros:
          NUMEROS.length,

        alerta,

        resultados

      });

    }


    catch(err){


      console.error(

        "[ERRO API ALERTA SOLAR]",

        err?.message ||
        err

      );


      return responseJson(

        {

          ok:
            false,

          erro:
            true,

          mensagem:
            err?.message ||
            "ERRO INTERNO"

        },

        500

      );

    }

  }

};
