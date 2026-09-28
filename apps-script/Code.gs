/**
 * =========================================================
 * OTTO SOLAR • GOOGLE APPS SCRIPT STORAGE
 * =========================================================
 * Recebe snapshots do Vercel e salva em uma planilha.
 *
 * ABAS CRIADAS:
 * - USINAS_PRODUCAO  -> histórico (1 linha/usina/execução)
 * - USINAS_ATUAL     -> último estado de cada usina
 * - USINAS_SYNC_LOG  -> log resumido de cada sincronização
 *
 * SEGURANÇA:
 * - segredo compartilhado obrigatório
 * - lock para evitar corrida de duas execuções
 * - nenhuma credencial das plataformas solares é recebida
 *
 * COMO INSTALAR:
 * 1. Abra a planilha onde quer salvar os dados.
 * 2. Extensões > Apps Script.
 * 3. Substitua o Code.gs por este arquivo.
 * 4. Execute instalarOttoSolar() UMA VEZ no editor.
 * 5. Informe o segredo quando solicitado OU rode:
 *      configurarSegredoOttoSolar('SEU_SEGREDO_FORTE');
 * 6. Implantar > Nova implantação > App da Web.
 *    Executar como: Você
 *    Quem tem acesso: Qualquer pessoa
 * 7. Copie a URL terminada em /exec para GAS_WEB_APP_URL na Vercel.
 * 8. Use o mesmo segredo em GAS_SHARED_SECRET na Vercel.
 * =========================================================
 */

const OTTO_CONFIG = Object.freeze({
  timezone: 'America/Bahia',
  historySheet: 'USINAS_PRODUCAO',
  currentSheet: 'USINAS_ATUAL',
  logSheet: 'USINAS_SYNC_LOG',
  propSpreadsheetId: 'OTTO_SOLAR_SPREADSHEET_ID',
  propSharedSecret: 'OTTO_SOLAR_SHARED_SECRET',
  maxRowsPerWrite: 500
});

const OTTO_HEADERS = Object.freeze([
  'run_id',
  'captured_at',
  'provider_checked_at',
  'provider',
  'provider_name',
  'slot',
  'label',
  'company',
  'source',
  'station_id',
  'station_name',
  'status',
  'capacity_kw',
  'power_kw',
  'today_kwh',
  'month_kwh',
  'year_kwh',
  'total_kwh',
  'revenue_today_brl',
  'revenue_month_brl',
  'revenue_year_brl',
  'revenue_total_brl',
  'total_devices',
  'online_devices',
  'offline_devices',
  'alarm_devices',
  'updated_at',
  'saved_at'
]);

const OTTO_LOG_HEADERS = Object.freeze([
  'run_id',
  'captured_at',
  'saved_at',
  'rows_received',
  'rows_saved_history',
  'rows_updated_current',
  'integrations_total',
  'integrations_ok',
  'integrations_failed',
  'plants_total',
  'plants_online',
  'plants_offline',
  'plants_alarm',
  'duration_ms'
]);

function doGet() {
  return json_({
    ok: true,
    service: 'OTTO Solar GAS Storage',
    version: '1.0.0',
    timezone: OTTO_CONFIG.timezone,
    configured: Boolean(getSpreadsheetId_() && getSharedSecret_()),
    now: new Date().toISOString()
  });
}

function doPost(e) {
  const started = Date.now();
  const lock = LockService.getScriptLock();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'BODY_REQUIRED' });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_({ ok: false, error: 'INVALID_JSON' });
    }

    if (String(payload.action || '') !== 'save_solar_snapshot') {
      return json_({ ok: false, error: 'INVALID_ACTION' });
    }

    const expected = getSharedSecret_();
    const received = String(payload.secret || '');

    if (!expected) {
      return json_({ ok: false, error: 'SERVER_SECRET_NOT_CONFIGURED' });
    }

    if (!received || !safeEqual_(expected, received)) {
      return json_({ ok: false, error: 'UNAUTHORIZED' });
    }

    lock.waitLock(25000);

    const ss = getSpreadsheet_();
    const sheets = ensureSheets_(ss);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const savedAt = new Date();

    const normalized = rows
      .filter(function (row) { return row && typeof row === 'object'; })
      .map(function (row) { return normalizeRow_(row, payload, savedAt); });

    const historyCount = appendHistory_(sheets.history, normalized);
    const currentCount = upsertCurrent_(sheets.current, normalized);

    appendSyncLog_(sheets.log, payload, {
      savedAt: savedAt,
      rowsReceived: rows.length,
      historyCount: historyCount,
      currentCount: currentCount,
      durationMs: Date.now() - started
    });

    SpreadsheetApp.flush();

    return json_({
      ok: true,
      run_id: String(payload.run_id || ''),
      rows_received: rows.length,
      rows_saved_history: historyCount,
      rows_updated_current: currentCount,
      spreadsheet_id: ss.getId(),
      history_sheet: OTTO_CONFIG.historySheet,
      current_sheet: OTTO_CONFIG.currentSheet,
      log_sheet: OTTO_CONFIG.logSheet,
      duration_ms: Date.now() - started
    });

  } catch (err) {
    return json_({
      ok: false,
      error: 'SAVE_FAILED',
      message: err && err.message ? String(err.message) : String(err),
      duration_ms: Date.now() - started
    });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/**
 * Rode esta função UMA VEZ dentro do Apps Script vinculado à planilha.
 * Ela grava o ID da planilha e cria/formata as abas.
 */
function instalarOttoSolar() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Abra o Apps Script a partir da planilha: Extensões > Apps Script.');
  }

  PropertiesService.getScriptProperties()
    .setProperty(OTTO_CONFIG.propSpreadsheetId, active.getId());

  ensureSheets_(active);
  active.setSpreadsheetTimeZone(OTTO_CONFIG.timezone);

  return {
    ok: true,
    spreadsheet_id: active.getId(),
    sheets: [OTTO_CONFIG.historySheet, OTTO_CONFIG.currentSheet, OTTO_CONFIG.logSheet]
  };
}

/**
 * Define o segredo compartilhado que também será cadastrado na Vercel.
 */
function configurarSegredoOttoSolar(secret) {
  secret = String(secret || '').trim();
  if (secret.length < 24) {
    throw new Error('Use um segredo com pelo menos 24 caracteres.');
  }

  PropertiesService.getScriptProperties()
    .setProperty(OTTO_CONFIG.propSharedSecret, secret);

  return { ok: true };
}

/**
 * Opcional: rode para validar se tudo está configurado.
 */
function testarConfiguracaoOttoSolar() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);

  return {
    ok: true,
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    secret_configured: Boolean(getSharedSecret_()),
    timezone: ss.getSpreadsheetTimeZone()
  };
}

function getSpreadsheetId_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(OTTO_CONFIG.propSpreadsheetId) || ''
  ).trim();
}

function getSharedSecret_() {
  return String(
    PropertiesService.getScriptProperties().getProperty(OTTO_CONFIG.propSharedSecret) || ''
  ).trim();
}

function getSpreadsheet_() {
  const id = getSpreadsheetId_();
  if (!id) {
    throw new Error('SPREADSHEET_NOT_CONFIGURED: execute instalarOttoSolar() primeiro.');
  }
  return SpreadsheetApp.openById(id);
}

function ensureSheets_(ss) {
  const history = ensureSheet_(ss, OTTO_CONFIG.historySheet, OTTO_HEADERS);
  const current = ensureSheet_(ss, OTTO_CONFIG.currentSheet, OTTO_HEADERS);
  const log = ensureSheet_(ss, OTTO_CONFIG.logSheet, OTTO_LOG_HEADERS);

  return { history: history, current: current, log: log };
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const different = headers.some(function (header, index) {
    return String(currentHeaders[index] || '') !== String(header);
  });

  if (different) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  if (!sheet.getFilter() && sheet.getLastRow() >= 1) {
    sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), headers.length).createFilter();
  }

  formatSheet_(sheet, headers);
  return sheet;
}

function formatSheet_(sheet, headers) {
  const index = {};
  headers.forEach(function (h, i) { index[h] = i + 1; });

  ['captured_at', 'provider_checked_at', 'updated_at', 'saved_at'].forEach(function (h) {
    if (index[h]) {
      sheet.getRange(2, index[h], Math.max(1, sheet.getMaxRows() - 1), 1)
        .setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }
  });

  ['capacity_kw', 'power_kw', 'today_kwh', 'month_kwh', 'year_kwh', 'total_kwh'].forEach(function (h) {
    if (index[h]) {
      sheet.getRange(2, index[h], Math.max(1, sheet.getMaxRows() - 1), 1)
        .setNumberFormat('0.000');
    }
  });

  ['revenue_today_brl', 'revenue_month_brl', 'revenue_year_brl', 'revenue_total_brl'].forEach(function (h) {
    if (index[h]) {
      sheet.getRange(2, index[h], Math.max(1, sheet.getMaxRows() - 1), 1)
        .setNumberFormat('R$ #,##0.00');
    }
  });
}

function normalizeRow_(row, payload, savedAt) {
  const data = Object.assign({}, row);
  data.run_id = String(data.run_id || payload.run_id || '');
  data.captured_at = parseDate_(data.captured_at || payload.captured_at) || savedAt;
  data.provider_checked_at = parseDate_(data.provider_checked_at) || data.captured_at;
  data.updated_at = parseDate_(data.updated_at);
  data.saved_at = savedAt;

  ['slot', 'capacity_kw', 'power_kw', 'today_kwh', 'month_kwh', 'year_kwh', 'total_kwh',
   'revenue_today_brl', 'revenue_month_brl', 'revenue_year_brl', 'revenue_total_brl',
   'total_devices', 'online_devices', 'offline_devices', 'alarm_devices']
    .forEach(function (key) {
      data[key] = numberOrBlank_(data[key]);
    });

  return data;
}

function rowToArray_(row, headers) {
  return headers.map(function (key) {
    const value = row[key];
    return value === undefined || value === null ? '' : value;
  });
}

function appendHistory_(sheet, rows) {
  if (!rows.length) return 0;

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += OTTO_CONFIG.maxRowsPerWrite) {
    const chunk = rows.slice(offset, offset + OTTO_CONFIG.maxRowsPerWrite);
    const values = chunk.map(function (row) { return rowToArray_(row, OTTO_HEADERS); });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, OTTO_HEADERS.length).setValues(values);
    written += values.length;
  }
  return written;
}

function upsertCurrent_(sheet, rows) {
  if (!rows.length) return 0;

  const stationIdCol = OTTO_HEADERS.indexOf('station_id') + 1;
  const providerCol = OTTO_HEADERS.indexOf('provider') + 1;
  const slotCol = OTTO_HEADERS.indexOf('slot') + 1;
  const lastRow = sheet.getLastRow();
  const existing = new Map();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, OTTO_HEADERS.length).getValues();
    values.forEach(function (r, i) {
      const key = currentKey_(r[providerCol - 1], r[slotCol - 1], r[stationIdCol - 1]);
      if (key) existing.set(key, i + 2);
    });
  }

  let changed = 0;
  rows.forEach(function (row) {
    const key = currentKey_(row.provider, row.slot, row.station_id);
    if (!key) return;

    const values = [rowToArray_(row, OTTO_HEADERS)];
    const rowNumber = existing.get(key);

    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, OTTO_HEADERS.length).setValues(values);
    } else {
      const newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1, 1, OTTO_HEADERS.length).setValues(values);
      existing.set(key, newRow);
    }
    changed++;
  });

  return changed;
}

function appendSyncLog_(sheet, payload, meta) {
  const summary = payload.summary || {};
  const values = [[
    String(payload.run_id || ''),
    parseDate_(payload.captured_at) || meta.savedAt,
    meta.savedAt,
    Number(meta.rowsReceived || 0),
    Number(meta.historyCount || 0),
    Number(meta.currentCount || 0),
    numberOrBlank_(summary.integrations_total),
    numberOrBlank_(summary.integrations_ok),
    numberOrBlank_(summary.integrations_failed),
    numberOrBlank_(summary.plants_total),
    numberOrBlank_(summary.plants_online),
    numberOrBlank_(summary.plants_offline),
    numberOrBlank_(summary.plants_alarm),
    numberOrBlank_(summary.duration_ms)
  ]];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, OTTO_LOG_HEADERS.length).setValues(values);
}

function currentKey_(provider, slot, stationId) {
  const p = String(provider || '').trim().toLowerCase();
  const s = String(slot === undefined || slot === null ? '' : slot).trim();
  const id = String(stationId || '').trim();
  if (!p || !id) return '';
  return [p, s, id].join('|');
}

function numberOrBlank_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function parseDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d;
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
