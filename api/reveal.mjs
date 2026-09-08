import { findCredential, onlyMethod, readSession, responseJson, sameOrigin } from '../lib/core.mjs';
export default {
  async fetch(request) {
    if (!onlyMethod(request, 'POST')) return responseJson({ ok: false, error: 'Método não permitido.' }, 405);
    if (!readSession(request)) return responseJson({ ok: false, error: 'Não autenticado.' }, 401);
    if (!sameOrigin(request)) return responseJson({ ok: false, error: 'Origem inválida.' }, 403);
    let body = {};
    try { body = await request.json(); } catch {}
    const item = findCredential(body.app_id, Number(body.slot));
    if (!item) return responseJson({ ok: false, error: 'Credencial não encontrada.' }, 404);
    if (!item.complete) return responseJson({ ok: false, error: 'Configure USER e PASSWORD deste acesso na Vercel.' }, 409);
    return responseJson({ ok: true, credential: {
      app_id: item.app_id, slot: item.slot, label: item.label, company: item.company,
      plant: item.plant, user: item.user, password: item.password, region: item.region, notes: item.notes
    }});
  }
};
