import { dashboardConfigured, readCredentials, responseJson, onlyMethod } from '../lib/core.mjs';
export default {
  async fetch(request) {
    if (!onlyMethod(request, 'GET')) return responseJson({ ok: false, error: 'Método não permitido.' }, 405);
    const items = readCredentials();
    return responseJson({
      ok: true,
      version: '3.0.0',
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      dashboard_configured: dashboardConfigured(),
      credential_entries: items.length,
      complete_entries: items.filter(i => i.complete).length,
      storage: 'vercel-environment'
    });
  }
};
