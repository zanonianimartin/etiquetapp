/* ============================================================
   EtiquetApp — login con Google, Google Sheets y Google Drive
   ============================================================

   Todo corre en el navegador: no hay servidor propio. El login usa Google
   Identity Services (token de acceso de 1 hora, sin refresh token); los
   datos se leen y escriben directo contra la Sheets API v4 y las imagenes
   de los lotes van como archivos a una carpeta de Drive (Drive API v3). */

/* Drive completo, y no `drive.file`: con `drive.file` cada usuario solo ve
   los archivos que subio el mismo, y las imagenes de los lotes las tiene
   que ver todo el equipo. La app solo usa la carpeta de imagenes. */
const SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets';
const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive';
const G_SCOPES = `${SCOPE_SHEETS} ${SCOPE_DRIVE} email`;
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const G_SESSION_KEY = 'etiquetapp-google';

/* Pestanas de la planilla y sus columnas, en el orden en que se crean.
   La app ubica cada columna por el nombre de la fila 1, asi que se pueden
   reordenar o agregar columnas propias a mano sin romper nada. */
const TABS = {
  /* `clave`: texto de 5 caracteres del producto; `codigo` sale de ella con
     TEXTO_A_DECIMAL (ver textoADecimal en app.js). */
  Catalogo:   ['codigo', 'clave', 'tipo', 'producto', 'cantidad', 'unidad', 'ingredientes',
               'infoExtra', 'nutri', 'actualizado', 'por'],
  /* `imagen` es el id del archivo en Drive y `enlace` su link para abrirlo
     desde la planilla. */
  Lotes:      ['lote', 'codigo', 'producto', 'vencimiento', 'imagen', 'archivo', 'enlace',
               'actualizado', 'por'],
  /* Cuentas habilitadas para usar la app. `rol`: admin o usuario.
     `activo`: vacio o SI habilita; NO deshabilita sin borrar la fila.
     El script de apps-script/usuarios.gs sincroniza esta lista con los
     permisos reales de la planilla y de la carpeta de imagenes. */
  Usuarios:   ['email', 'nombre', 'rol', 'activo', 'actualizado', 'por'],
  /* Valores compartidos por todo el equipo. Hoy: `carpetaImagenes`, el id
     de la carpeta de Drive donde van las imagenes de los lotes. */
  Ajustes:    ['clave', 'valor', 'actualizado', 'por']
};

/* Columnas con formato de texto: sin esto, un codigo cargado a mano en la
   planilla pierde los ceros de adelante ("0495…" pasa a ser un numero). */
const TEXT_COLS = {
  Catalogo: ['codigo', 'clave'],      // una clave como "00123" tambien perderia los ceros
  Lotes: ['lote', 'codigo', 'vencimiento']
};

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
      /* Lo habitual no es la conexion sino un bloqueador de anuncios o
         rastreadores (Opera, Brave, uBlock…) que frena el script de Google. */
      reject(new Error('No se pudo cargar el login de Google. Si usás un bloqueador de anuncios o rastreadores (Opera y Brave traen uno), desactivalo para este sitio y recargá la pagina. Si no, revisá la conexion a internet.'));
      return;
    }
    const client = oauth.initTokenClient({
      client_id: gConfig().googleClientId,
      scope: G_SCOPES,
      login_hint: G.email || undefined,
      callback: (resp) => {
        if (resp.error) return reject(new Error('Google rechazo el acceso: ' + resp.error));
        // Google deja destildar cada permiso por separado en la pantalla de consentimiento.
        if (!oauth.hasGrantedAllScopes(resp, SCOPE_SHEETS, SCOPE_DRIVE)) {
          return reject(new Error('Hace falta permitir el acceso a Google Sheets y a Google Drive: la planilla y las imagenes de los lotes viven ahi.'));
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

/* `what` nombra el recurso en el mensaje ("la planilla", "la imagen"…). */
function gErrorText(status, body, what) {
  const msg = body && body.error && body.error.message;
  if (status === 403) return `Tu cuenta no tiene permiso de edicion sobre ${what}.`;
  // Google tambien responde 404 cuando la cuenta no tiene acceso al archivo.
  if (status === 404) return `No se encontro ${what}, o tu cuenta no tiene acceso.`;
  if (status === 429) return 'Google limito las consultas por un momento. Probá de nuevo en un minuto.';
  return `Error de Google (${status})` + (msg ? ': ' + msg : '');
}

/* opts: method, body (texto JSON, o FormData para subir archivos),
   blob (devuelve el contenido como Blob) y what (para los mensajes). */
async function gFetch(url, opts = {}, retry = true) {
  await gEnsureToken();
  const headers = { Authorization: 'Bearer ' + G.token };
  if (typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers });
  } catch {
    throw new Error('Sin conexion con Google. Revisá internet y probá de nuevo.');
  }
  if (res.status === 401 && retry) {       // token revocado o vencido antes de tiempo
    G.exp = 0;
    return gFetch(url, opts, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(gErrorText(res.status, body, opts.what || 'la planilla'));
  }
  if (opts.blob) return res.blob();
  return res.json().catch(() => null);     // 204 y respuestas vacias
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

/* ---------------- Drive: imagenes de los lotes ---------------- */

/* supportsAllDrives: la planilla y la carpeta pueden estar en una unidad
   compartida de Google Workspace, no solo en "Mi unidad". */
const ALL_DRIVES = 'supportsAllDrives=true';

/* Carpeta donde esta la planilla, para crear la de imagenes al lado. Si no
   se puede leer (la planilla es de otro y no hay acceso a su carpeta) se
   devuelve null y la carpeta va a la raiz de "Mi unidad". */
async function gParentOf(fileId) {
  try {
    const f = await gFetch(`${DRIVE_API}/${fileId}?fields=parents&${ALL_DRIVES}`, { what: 'la planilla en Drive' });
    return ((f && f.parents) || [])[0] || null;
  } catch {
    return null;
  }
}

async function gCreateFolder(name, parent) {
  return gFetch(`${DRIVE_API}?fields=id,webViewLink&${ALL_DRIVES}`, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
    what: 'Google Drive'
  });
}

/* Comparte como Editor sin mandar el mail de aviso de Google. */
async function gShare(fileId, email) {
  return gFetch(`${DRIVE_API}/${fileId}/permissions?sendNotificationEmail=false&${ALL_DRIVES}`, {
    method: 'POST',
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    what: 'la carpeta de imagenes'
  });
}

/* Revisa que la carpeta exista y que la cuenta llegue a ella. */
async function gFolderOk(folderId) {
  try {
    const f = await gFetch(`${DRIVE_API}/${folderId}?fields=id,trashed&${ALL_DRIVES}`, { what: 'la carpeta de imagenes' });
    return !!f && !f.trashed;
  } catch {
    return false;
  }
}

async function gUploadImage(file, name, folderId) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', file);
  return gFetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink&${ALL_DRIVES}`, {
    method: 'POST', body: form, what: 'la carpeta de imagenes'
  });
}

function gImageBlob(fileId) {
  return gFetch(`${DRIVE_API}/${fileId}?alt=media&${ALL_DRIVES}`, { blob: true, what: 'la imagen' });
}

/* Manda la imagen a la papelera (se puede recuperar desde Drive durante 30
   dias). En "Mi unidad" solo el dueno del archivo puede hacerlo: si la subio
   otra persona, falla y la imagen queda en la carpeta, solo desvinculada. */
async function gTrash(fileId) {
  try {
    await gFetch(`${DRIVE_API}/${fileId}?${ALL_DRIVES}`, {
      method: 'PATCH', body: JSON.stringify({ trashed: true }), what: 'la imagen'
    });
    return true;
  } catch {
    return false;
  }
}