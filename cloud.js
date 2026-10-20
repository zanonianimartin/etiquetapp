/* ============================================================
   EtiquetApp — catalogo, plantillas y lotes en la planilla
   ============================================================

   Interfaz de los datos compartidos. El acceso a Google esta en google.js;
   aca se traduce entre las filas de la planilla y el estado de app.js.
   Se carga antes que app.js: solo declara funciones, que app.js llama
   recien cuando ya esta todo definido. */

const SHEET_ID_KEY = 'etiquetapp-sheet';

const cloud = {
  catalog: [],        // { codigo, tipo, producto, cantidad, unidad, ingredientes, infoExtra, nutri }
  lotes: [],          // { lote, codigo, producto, vencimiento, imagen, archivo, actualizado, por }
  loaded: 0,          // momento de la ultima carga completa
  busy: false
};
const imgCache = new Map();          // id de imagen -> data URL

/* Hay token (aunque este por vencer: gFetch lo renueva) y planilla abierta. */
const cloudReady = () => !!(G.token && G.sheet);

function requireCloud() {
  if (cloudReady()) return true;
  toast(G.token ? 'Elegí la planilla de Google para continuar.' : 'Conectate con Google para usar la planilla.', true);
  return false;
}

function savedSheetId() {
  try { return localStorage.getItem(SHEET_ID_KEY) || gConfig().spreadsheetId || ''; }
  catch { return gConfig().spreadsheetId || ''; }
}

function rememberSheetId(id) {
  try { localStorage.setItem(SHEET_ID_KEY, id); } catch { /* se vuelve a pedir al recargar */ }
}

/* Corre una operacion contra la planilla mostrando el error si falla.
   Devuelve lo que devuelva `fn`, o undefined si fallo. */
async function cloudTask(msg, fn) {
  if (cloud.busy) { toast('Esperá a que termine la operacion anterior.', true); return; }
  cloud.busy = true;
  if (msg) toast(msg);
  try {
    return await fn();
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    cloud.busy = false;
  }
}

/* ---------------- Filas <-> objetos ---------------- */

function parseNutri(txt) {
  try { return txt ? JSON.parse(txt) : null; } catch { return null; }
}

const tplFromRow = (r) => ({
  id: r.id,
  name: r.nombre || r.producto || '(sin nombre)',
  producto: r.producto || '', cantidad: r.cantidad || '', unidad: r.unidad || 'gr',
  codigo: r.codigo || '', ingredientes: r.ingredientes || '', infoExtra: r.infoExtra || '',
  nutri: cloneNutri(parseNutri(r.nutri)),
  design: r.diseno || ''
});

const tplToRow = (t) => ({
  id: t.id, nombre: t.name,
  producto: t.producto, cantidad: t.cantidad, unidad: t.unidad, codigo: t.codigo,
  ingredientes: t.ingredientes || '', infoExtra: t.infoExtra || '',
  nutri: JSON.stringify(cloneNutri(t.nutri)),
  diseno: t.design || ''
});

const catFromRow = (r) => ({
  codigo: String(r.codigo).trim(), tipo: r.tipo || '',
  producto: r.producto || '', cantidad: r.cantidad || '', unidad: r.unidad || 'gr',
  ingredientes: r.ingredientes || '', infoExtra: r.infoExtra || '',
  nutri: cloneNutri(parseNutri(r.nutri))
});

const catToRow = (c) => ({ ...c, nutri: JSON.stringify(cloneNutri(c.nutri)) });

const loteFromRow = (r) => ({
  lote: String(r.lote).trim(), codigo: r.codigo || '', producto: r.producto || '',
  vencimiento: r.vencimiento || '', imagen: r.imagen || '', archivo: r.archivo || '',
  actualizado: r.actualizado || '', por: r.por || ''
});

/* ---------------- Conexion ---------------- */

async function cloudLoadAll() {
  await gEnsureToken();               // una sola renovacion para las tres lecturas
  const [cat, tpl, lot] = await Promise.all([
    gReadTab('Catalogo'), gReadTab('Plantillas'), gReadTab('Lotes')
  ]);
  cloud.catalog = cat.rows.filter((r) => String(r.codigo || '').trim()).map(catFromRow);
  // Las plantillas se identifican por id: una fila cargada a mano sin id se ignora.
  state.templates = tpl.rows.filter((r) => String(r.id || '').trim()).map(tplFromRow);
  cloud.lotes = lot.rows.filter((r) => String(r.lote || '').trim()).map(loteFromRow);
  cloud.loaded = Date.now();

  const sel = $('tplSaved').value;
  refreshTemplateList(state.templates.some((t) => t.id === sel) ? sel : undefined);
  refreshCatalogUI();
  refreshLoteUI();
}

async function cloudOpen(id) {
  try {
    await gOpenSpreadsheet(id);
  } catch (err) {
    G.sheet = null;
    throw err;
  }
  rememberSheetId(id);
  await cloudLoadAll();
  syncCloudUI();
}

function cloudClear() {
  state.templates = [];
  cloud.catalog = [];
  cloud.lotes = [];
  imgCache.clear();
  refreshTemplateList();
  refreshCatalogUI();
  refreshLoteUI();
}

function syncCloudUI() {
  const on = cloudReady();
  document.body.classList.toggle('cloud-on', on);
  const b = $('btnGoogle');
  b.classList.toggle('on', on);
  b.textContent = on ? (G.email || 'Conectado') : G.token ? 'Elegir planilla' : 'Conectar con Google';
  b.title = on ? `Planilla: ${G.sheet.title}` : 'Guardar catalogo, plantillas y lotes en Google Sheets';
}

async function onGoogleClick() {
  if (G.token) return openGModal();
  await cloudTask(null, async () => {
    await gSignIn();
    const id = savedSheetId();
    if (id) {
      await cloudOpen(id);
      toast(`Conectado a "${G.sheet.title}"`);
    }
  });
  syncCloudUI();
  // Sin planilla (o si la recordada ya no se puede abrir) se ofrece elegir otra.
  if (G.token && !G.sheet) openGModal();
}

/* ---------------- Modal de la planilla ---------------- */

function openGModal() {
  $('gWho').textContent = G.email ? `Conectado como ${G.email}` : 'Conectado con Google';
  const cur = $('gCurrent');
  cur.innerHTML = '';
  if (G.sheet) {
    cur.append('Planilla actual: ');
    const a = el('a', null, G.sheet.title);
    a.href = gSheetUrl();
    a.target = '_blank';
    a.rel = 'noopener';
    cur.appendChild(a);
  } else {
    cur.textContent = 'Todavia no hay una planilla elegida. Pegá la URL de la planilla del equipo o creá una nueva.';
  }
  $('gSheetInput').value = '';
  $('gErr').textContent = '';
  $('gReload').disabled = !G.sheet;
  $('gModal').classList.add('show');
}

const closeGModal = () => $('gModal').classList.remove('show');

async function useSheetFromInput() {
  const id = gParseSheetId($('gSheetInput').value);
  if (!id) { $('gErr').textContent = 'Pegá la URL de la planilla (docs.google.com/spreadsheets/d/…) o su ID.'; return; }
  const ok = await cloudTask('Abriendo planilla…', async () => { await cloudOpen(id); return true; });
  if (!ok) return;
  closeGModal();
  toast(`Conectado a "${G.sheet.title}"`);
}

async function createSheet() {
  const name = await askText('Nombre de la planilla nueva', 'EtiquetApp - datos');
  if (name === null) return;
  const title = name.trim() || 'EtiquetApp - datos';
  const ok = await cloudTask('Creando planilla…', async () => {
    await gCreateSpreadsheet(title);
    rememberSheetId(G.sheet.id);
    await cloudLoadAll();
    return true;
  });
  syncCloudUI();
  if (!ok) return;
  openGModal();
  toast('Planilla creada. Compartila con el equipo desde Google Sheets (boton Compartir).');
}

/* ---------------- Plantillas ---------------- */

async function cloudSaveTemplate(tpl) {
  if (!requireCloud()) return false;
  return !!await cloudTask('Guardando plantilla…', async () => {
    await gUpsert('Plantillas', 'id', tplToRow(tpl));
    return true;
  });
}

async function cloudDeleteTemplate(id) {
  if (!requireCloud()) return false;
  return !!await cloudTask('Eliminando plantilla…', async () => {
    await gDelete('Plantillas', 'id', id);
    return true;
  });
}

/* Sube las plantillas de un proyecto abierto que no esten en la planilla
   (se comparan por nombre). */
async function cloudImportTemplates(list) {
  if (!cloudReady()) {
    toast('El proyecto trae plantillas: conectate con Google y volvé a abrirlo para subirlas.', true);
    return;
  }
  const nombres = new Set(state.templates.map((t) => t.name.toLowerCase()));
  const nuevas = list.filter((t) => t && t.name && !nombres.has(String(t.name).toLowerCase()));
  if (!nuevas.length) return;
  if (!confirm(`El proyecto trae ${nuevas.length} plantilla(s) que no estan en la planilla. ¿Subirlas?`)) return;

  const ok = await cloudTask('Subiendo plantillas…', async () => {
    for (const t of nuevas) {
      const tpl = { ...emptyLabel(), ...t, id: t.id || 't' + Date.now().toString(36), nutri: cloneNutri(t.nutri) };
      await gUpsert('Plantillas', 'id', tplToRow(tpl));
    }
    await cloudLoadAll();
    return true;
  });
  if (ok) toast(`${nuevas.length} plantilla(s) subidas a la planilla`);
}

/* ---------------- Catalogo de codigos ---------------- */

function refreshCatalogUI() {
  const dl = $('catList');
  dl.innerHTML = '';
  cloud.catalog.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.codigo;
    o.label = c.producto;
    dl.appendChild(o);
  });
  $('catCount').textContent = cloudReady() ? `${cloud.catalog.length} codigos` : '—';
}

/* Busca por codigo exacto o, si no hay, por nombre de producto. */
function findCatalog(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  return cloud.catalog.find((c) => c.codigo.toLowerCase() === t)
      || cloud.catalog.find((c) => c.producto.toLowerCase() === t)
      || null;
}

/* Completa todo menos lote y vencimiento, que son de cada tirada. */
function applyCatalog(c) {
  applyPatch({
    producto: c.producto, cantidad: c.cantidad, unidad: c.unidad, codigo: c.codigo,
    ingredientes: c.ingredientes, infoExtra: c.infoExtra, nutri: cloneNutri(c.nutri)
  });
  if (c.tipo && BARCODE_RULES[c.tipo] && c.tipo !== state.cfg.barcodeType) {
    state.cfg.barcodeType = c.tipo;
    bcCache.clear();
    syncControls();
    persist();
  }
  renderSheets();
  fillForm();
  toast(`"${c.producto}" cargado del catalogo · falta lote y vencimiento`);
}

async function saveToCatalog() {
  if (!requireCloud()) return;
  const l = currentLabel();
  const codigo = String(l.codigo || '').trim();
  if (!codigo) return toast('Cargá el codigo de barras de la etiqueta.', true);
  const v = validateCode(codigo, state.cfg.barcodeType);
  if (!v.ok) return toast('El codigo no es valido: ' + v.msg, true);
  if (!String(l.producto || '').trim()) return toast('Cargá al menos el producto.', true);

  const prev = cloud.catalog.find((c) => c.codigo === codigo);
  if (prev && prev.producto !== l.producto &&
      !confirm(`El codigo ${codigo} ya esta en el catalogo como "${prev.producto}". ¿Reemplazarlo por "${l.producto}"?`)) return;

  const entry = {
    codigo, tipo: state.cfg.barcodeType,
    producto: l.producto, cantidad: l.cantidad, unidad: l.unidad,
    ingredientes: l.ingredientes || '', infoExtra: l.infoExtra || '',
    nutri: cloneNutri(l.nutri)
  };
  const ok = await cloudTask('Guardando en el catalogo…', async () => {
    await gUpsert('Catalogo', 'codigo', catToRow(entry));
    return true;
  });
  if (!ok) return;
  if (prev) Object.assign(prev, entry);
  else cloud.catalog.push(entry);
  refreshCatalogUI();
  $('catSearch').value = codigo;
  toast(prev ? `Codigo ${codigo} actualizado en el catalogo` : `Codigo ${codigo} agregado al catalogo`);
}

async function deleteFromCatalog() {
  if (!requireCloud()) return;
  const c = findCatalog($('catSearch').value);
  if (!c) return toast('Elegí un codigo del catalogo.', true);
  if (!confirm(`¿Eliminar del catalogo el codigo ${c.codigo} (${c.producto})?`)) return;
  const ok = await cloudTask('Eliminando del catalogo…', async () => {
    await gDelete('Catalogo', 'codigo', c.codigo);
    return true;
  });
  if (!ok) return;
  cloud.catalog = cloud.catalog.filter((x) => x !== c);
  refreshCatalogUI();
  $('catSearch').value = '';
  toast(`Codigo ${c.codigo} eliminado del catalogo`);
}

/* ---------------- Registro de lotes ---------------- */

const currentLote = () => String(currentLabel().lote || '').trim();
const findLote = (lote) => cloud.lotes.find((x) => x.lote === lote) || null;

function refreshLoteDatalist() {
  const dl = $('loteList');
  dl.innerHTML = '';
  cloud.lotes.forEach((x) => {
    const o = document.createElement('option');
    o.value = x.lote;
    o.label = [x.producto, x.vencimiento && 'Vto ' + x.vencimiento].filter(Boolean).join(' · ');
    dl.appendChild(o);
  });
}

/* Se llama en cada tecla del formulario: se agrupa para no repintar de mas. */
let loteTimer = null;
function refreshLoteUI() {
  clearTimeout(loteTimer);
  loteTimer = setTimeout(paintLote, 150);
}

function fechaCorta(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('es-UY');
}

async function paintLote() {
  refreshLoteDatalist();
  $('loteCount').textContent = cloudReady() ? `${cloud.lotes.length} registrados` : '—';

  const lote = currentLote();
  const reg = lote ? findLote(lote) : null;
  const info = $('loteInfo');
  if (!lote) info.textContent = 'La etiqueta seleccionada todavia no tiene lote.';
  else if (!reg) info.textContent = `Lote ${lote}: sin registrar.`;
  else {
    const cuando = fechaCorta(reg.actualizado);
    info.textContent = `Lote ${lote}: registrado` +
      (cuando ? ` el ${cuando}` : '') + (reg.por ? ` por ${reg.por}` : '') +
      (reg.imagen ? ' · con imagen' : ' · sin imagen');
  }

  $('btnLoteSave').textContent = reg ? 'Actualizar registro' : 'Registrar lote';
  $('btnLoteSave').disabled = !lote;
  $('btnLoteImg').textContent = reg && reg.imagen ? 'Cambiar imagen…' : 'Adjuntar imagen…';
  $('btnLoteImg').disabled = !lote;
  $('btnLoteImgDel').hidden = !(reg && reg.imagen);

  const box = $('loteImgBox');
  const img = $('loteImg');
  if (!cloudReady() || !reg || !reg.imagen) { box.hidden = true; img.removeAttribute('src'); return; }

  box.hidden = false;
  if (imgCache.has(reg.imagen)) { img.src = imgCache.get(reg.imagen); box.classList.remove('loading'); return; }

  img.removeAttribute('src');
  box.classList.add('loading');
  try {
    const data = await gLoadImage(reg.imagen);
    if (data) imgCache.set(reg.imagen, data);
    // Mientras bajaba, el usuario pudo haber pasado a otra etiqueta.
    if (currentLote() !== lote) return;
    if (data) img.src = data;
    else info.textContent += ' (la imagen ya no esta en la planilla)';
  } catch (err) {
    if (currentLote() === lote) info.textContent += ' · no se pudo cargar la imagen';
  } finally {
    box.classList.remove('loading');
  }
}

/* Guarda la fila del lote con los datos de la etiqueta seleccionada.
   `extra` sobreescribe columnas (imagen); las que no trae se conservan. */
async function writeLote(extra = {}) {
  const l = currentLabel();
  const row = {
    lote: currentLote(), codigo: l.codigo || '', producto: l.producto || '',
    vencimiento: l.venc || '', ...extra
  };
  await gUpsert('Lotes', 'lote', row);
  const prev = findLote(row.lote);
  const full = { ...(prev || {}), ...row, ...gStamp() };
  if (prev) Object.assign(prev, full);
  else cloud.lotes.push(full);
}

async function registerLote() {
  if (!requireCloud()) return;
  if (!currentLote()) return toast('Cargá el lote de la etiqueta.', true);
  const nuevo = !findLote(currentLote());
  const ok = await cloudTask('Registrando lote…', async () => { await writeLote(); return true; });
  if (!ok) return;
  refreshLoteUI();
  toast(nuevo ? `Lote ${currentLote()} registrado` : `Lote ${currentLote()} actualizado`);
}

/* Achica la foto a JPEG hasta que entre en la planilla. La imagen es solo
   de registro, asi que 1600 px de lado alcanzan de sobra. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El archivo no es una imagen valida.')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const cap = IMG_CHUNK * IMG_MAX_CHUNKS;
      for (const [max, q] of [[1600, 0.82], [1280, 0.75], [1024, 0.7], [800, 0.6]]) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k));
        cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';                       // JPEG no tiene transparencia
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const out = cv.toDataURL('image/jpeg', q);
        if (out.length - out.indexOf(',') - 1 <= cap) return resolve(out);
      }
      reject(new Error('No se pudo achicar la imagen lo suficiente.'));
    };
    img.src = url;
  });
}

async function attachLoteImage() {
  if (!requireCloud()) return;
  const lote = currentLote();
  if (!lote) return toast('Cargá el lote de la etiqueta.', true);
  // El token se renueva antes de abrir el selector de archivos: despues el
  // navegador ya no considera que hubo un clic y bloquea el popup de Google.
  try { await gEnsureToken(); } catch (err) { return toast(err.message, true); }

  const file = await pickFile('image/*');
  if (!file) return;
  // Se copia el id ahora: writeLote actualiza el registro en el lugar.
  const anterior = (findLote(lote) || {}).imagen;
  const ok = await cloudTask('Subiendo imagen…', async () => {
    const data = await compressImage(file);
    const id = 'img-' + Date.now().toString(36);
    await gSaveImage(id, data);
    imgCache.set(id, data);
    await writeLote({ imagen: id, archivo: file.name });
    // La imagen anterior se borra despues: si algo falla, el lote no queda sin ninguna.
    if (anterior) await gDeleteImage(anterior).catch(() => {});
    return true;
  });
  if (!ok) return;
  refreshLoteUI();
  toast(`Imagen asociada al lote ${lote}`);
}

async function removeLoteImage() {
  if (!requireCloud()) return;
  const reg = findLote(currentLote());
  if (!reg || !reg.imagen) return;
  if (!confirm(`¿Quitar la imagen del lote ${reg.lote}?`)) return;
  const ok = await cloudTask('Quitando imagen…', async () => {
    await gDeleteImage(reg.imagen);
    await writeLote({ imagen: '', archivo: '' });
    return true;
  });
  if (!ok) return;
  refreshLoteUI();
  toast(`Imagen quitada del lote ${reg.lote}`);
}

/* Abre la imagen en tamano real en otra pestana. Chrome no navega a URLs
   data:, asi que se pasa por un Blob. */
function openLoteImage() {
  const src = $('loteImg').src;
  if (!src || !src.startsWith('data:')) return;
  const [head, b64] = src.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), '_blank');
}

/* ---------------- Eventos ---------------- */

function bindCloudEvents() {
  $('btnGoogle').addEventListener('click', onGoogleClick);

  $('gUse').addEventListener('click', useSheetFromInput);
  $('gSheetInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') useSheetFromInput(); });
  $('gCreate').addEventListener('click', createSheet);
  $('gReload').addEventListener('click', async () => {
    const ok = await cloudTask('Actualizando…', async () => { await cloudLoadAll(); return true; });
    if (ok) toast('Datos actualizados desde la planilla');
  });
  $('gLogout').addEventListener('click', () => {
    gSignOut();
    cloudClear();
    syncCloudUI();
    closeGModal();
    toast('Desconectado de Google');
  });
  $('gClose').addEventListener('click', closeGModal);
  $('gModal').addEventListener('click', (e) => { if (e.target === $('gModal')) closeGModal(); });

  /* --- catalogo --- */
  const aplicarBusqueda = () => {
    const c = findCatalog($('catSearch').value);
    if (!c) return toast('Ese codigo no esta en el catalogo.', true);
    applyCatalog(c);
  };
  $('btnCatApply').addEventListener('click', aplicarBusqueda);
  $('catSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicarBusqueda(); });
  $('btnCatSave').addEventListener('click', saveToCatalog);
  $('btnCatDelete').addEventListener('click', deleteFromCatalog);

  /* Elegir (o terminar de escribir) un codigo del catalogo en el campo de la
     etiqueta completa el resto. Si la etiqueta ya tiene esos datos no hace
     nada, asi no aparece el aviso cada vez que se sale del campo. */
  $('fCodigo').addEventListener('change', () => {
    const c = cloud.catalog.find((x) => x.codigo === $('fCodigo').value.trim());
    if (!c) return;
    const l = currentLabel();
    const igual = ['producto', 'cantidad', 'unidad', 'ingredientes', 'infoExtra']
      .every((k) => String(l[k] || '') === String(c[k] || ''));
    if (!igual) applyCatalog(c);
  });

  /* --- lotes --- */
  $('btnLoteSave').addEventListener('click', registerLote);
  $('btnLoteImg').addEventListener('click', attachLoteImage);
  $('btnLoteImgDel').addEventListener('click', removeLoteImage);
  $('loteImg').addEventListener('click', openLoteImage);

  /* Al volver a la pestana se recargan los datos, por si otra persona del
     equipo cambio algo. Solo con token vigente: sin clic de por medio, el
     navegador bloquearia el popup de Google. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !cloudReady() || !gConnected()) return;
    if (cloud.busy || Date.now() - cloud.loaded < 60000) return;
    cloudLoadAll().catch(() => { /* se reintenta en la proxima vuelta */ });
  });
}

async function cloudInit() {
  bindCloudEvents();
  syncCloudUI();
  refreshCatalogUI();
  refreshLoteUI();
  if (!gRestoreSession()) return;

  const id = savedSheetId();
  if (id) {
    await cloudTask(null, () => cloudOpen(id));
  }
  syncCloudUI();
}
