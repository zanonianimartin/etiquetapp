/* ============================================================
   EtiquetApp — login con Google y acceso a Google Sheets
   ============================================================

   Todo corre en el navegador: no hay servidor propio. El login usa Google
   Identity Services (token de acceso de 1 hora, sin refresh token) y los
   datos se leen y escriben directo contra la Sheets API v4. */

const G_SCOPES = 'https://www.googleapis.com/auth/spreadsheets email';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const G_SESSION_KEY = 'etiquetapp-google';

/* Pestanas de la planilla y sus columnas, en el orden en que se crean.
   La app ubica cada columna por el nombre de la fila 1, asi que se pueden
   reordenar o agregar columnas propias a mano sin romper nada. */
const TABS = {
  Catalogo:   ['codigo', 'tipo', 'producto', 'cantidad', 'unidad', 'ingredientes',
               'infoExtra', 'nutri', 'actualizado', 'por'],
  Plantillas: ['id', 'nombre', 'producto', 'cantidad', 'unidad', 'codigo', 'ingredientes',
               'infoExtra', 'nutri', 'diseno', 'actualizado', 'por'],
  Lotes:      ['lote', 'codigo', 'producto', 'vencimiento', 'imagen', 'archivo',
               'actualizado', 'por'],
  /* Las imagenes van partidas en trozos de texto (base64) desde la columna C:
     una celda admite hasta 50.000 caracteres. Asi el acceso a las imagenes es
     el mismo que a la planilla, sin pedir permisos sobre Google Drive. */
  Imagenes:   ['id', 'tipo', 'datos']
};

/* Columnas con formato de texto: sin esto, un codigo cargado a mano en la
   planilla pierde los ceros de adelante ("0495…" pasa a ser un numero). */
const TEXT_COLS = {
  Catalogo: ['codigo'],
  Plantillas: ['codigo'],
  Lotes: ['lote', 'codigo', 'vencimiento']
};

const IMG_CHUNK = 45000;            // margen bajo el limite de 50.000 por celda
const IMG_MAX_CHUNKS = 24;          // columnas C a Z: no hace falta ampliar la grilla

const G = {
  token: null,
  exp: 0,
  email: '',
  sheet: null                       // { id, title, tabs: { titulo: sheetId } }
};

const gConfig = () => window.ETIQUETAPP_CONFIG || {};
const gConfigured = () => !!gConfig().googleClientId;
const gConnected = () => !!(G.token && Date.now() < G.exp);

/* ---------------- Sesion ---------------- */

/* El token se guarda en sessionStorage para no pedir login en cada recarga
   de la pagina. Se borra solo al cerrar la pestana. */
function gRestoreSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(G_SESSION_KEY) || 'null');
    if (s && s.token && s.exp > Date.now() + 60000) {
      G.token = s.token; G.exp = s.exp; G.email = s.email || '';
    }
  } catch { /* sesion corrupta: se pide login de nuevo */ }
  return gConnected();
}

function gSaveSession() {
  try {
    sessionStorage.setItem(G_SESSION_KEY, JSON.stringify({ token: G.token, exp: G.exp, email: G.email }));
  } catch { /* sin sessionStorage: solo se pierde la sesion al recargar */ }
}

/* Abre el popup de Google. `prompt: ''` reutiliza el consentimiento ya dado
   y el popup se cierra solo; 'consent' fuerza la pantalla de permisos. */
function gRequestToken(prompt) {
  return new Promise((resolve, reject) => {
    const oauth = window.google && google.accounts && google.accounts.oauth2;
    if (!oauth) {
      reject(new Error('No se pudo cargar el login de Google. Revisá la conexion a internet.'));
      return;
    }
    const client = oauth.initTokenClient({
      client_id: gConfig().googleClientId,
      scope: G_SCOPES,
      login_hint: G.email || undefined,
      callback: (resp) => {
        if (resp.error) return reject(new Error('Google rechazo el acceso: ' + resp.error));
        if (!oauth.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/spreadsheets')) {
          return reject(new Error('Hace falta permitir el acceso a Google Sheets para usar la planilla.'));
        }
        G.token = resp.access_token;
        G.exp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve();
      },
      error_callback: (err) => {
        reject(new Error(err && err.type === 'popup_closed'
          ? 'Se cerro la ventana de Google antes de terminar.'
          : 'No se pudo abrir la ventana de Google (¿el navegador bloqueo el popup?).'));
      }
    });
    client.requestAccessToken({ prompt });
  });
}

async function gSignIn() {
  if (!gConfigured()) {
    throw new Error('Falta configurar el ID de cliente de Google en config.js.');
  }
  await gRequestToken(G.email ? '' : 'consent');
  const info = await gFetch('https://www.googleapis.com/oauth2/v3/userinfo');
  G.email = (info && info.email) || '';
  gSaveSession();
  return G.email;
}

function gSignOut() {
  if (G.token && window.google && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(G.token, () => {});
  }
  G.token = null; G.exp = 0; G.email = ''; G.sheet = null;
  try { sessionStorage.removeItem(G_SESSION_KEY); } catch { /* nada que borrar */ }
}

/* Renueva el token si vence en menos de 2 minutos. Se llama al inicio de
   cada accion, todavia dentro del clic del usuario: si no, el navegador
   bloquea el popup de Google. */
async function gEnsureToken() {
  if (G.token && Date.now() < G.exp - 120000) return;
  await gRequestToken('');
  gSaveSession();
}

/* ---------------- HTTP ---------------- */

function gErrorText(status, body) {
  const msg = body && body.error && body.error.message;
  if (status === 403) return 'Tu cuenta no tiene permiso de edicion sobre la planilla.';
  if (status === 404) return 'No se encontro la planilla. Revisá la URL o el ID.';
  if (status === 429) return 'Google limito las consultas por un momento. Probá de nuevo en un minuto.';
  return `Error de Google (${status})` + (msg ? ': ' + msg : '');
}

async function gFetch(url, opts = {}, retry = true) {
  await gEnsureToken();
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { Authorization: 'Bearer ' + G.token, 'Content-Type': 'application/json' }
    });
  } catch {
    throw new Error('Sin conexion con Google. Revisá internet y probá de nuevo.');
  }
  if (res.status === 401 && retry) {       // token revocado o vencido antes de tiempo
    G.exp = 0;
    return gFetch(url, opts, false);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(gErrorText(res.status, body));
  return body;
}

const gRange = (tab, a1) => encodeURIComponent(`'${tab}'!${a1}`);
const gValuesUrl = (a1, tab, qs = '') =>
  `${SHEETS_API}/${G.sheet.id}/values/${gRange(tab, a1)}${qs}`;

function gBatchUpdate(requests) {
  return gFetch(`${SHEETS_API}/${G.sheet.id}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests })
  });
}

/* ---------------- Planilla ---------------- */

/* Acepta la URL completa de la planilla o solo su ID. */
function gParseSheetId(text) {
  const t = String(text || '').trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : '';
}

const gSheetUrl = () => G.sheet ? `https://docs.google.com/spreadsheets/d/${G.sheet.id}/edit` : '';

async function gLoadMeta(id) {
  const meta = await gFetch(`${SHEETS_API}/${id}?fields=properties.title,sheets.properties(sheetId,title)`);
  G.sheet = {
    id,
    title: meta.properties.title,
    tabs: Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]))
  };
}

/* Abre una planilla y crea las pestanas o columnas que le falten. Asi una
   planilla vacia, o una armada con una version anterior de la app, queda
   lista para usar sin pasos a mano. */
async function gOpenSpreadsheet(id) {
  await gLoadMeta(id);

  const faltan = Object.keys(TABS).filter((t) => !(t in G.sheet.tabs));
  if (faltan.length) {
    await gBatchUpdate(faltan.map((title) => ({
      addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } }
    })));
    await gLoadMeta(id);
    await gFormatTabs(faltan);
  }

  // Encabezados: se completan los que falten sin tocar las columnas propias.
  const tabs = Object.keys(TABS);
  const qs = tabs.map((t) => 'ranges=' + gRange(t, '1:1')).join('&');
  const got = await gFetch(`${SHEETS_API}/${id}/values:batchGet?${qs}`);
  const data = [];
  tabs.forEach((t, i) => {
    const actual = ((got.valueRanges[i].values || [])[0] || []).map((h) => String(h).trim());
    const nuevos = TABS[t].filter((h) => !actual.includes(h));
    if (!nuevos.length) return;
    data.push({ range: `'${t}'!A1`, values: [[...actual, ...nuevos]] });
  });
  if (data.length) {
    await gFetch(`${SHEETS_API}/${id}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data })
    });
  }
  return G.sheet;
}

/* Fila 1 en negrita y congelada; columnas de codigos con formato texto. */
async function gFormatTabs(tabs) {
  const requests = [];
  tabs.forEach((t) => {
    const sheetId = G.sheet.tabs[t];
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold'
      }
    });
    (TEXT_COLS[t] || []).forEach((col) => {
      const ci = TABS[t].indexOf(col);
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: ci, endColumnIndex: ci + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      });
    });
  });
  if (requests.length) await gBatchUpdate(requests);
}

async function gCreateSpreadsheet(title) {
  const res = await gFetch(SHEETS_API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: Object.keys(TABS).map((t) => ({
        properties: { title: t, gridProperties: { frozenRowCount: 1 } }
      }))
    })
  });
  G.sheet = {
    id: res.spreadsheetId,
    title,
    tabs: Object.fromEntries(res.sheets.map((s) => [s.properties.title, s.properties.sheetId]))
  };
  await gFormatTabs(Object.keys(TABS));
  return gOpenSpreadsheet(res.spreadsheetId);   // escribe los encabezados
}

/* ---------------- Filas ---------------- */

/* Devuelve { headers, rows }, donde cada fila es un objeto por nombre de
   columna con `_row` = numero de fila en la planilla (1 = encabezados). */
async function gReadTab(tab) {
  const res = await gFetch(gValuesUrl('A1:Z', tab, '?valueRenderOption=UNFORMATTED_VALUE'));
  const values = res.values || [];
  const headers = (values[0] || []).map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i] || [];
    if (!v.some((x) => String(x).trim())) continue;     // fila vacia
    const o = { _row: i + 1 };
    headers.forEach((h, j) => { if (h) o[h] = v[j] == null ? '' : String(v[j]); });
    rows.push(o);
  }
  return { headers, rows };
}

const gStamp = () => ({ actualizado: new Date().toISOString(), por: G.email });

/* Inserta o reemplaza la fila cuya columna `key` coincide con obj[key].
   Relee la pestana antes de escribir: otro usuario pudo haber agregado o
   borrado filas desde que se cargaron los datos. Las columnas que obj no
   trae (las agregadas a mano) se conservan. */
async function gUpsert(tab, key, obj) {
  const { headers, rows } = await gReadTab(tab);
  const id = String(obj[key]).trim();
  const prev = rows.find((r) => String(r[key]).trim() === id);
  const full = { ...(prev || {}), ...obj, ...gStamp() };
  const line = headers.map((h) => (h in full && h !== '_row') ? String(full[h] ?? '') : '');

  if (prev) {
    await gFetch(gValuesUrl(`A${prev._row}`, tab, '?valueInputOption=RAW'), {
      method: 'PUT', body: JSON.stringify({ values: [line] })
    });
  } else {
    await gFetch(gValuesUrl('A1', tab, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), {
      method: 'POST', body: JSON.stringify({ values: [line] })
    });
  }
  return !!prev;
}

async function gDeleteRow(tab, rowNumber) {
  await gBatchUpdate([{
    deleteDimension: {
      range: { sheetId: G.sheet.tabs[tab], dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber }
    }
  }]);
}

async function gDelete(tab, key, value) {
  const { rows } = await gReadTab(tab);
  const r = rows.find((x) => String(x[key]).trim() === String(value).trim());
  if (r) await gDeleteRow(tab, r._row);
  return !!r;
}

/* ---------------- Imagenes ---------------- */

/* Solo se lee la columna A para ubicar la fila: leer la pestana completa
   bajaria todas las imagenes de todos los lotes. */
async function gImageRow(id) {
  const res = await gFetch(gValuesUrl('A:A', 'Imagenes'));
  const col = res.values || [];
  const i = col.findIndex((v) => String((v || [])[0] || '').trim() === id);
  return i > 0 ? i + 1 : 0;
}

async function gSaveImage(id, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Imagen invalida.');
  const chunks = [];
  for (let i = 0; i < m[2].length; i += IMG_CHUNK) chunks.push(m[2].slice(i, i + IMG_CHUNK));
  if (chunks.length > IMG_MAX_CHUNKS) throw new Error('La imagen es demasiado grande para la planilla.');

  await gFetch(gValuesUrl('A1', 'Imagenes', ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), {
    method: 'POST', body: JSON.stringify({ values: [[id, m[1], ...chunks]] })
  });
}

async function gLoadImage(id) {
  const row = await gImageRow(id);
  if (!row) return null;
  const res = await gFetch(gValuesUrl(`A${row}:Z${row}`, 'Imagenes'));
  const v = (res.values || [])[0] || [];
  if (!v[1] || v.length < 3) return null;
  return `data:${v[1]};base64,${v.slice(2).join('')}`;
}

async function gDeleteImage(id) {
  const row = await gImageRow(id);
  if (row) await gDeleteRow('Imagenes', row);
}
