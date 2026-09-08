import { clearCookie, onlyMethod, responseJson, sameOrigin } from '../lib/core.mjs';
export default {async fetch(request){if(!onlyMethod(request,'POST'))return responseJson({ok:false,error:'Método não permitido.'},405);if(!sameOrigin(request))return responseJson({ok:false,error:'Origem inválida.'},403);return responseJson({ok:true},200,{'set-cookie':clearCookie()});}};
