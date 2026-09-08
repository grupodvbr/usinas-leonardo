import { dashboardConfigured, makeSession, onlyMethod, responseJson, sameOrigin, sessionCookie, verifyDashboard } from '../lib/core.mjs';
export default {
  async fetch(request) {
    if (!onlyMethod(request, 'POST')) return responseJson({ ok: false, error: 'Método não permitido.' }, 405);
    if (!sameOrigin(request)) return responseJson({ ok: false, error: 'Origem inválida.' }, 403);
    if (!dashboardConfigured()) return responseJson({ ok: false, error: 'Configure DASHBOARD_USER, DASHBOARD_PASSWORD (ou DASHBOARD_PASSWORD_HASH) e SESSION_SECRET na Vercel.' }, 500);
    let body = {};
    try { body = await request.json(); } catch {}
    if (!verifyDashboard(body.username, body.password)) return responseJson({ ok: false, error: 'Usuário ou senha incorretos.' }, 401);
    const token = makeSession(body.username);
    if (!token) return responseJson({ ok: false, error: 'SESSION_SECRET inválido.' }, 500);
    return responseJson({ ok: true, user: String(body.username) }, 200, { 'set-cookie': sessionCookie(token) });
  }
};
