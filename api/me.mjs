import { onlyMethod, readSession, responseJson } from '../lib/core.mjs';
export default {
  async fetch(request) {
    if (!onlyMethod(request, 'GET')) return responseJson({ ok: false, error: 'Método não permitido.' }, 405);
    const session = readSession(request);
    return responseJson({ ok: true, authenticated: Boolean(session), user: session?.u || null });
  }
};
