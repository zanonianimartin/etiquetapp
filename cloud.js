/* ============================================================
   EtiquetApp — catalogo y lotes en la planilla
   ============================================================

   Interfaz de los datos compartidos. El acceso a Google esta en google.js;
   aca se traduce entre las filas de la planilla y el estado de app.js.
   Se carga antes que app.js: solo declara funciones, que app.js llama
   recien cuando ya esta todo definido. */

const SHEET_ID_KEY = 'etiquetapp-sheet';
const IMG_MAX = 20 * 1024 * 1024;    // fotos de celular de sobra; evita subir videos por error
const FOLDER_NAME = 'EtiquetApp - imagenes de lotes';

const cloud = {
  catalog: [],        // { codigo, tipo, producto, cantidad, unidad, ingredientes, infoExtra, nutri }
  lotes: [],          // { lote, codigo, producto, vencimiento, imagen, archivo, enlace, actualizado, por }
  usuarios: [],       // filas activas de la pestana Usuarios
  ajustes: {},        // pestana Ajustes: clave -> valor
  loaded: 0,          // momento de la ultima carga completa
  rol: '',            // rol de la cuenta conectada en la pestana Usuarios
  openError: '',      // por que no se pudo abrir la planilla (para mostrarlo)
  busy: false
};
const imgCache = new Map();          // id del archivo en Drive -> object URL

/* Hay token (aunque este por vencer: gFetch lo renueva) y planilla abierta. */
const cloudReady = () => !!(G.token && G.sheet);

function requireCloud() {
  if (cloudReady()) return true;
  toast(G.token ? 'Elegí la planilla de Google para continuar.' : 'Conectate con Google para usar la planilla.', true);
  return false;
}

/* Con `spreadsheetId` en config.js todo el equipo usa esa planilla y la app
   no ofrece cambiarla. Sin el, se recuerda en el navegador la que se eligio
   o creo (modo de puesta en marcha). */
const sheetFixed = () => !!gConfig().spreadsheetId;

function savedSheetId() {
  if (sheetFixed()) return gConfig().spreadsheetId;
  try { return localStorage.getItem(SHEET_ID_KEY) || ''; } catch { return ''; }
}

function rememberSheetId(id) {
  if (sheetFixed()) return;
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

const catFromRow = (r) => ({
  codigo: String(r.codigo).trim(), clave: r.clave || '', tipo: r.tipo || '',
  producto: r.producto || '', cantidad: r.cantidad || '', unidad: r.unidad || 'gr',
  ingredientes: r.ingredientes || '', infoExtra: r.infoExtra || '',
  nutri: cloneNutri(parseNutri(r.nutri))
});

const catToRow = (c) => ({ ...c, nutri: JSON.stringify(cloneNutri(c.nutri)) });

const loteFromRow = (r) => ({
  lote: String(r.lote).trim(), codigo: r.codigo || '', producto: r.producto || '',
  vencimiento: r.vencimiento || '', imagen: r.imagen || '', archivo: r.archivo || '',
  enlace: r.enlace || '', actualizado: r.actualizado || '', por: r.por || ''
});

/* ---------------- Acceso ---------------- */

/* Vacio cuenta como activo: alcanza con escribir el email para habilitar. */
const esActivo = (v) => !['no', 'n', 'false', '0', 'inactivo'].includes(String(v || '').trim().toLowerCase());

function accessDenied(msg) {
  const err = new Error(msg);
  err.denied = true;
  return err;
}

/* Revisa que la cuenta conectada figure activa en la pestana Usuarios y
   devuelve su rol. Si la lista esta vacia (planilla recien creada) quien la
   abre queda como administrador: si no, nadie podria entrar nunca.
   Este control es de la app; el que protege los datos de verdad son los
   permisos de la planilla, que mantiene apps-script/usuarios.gs. */
async function checkAccess(rows) {
  const lista = rows.filter((r) => String(r.email || '').trim());
  const yo = G.email.toLowerCase();
  if (!lista.length) {
    await gUpsert('Usuarios', 'email', { email: G.email, rol: 'admin', activo: 'SI' });
    return 'admin';
  }
  const fila = lista.find((r) => String(r.email).trim().toLowerCase() === yo);
  if (!fila) throw accessDenied(`La cuenta ${G.email} no esta habilitada para usar EtiquetApp. Pedile a un administrador que la agregue en la pestana Usuarios de la planilla.`);
  if (!esActivo(fila.activo)) throw accessDenied(`La cuenta ${G.email} esta deshabilitada en la pestana Usuarios de la planilla.`);
  return String(fila.rol || '').trim().toLowerCase() === 'admin' ? 'admin' : 'usuario';
}

/* Sin acceso se cierra la sesion de Google y se vuelve a la pantalla de
   ingreso con el motivo. */
function handleDenied(err) {
  gSignOut();
  cloudClear();
  syncCloudUI(err.message);
}

/* ---------------- Conexion ---------------- */

async function cloudLoadAll() {
  await gEnsureToken();               // una sola renovacion para todas las lecturas
  const [usu, cat, lot, aju] = await Promise.all([
    gReadTab('Usuarios'), gReadTab('Catalogo'), gReadTab('Lotes'), gReadTab('Ajustes')
  ]);
  cloud.rol = await checkAccess(usu.rows);
  cloud.usuarios = usu.rows.filter((r) => String(r.email || '').trim() && esActivo(r.activo));
  cloud.ajustes = Object.fromEntries(aju.rows.map((r) => [String(r.clave).trim(), String(r.valor || '').trim()]));
  cloud.catalog = cat.rows.filter((r) => String(r.codigo || '').trim()).map(catFromRow);
  cloud.lotes = lot.rows.filter((r) => String(r.lote || '').trim()).map(loteFromRow);
  cloud.loaded = Date.now();

  refreshCatalogUI();
  refreshLoteUI();
}

async function cloudOpen(id) {
  try {
    await gOpenSpreadsheet(id);
    await cloudLoadAll();
  } catch (err) {
    cloud.openError = err.message || String(err);
    if (err.denied) handleDenied(err);
    else { G.sheet = null; syncCloudUI(); }
    throw err;
  }
  cloud.openError = '';
  rememberSheetId(id);
  syncCloudUI();
}

/* Recarga los datos y vuelve a revisar el acceso: si un administrador quito
   la cuenta mientras la app estaba abierta, la saca. */
async function cloudRefresh() {
  try {
    await cloudLoadAll();
    return true;
  } catch (err) {
    if (err.denied) handleDenied(err);
    else toast(err.message || String(err), true);
    return false;
  }
}

function cloudClear() {
  cloud.catalog = [];
  cloud.lotes = [];
  cloud.usuarios = [];
  cloud.ajustes = {};
  cloud.rol = '';
  clearTimeout(syncTimer);
  syncPending = null;
  imgCache.forEach((url) => URL.revokeObjectURL(url));
  imgCache.clear();
  refreshCatalogUI();
  refreshLoteUI();
}

/* `msg` se muestra en la pantalla de ingreso: un error (por ejemplo, por que
   se rechazo la cuenta) o, con `info`, un aviso de progreso. */
function syncCloudUI(msg, info = false) {
  const on = cloudReady();
  document.body.classList.toggle('cloud-on', on);
  const b = $('btnGoogle');
  b.classList.toggle('on', on);
  b.textContent = on ? (G.email || 'Conectado') : G.token ? 'Elegir planilla' : 'Conectar con Google';
  b.title = on ? `Planilla: ${G.sheet.title}` : 'Guardar catalogo y lotes en Google Sheets';

  const gl = $('gateLogin');
  gl.textContent = G.token ? 'Elegir planilla' : 'Iniciar sesion con Google';
  gl.disabled = !gConfigured();
  const gm = $('gateMsg');
  if (!gConfigured()) gm.textContent = 'Falta configurar el ID de cliente de Google en config.js.';
  else if (msg !== undefined) {
    gm.textContent = msg;
    gm.classList.toggle('info', info);
  }
}

/* El error se muestra en la pantalla de ingreso, que es lo que se ve
   mientras no hay una cuenta habilitada conectada. */
async function onGoogleClick() {
  if (G.token) return openGModal();
  $('gateLogin').disabled = true;
  syncCloudUI('Conectando…', true);
  let msg = '';
  try {
    await gSignIn();
    const id = savedSheetId();
    if (id) {
      await cloudOpen(id);
      toast(`Conectado a "${G.sheet.title}"`);
    }
  } catch (err) {
    msg = err.message || String(err);
  }
  syncCloudUI(msg);
  // Sin planilla (o si la recordada ya no se puede abrir) se ofrece elegir otra.
  if (G.token && !G.sheet) openGModal();
}

/* ---------------- Modal de la planilla ---------------- */

function sheetLink(text, href) {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function openGModal() {
  $('gWho').textContent = (G.email ? `Conectado como ${G.email}` : 'Conectado con Google') +
    (cloud.rol === 'admin' ? ' · administrador' : cloud.rol ? ' · usuario' : '');
  const cur = $('gCurrent');
  cur.innerHTML = '';
  if (G.sheet) {
    cur.append('Planilla actual: ');
    cur.appendChild(sheetLink(G.sheet.title, gSheetUrl()));
    // Los administradores manejan las cuentas habilitadas desde la planilla.
    if (cloud.rol === 'admin' && 'Usuarios' in G.sheet.tabs) {
      cur.append(' · ');
      cur.appendChild(sheetLink('Administrar usuarios', `${gSheetUrl()}#gid=${G.sheet.tabs.Usuarios}`));
    }
    const fix = $('gFixed');
    fix.innerHTML = '';
    if (sheetFixed()) {
      fix.textContent = 'Es la planilla del equipo, fijada en config.js: todos los usuarios trabajan sobre ella.';
    } else {
      // Puesta en marcha: falta fijarla para que el resto del equipo no elija otra.
      fix.append('Para que todo el equipo use esta planilla, cargá su ID en config.js (spreadsheetId): ');
      fix.appendChild(el('code', null, G.sheet.id));
    }
  } else if (sheetFixed()) {
    /* La planilla esta fijada en config.js: si no hay planilla abierta es
       porque fallo al abrirla. Casi siempre es la cuenta: se entro con una
       que no tiene acceso (por ejemplo, otra cuenta de Google del celular). */
    cur.textContent = 'No se pudo abrir la planilla del equipo' +
      (cloud.openError ? `: ${cloud.openError}` : '.');
    $('gFixed').textContent = 'Revisá que la cuenta de arriba sea una con acceso a la planilla. ' +
      'Si no lo es, tocá Desconectar y entrá con la cuenta correcta.';
  } else {
    cur.textContent = 'Todavia no hay una planilla elegida. Pegá la URL de la planilla del equipo o creá una nueva.';
    $('gFixed').textContent = '';
  }
  $('gRetry').hidden = !(sheetFixed() && !G.sheet);
  $('gChange').hidden = sheetFixed();
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
  if (!G.token) return closeGModal();      // cuenta rechazada: queda la pantalla de ingreso
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
  toast('Planilla creada. Falta cargar su ID en config.js para que todo el equipo use esta.');
}

/* ---------------- Catalogo de codigos ---------------- */

function refreshCatalogUI() {
  if (!$('catResults').hidden) renderCatResults();
  $('catCount').textContent = cloudReady() ? `${cloud.catalog.length} productos` : '—';
  if (!syncPending) paintCatLink();
}

/* ---------------- Buscador de productos ---------------- */

/* Lista de resultados propia en lugar de <datalist>, que en los celulares
   no muestra sugerencias o no busca por nombre. Se busca sin distinguir
   mayusculas ni acentos ("pimenton" encuentra "Pimentón"), por nombre,
   codigo o clave; la clave no se muestra. */
const CAT_MAX = 40;
let catActive = -1;               // resultado resaltado con las flechas
let catShown = [];                // productos de la lista visible

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const presentacion = (c) => [c.cantidad, c.unidad].filter(Boolean).join(' ');

function searchCatalog(text) {
  const palabras = normalizar(text).split(/\s+/).filter(Boolean);
  const lista = cloud.catalog.filter((c) => {
    const donde = normalizar(`${c.producto} ${presentacion(c)} ${c.codigo} ${c.clave}`);
    return palabras.every((p) => donde.includes(p));
  });
  return lista.sort((a, b) => a.producto.localeCompare(b.producto, 'es') || Number(a.cantidad) - Number(b.cantidad));
}

function renderCatResults() {
  const box = $('catResults');
  box.innerHTML = '';
  catShown = searchCatalog($('catSearch').value);
  catActive = Math.min(catActive, catShown.length - 1);
  if (!catShown.length) {
    box.appendChild(el('div', 'cat-empty', cloud.catalog.length ? 'Ningun producto coincide.' : 'El catalogo esta vacio.'));
  }
  catShown.slice(0, CAT_MAX).forEach((c, i) => {
    const it = el('div', 'cat-item' + (i === catActive ? ' on' : ''));
    it.setAttribute('role', 'option');
    const fila = el('div', 'cat-prod');
    fila.appendChild(el('b', null, c.producto));
    const pres = presentacion(c);
    if (pres) fila.appendChild(el('span', null, pres));
    it.appendChild(fila);
    it.appendChild(el('div', 'cat-code', c.codigo));
    /* Se elige con click (en el celular no llega si el dedo se arrastro para
       desplazar la lista). El preventDefault de pointerdown evita que el
       campo pierda el foco y cierre la lista antes de ese click. */
    it.addEventListener('pointerdown', (e) => e.preventDefault());
    it.addEventListener('click', () => pickCatResult(c));
    box.appendChild(it);
  });
  if (catShown.length > CAT_MAX) {
    box.appendChild(el('div', 'cat-empty', `… y ${catShown.length - CAT_MAX} mas: escribí para filtrar.`));
  }
  box.hidden = false;
  $('catSearch').setAttribute('aria-expanded', 'true');
}

function closeCatResults() {
  $('catResults').hidden = true;
  $('catSearch').setAttribute('aria-expanded', 'false');
  catActive = -1;
}

function pickCatResult(c) {
  $('catSearch').value = c.codigo;
  closeCatResults();
  $('catSearch').blur();          // en el celular, baja el teclado
  applyCatalog(c);
}

/* Busca por codigo, por clave (respetando mayusculas: "sal1k" y "SAL1K" son
   productos distintos) o por nombre de producto. */
function findCatalog(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  if (!t) return null;
  return cloud.catalog.find((c) => c.codigo.toLowerCase() === t)
      || cloud.catalog.find((c) => c.clave === raw)
      || cloud.catalog.find((c) => c.producto.toLowerCase() === t)
      || null;
}

/* ---------------- Edicion del producto desde la etiqueta ---------------- */

/* Una etiqueta cuyo codigo esta en el catalogo queda vinculada a ese
   producto: lo que se cambie en sus datos (todo menos lote y vencimiento)
   se guarda solo en la planilla al salir del campo (evento `change`).
   Mientras se escribe solo se guarda una copia de la etiqueta: al salir del
   campo la seleccion pudo haber pasado a otra (el clic que saca el foco
   puede ser sobre otra etiqueta), y lo que va al catalogo es lo editado. */
const PRODUCT_FIELDS = ['producto', 'cantidad', 'unidad', 'ingredientes', 'infoExtra'];
let syncTimer = null;            // reintento si la planilla esta ocupada
let syncPending = null;          // copia de la etiqueta editada, esperando guardarse
let linkMsgTimer = null;

const linkedProduct = (l) => {
  const code = String((l && l.codigo) || '').trim();
  return code ? cloud.catalog.find((c) => c.codigo === code) || null : null;
};

const productDiffers = (l, c) =>
  PRODUCT_FIELDS.some((k) => String(l[k] || '') !== String(c[k] || '')) ||
  JSON.stringify(cloneNutri(l.nutri)) !== JSON.stringify(cloneNutri(c.nutri));

/* Linea de estado del catalogo. `estado`: saving | saved | incompleto | error;
   sin estado describe la etiqueta seleccionada. */
function paintCatLink(estado, detalle) {
  const p = $('catLink');
  clearTimeout(linkMsgTimer);
  p.classList.remove('ok', 'bad');
  if (!cloudReady()) { p.textContent = ''; return; }
  const c = linkedProduct(currentLabel());
  if (estado === 'pending') p.textContent = 'Cambios sin guardar: se guardan en el catalogo al salir del campo.';
  else if (estado === 'saving') p.textContent = 'Guardando los cambios en el catalogo…';
  else if (estado === 'saved') {
    p.textContent = `Cambios guardados en "${detalle}".`;
    p.classList.add('ok');
    linkMsgTimer = setTimeout(() => paintCatLink(), 3000);
  } else if (estado === 'incompleto') {
    p.textContent = 'Falta el producto o la cantidad: el catalogo se actualiza cuando esten completos.';
    p.classList.add('bad');
  } else if (estado === 'error') {
    p.textContent = 'No se pudo actualizar el producto: ' + detalle;
    p.classList.add('bad');
  } else if (c) {
    p.textContent = `Etiqueta vinculada a "${c.producto}": los cambios en sus datos se guardan en el catalogo al salir de cada campo (menos lote y vencimiento).`;
  } else {
    p.textContent = '';
  }
}

/* `guardar`: false mientras se escribe (solo anota el cambio), true al salir
   del campo o al confirmar la tabla nutricional (lo manda a la planilla). */
function catalogEdited(guardar = false) {
  if (!cloudReady()) return;
  const l = currentLabel();
  if (linkedProduct(l)) {
    syncPending = cloneLabel(l);
    if (!guardar) paintCatLink('pending');
  }
  if (guardar && syncPending) {
    clearTimeout(syncTimer);
    syncProduct();
  }
}

async function syncProduct() {
  const l = syncPending;
  if (!l || !cloudReady()) return;
  const c = linkedProduct(l);
  if (!c || !productDiffers(l, c)) { syncPending = null; return paintCatLink(); }
  if (!String(l.producto || '').trim() || !String(l.cantidad || '').trim()) return paintCatLink('incompleto');
  // Otra operacion con la planilla en curso: se reintenta en un rato.
  if (cloud.busy) { syncTimer = setTimeout(syncProduct, 800); return; }

  syncPending = null;
  const cambios = {
    producto: l.producto, cantidad: l.cantidad, unidad: l.unidad,
    ingredientes: l.ingredientes || '', infoExtra: l.infoExtra || '',
    nutri: cloneNutri(l.nutri)
  };
  cloud.busy = true;
  paintCatLink('saving');
  try {
    // clave, codigo y tipo no cambian: van tal cual estaban.
    await gUpsert('Catalogo', 'codigo', catToRow({ ...c, ...cambios }));
    Object.assign(c, cambios);
    refreshCatalogUI();
    paintCatLink('saved', c.producto);
  } catch (err) {
    syncPending = l;                 // queda pendiente: se reintenta con el proximo cambio
    paintCatLink('error', err.message || String(err));
  } finally {
    cloud.busy = false;
  }
}

/* ---------------- Nuevo producto ---------------- */

/* Revisa la clave mientras se escribe. Devuelve { ok, codigo, msg, aviso }:
   `msg` bloquea la creacion, `aviso` solo informa. */
function checkClave(clave) {
  if (!clave) return { ok: false, codigo: '', msg: '' };
  const r = textoADecimal(clave);
  if (!r.ok) return r;
  if (clave !== clave.trim()) return { ok: false, codigo: '', msg: 'Sin espacios al principio ni al final.' };
  if (clave.length < CLAVE_LEN) {
    const f = CLAVE_LEN - clave.length;
    return { ok: false, codigo: '', msg: `${f > 1 ? `Faltan ${f} caracteres` : 'Falta 1 caracter'}: la clave lleva ${CLAVE_LEN}.` };
  }
  const existe = cloud.catalog.find((c) => c.codigo === r.codigo);
  if (existe) return { ok: false, codigo: r.codigo, msg: `Esa clave ya es del producto "${existe.producto}".` };
  const parecida = cloud.catalog.find((c) => c.clave && c.clave.toLowerCase() === clave.toLowerCase());
  return {
    ok: true, codigo: r.codigo, msg: '',
    aviso: parecida ? `Ojo: ya existe la clave "${parecida.clave}" (${parecida.producto}); solo cambia en mayusculas y minusculas.` : ''
  };
}

function paintProdClave() {
  const r = checkClave($('pClave').value);
  $('pClaveErr').textContent = r.msg;
  $('pClave').closest('.field').classList.toggle('missing', !!r.msg);
  const box = $('pBc');
  box.innerHTML = '';
  const svg = r.codigo ? makeBarcode(r.codigo, 'CODE128', true) : null;
  if (svg && r.ok) box.appendChild(svg);
  else box.appendChild(el('span', 'muted', `El codigo de barras aparece al completar los ${CLAVE_LEN} caracteres de la clave.`));
  $('pCodigo').textContent = r.ok ? `Codigo ${r.codigo} · CODE128` + (r.aviso ? ` · ${r.aviso}` : '') : '';
}

/* Arranca con los datos de la etiqueta seleccionada: lo habitual es armar
   la etiqueta, revisarla en la vista previa y despues darla de alta. */
function openProdModal() {
  if (!requireCloud()) return;
  const l = currentLabel();
  $('pClave').value = '';
  $('pProducto').value = l.producto || '';
  $('pCantidad').value = l.cantidad || '';
  $('pUnidad').innerHTML = $('fUnidad').innerHTML;
  $('pUnidad').value = l.unidad || 'gr';
  $('pIngredientes').value = l.ingredientes || '';
  $('pInfoExtra').value = l.infoExtra || '';
  const filas = nutriVisible(l) ? nutriRows(l.nutri).length : 0;
  $('pNutri').textContent = filas
    ? `La tabla nutricional (${filas} elementos) se copia de la etiqueta seleccionada.`
    : 'Sin tabla nutricional. Para agregarla despues: cargala en la etiqueta y usá "Guardar etiqueta actual en el catalogo".';
  $('pErr').textContent = '';
  paintProdClave();
  $('prodModal').classList.add('show');
  setTimeout(() => $('pClave').focus(), 30);
}

const closeProdModal = () => $('prodModal').classList.remove('show');

async function createProduct() {
  const clave = $('pClave').value;
  const r = checkClave(clave);
  if (!r.ok) {
    $('pErr').textContent = r.msg || `Cargá la clave de ${CLAVE_LEN} caracteres.`;
    return $('pClave').focus();
  }
  const producto = $('pProducto').value.trim();
  const cantidad = $('pCantidad').value.trim();
  if (!producto || !cantidad) { $('pErr').textContent = 'Cargá el producto y la cantidad.'; return; }

  const l = currentLabel();
  const entry = {
    codigo: r.codigo, clave, tipo: 'CODE128',
    producto, cantidad, unidad: $('pUnidad').value,
    ingredientes: $('pIngredientes').value, infoExtra: $('pInfoExtra').value.trim(),
    nutri: cloneNutri(nutriVisible(l) ? l.nutri : null)
  };
  const ok = await cloudTask('Creando producto…', async () => {
    // Otra persona pudo haber creado la misma clave desde que se cargo el catalogo.
    const { rows } = await gReadTab('Catalogo');
    const otro = rows.find((x) => String(x.codigo).trim() === entry.codigo);
    if (otro) throw new Error(`Otra persona acaba de crear "${otro.producto}" con esa clave. Elegí otra.`);
    await gUpsert('Catalogo', 'codigo', catToRow(entry));
    return true;
  });
  if (!ok) return;
  cloud.catalog.push(entry);
  refreshCatalogUI();
  closeProdModal();
  $('catSearch').value = entry.codigo;
  applyCatalog(entry);
  toast(`Producto "${producto}" creado · codigo ${entry.codigo}`);
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
  const id = reg.imagen;
  try {
    const url = URL.createObjectURL(await gImageBlob(id));
    imgCache.set(id, url);
    // Mientras bajaba, el usuario pudo haber pasado a otra etiqueta.
    if (currentLote() === lote) img.src = url;
  } catch (err) {
    if (currentLote() === lote) info.textContent += ' · no se pudo cargar la imagen: ' + err.message;
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

/* Devuelve el id de la carpeta de imagenes del equipo. Con imagesFolderId en
   config.js es siempre esa. Si no, se crea la primera vez y su id queda en
   la pestana Ajustes para que todos suban a la misma; antes de crearla se
   relee Ajustes: otra persona pudo haberla creado despues de la ultima
   carga. */
async function imageFolder() {
  const fija = String(gConfig().imagesFolderId || '').trim();
  if (fija) {
    if (!await gFolderOk(fija)) {
      throw new Error('No se puede abrir la carpeta de imagenes del equipo en Drive. Pedile a quien la creo que la comparta con tu cuenta como Editor.');
    }
    /* Se anota en Ajustes para que el script de permisos (usuarios.gs), que
       no lee config.js, sepa que carpeta compartir con el equipo. */
    if (cloud.ajustes.carpetaImagenes !== fija) {
      await gUpsert('Ajustes', 'clave', { clave: 'carpetaImagenes', valor: fija });
      cloud.ajustes.carpetaImagenes = fija;
    }
    return fija;
  }

  const guardada = async () => {
    const { rows } = await gReadTab('Ajustes');
    const r = rows.find((x) => String(x.clave).trim() === 'carpetaImagenes');
    return r ? String(r.valor || '').trim() : '';
  };
  let id = cloud.ajustes.carpetaImagenes || await guardada();
  if (id) {
    if (await gFolderOk(id)) return (cloud.ajustes.carpetaImagenes = id);
    throw new Error('No se puede abrir la carpeta de imagenes del equipo en Drive. Pedile a un administrador que la comparta con tu cuenta (o que revise la clave carpetaImagenes en la pestana Ajustes).');
  }

  /* Al lado de la planilla, asi quedan juntas en Drive. Si en esa carpeta
     no se puede crear nada (es de otra persona y solo se compartio la
     planilla), va a la raiz de "Mi unidad". Si tampoco se puede ahi, el
     problema no es la carpeta y se muestra el error de la raiz. */
  const padre = await gParentOf(G.sheet.id);
  let folder;
  try {
    folder = await gCreateFolder(FOLDER_NAME, padre);
  } catch (err) {
    if (!padre) throw err;
    folder = await gCreateFolder(FOLDER_NAME, null);
  }
  await gUpsert('Ajustes', 'clave', { clave: 'carpetaImagenes', valor: folder.id });
  cloud.ajustes.carpetaImagenes = folder.id;
  /* Se comparte ya con los usuarios activos, para no depender de que corra
     el script de permisos. Un mail que Google rechace no frena la subida. */
  const yo = G.email.toLowerCase();
  for (const u of cloud.usuarios) {
    const email = String(u.email).trim();
    if (email.toLowerCase() !== yo) await gShare(folder.id, email).catch(() => {});
  }
  return folder.id;
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
  if (!file.type.startsWith('image/')) return toast('El archivo no es una imagen.', true);
  if (file.size > IMG_MAX) return toast('La imagen es demasiado grande (max 20 MB).', true);

  // Se copia el id ahora: writeLote actualiza el registro en el lugar.
  const anterior = (findLote(lote) || {}).imagen;
  const ok = await cloudTask('Subiendo imagen a Drive…', async () => {
    const folder = await imageFolder();
    const subida = await gUploadImage(file, `Lote ${lote} - ${file.name}`, folder);
    imgCache.set(subida.id, URL.createObjectURL(file));
    await writeLote({ imagen: subida.id, archivo: file.name, enlace: subida.webViewLink || '' });
    // La anterior se manda a la papelera despues: si algo falla, el lote no
    // queda sin ninguna.
    if (anterior) await gTrash(anterior);
    return true;
  });
  if (!ok) return;
  refreshLoteUI();
  toast(`Imagen del lote ${lote} guardada en Drive`);
}

async function removeLoteImage() {
  if (!requireCloud()) return;
  const reg = findLote(currentLote());
  if (!reg || !reg.imagen) return;
  if (!confirm(`¿Quitar la imagen del lote ${reg.lote}? El archivo va a la papelera de Drive.`)) return;
  const id = reg.imagen;
  let enPapelera = false;
  const ok = await cloudTask('Quitando imagen…', async () => {
    await writeLote({ imagen: '', archivo: '', enlace: '' });
    enPapelera = await gTrash(id);
    return true;
  });
  if (!ok) return;
  refreshLoteUI();
  toast(enPapelera
    ? `Imagen quitada del lote ${reg.lote}`
    : `Imagen desvinculada del lote ${reg.lote}. El archivo lo subio otra persona: sigue en la carpeta de Drive.`);
}

/* Abre la imagen en Drive, en otra pestana. Si no hay enlace (fila cargada
   a mano), abre la copia que ya bajo la app. */
function openLoteImage() {
  const reg = findLote(currentLote());
  const url = (reg && reg.enlace) || $('loteImg').src;
  if (url) window.open(url, '_blank', 'noopener');
}
/* ---------------- Eventos ---------------- */

function bindCloudEvents() {
  $('btnGoogle').addEventListener('click', onGoogleClick);

  $('gUse').addEventListener('click', useSheetFromInput);
  $('gSheetInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') useSheetFromInput(); });
  $('gCreate').addEventListener('click', createSheet);
  $('gReload').addEventListener('click', async () => {
    if (cloud.busy) return toast('Esperá a que termine la operacion anterior.', true);
    toast('Actualizando…');
    const ok = await cloudRefresh();
    if (!G.token) closeGModal();
    else if (ok) toast('Datos actualizados desde la planilla');
  });
  $('gLogout').addEventListener('click', () => {
    gSignOut();
    cloudClear();
    syncCloudUI('');
    closeGModal();
    toast('Desconectado de Google');
  });
  $('gRetry').addEventListener('click', async () => {
    const ok = await cloudTask('Abriendo la planilla del equipo…', async () => { await cloudOpen(savedSheetId()); return true; });
    if (ok) { closeGModal(); toast(`Conectado a "${G.sheet.title}"`); }
    else if (G.token) openGModal();          // muestra el motivo actualizado
    else closeGModal();                      // cuenta rechazada: queda la pantalla de ingreso
  });
  $('gClose').addEventListener('click', closeGModal);
  $('gModal').addEventListener('click', (e) => { if (e.target === $('gModal')) closeGModal(); });

  /* --- catalogo --- */
  const aplicarBusqueda = () => {
    const c = findCatalog($('catSearch').value);
    if (!c) return toast('Ese codigo no esta en el catalogo.', true);
    applyCatalog(c);
  };
  $('btnCatApply').addEventListener('click', () => { closeCatResults(); aplicarBusqueda(); });
  $('btnCatSave').addEventListener('click', saveToCatalog);

  /* Buscador: la lista se abre al tocar el campo y se filtra al escribir.
     Flechas para moverse; Enter elige el resaltado (o el unico resultado, o
     lo escrito si es un codigo, clave o nombre exacto). */
  const cs = $('catSearch');
  cs.addEventListener('focus', () => { catActive = -1; renderCatResults(); });
  cs.addEventListener('input', () => {
    catActive = -1;
    const exacto = cloud.catalog.find((x) => x.codigo === cs.value.trim());
    if (exacto) return pickCatResult(exacto);   // pegaron o escribieron el codigo completo
    renderCatResults();
  });
  cs.addEventListener('blur', () => setTimeout(closeCatResults, 120));
  cs.addEventListener('keydown', (e) => {
    const abierta = !$('catResults').hidden;
    const n = Math.min(catShown.length, CAT_MAX);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierta) return renderCatResults();
      if (!n) return;
      catActive = e.key === 'ArrowDown' ? (catActive + 1) % n : (catActive - 1 + n) % n;
      renderCatResults();
      const on = $('catResults').querySelector('.cat-item.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (abierta && catActive >= 0 && catShown[catActive]) return pickCatResult(catShown[catActive]);
      if (abierta && catShown.length === 1) return pickCatResult(catShown[0]);
      closeCatResults();
      aplicarBusqueda();
    } else if (e.key === 'Escape') {
      closeCatResults();
    }
  });
  $('btnCatDelete').addEventListener('click', deleteFromCatalog);

  /* --- nuevo producto --- */
  $('btnProdNew').addEventListener('click', openProdModal);
  $('pClave').addEventListener('input', paintProdClave);
  $('pOk').addEventListener('click', createProduct);
  $('pCancel').addEventListener('click', closeProdModal);
  $('prodModal').addEventListener('click', (e) => { if (e.target === $('prodModal')) closeProdModal(); });
  $('prodModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProdModal();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') createProduct();
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
    cloudRefresh();
  });

  $('gateLogin').addEventListener('click', onGoogleClick);

  /* Un cambio del producto todavia sin guardar (se guarda al salir del
     campo): el navegador pregunta antes de cerrar la pagina. */
  window.addEventListener('beforeunload', (e) => {
    if (!syncPending) return;
    syncProduct();
    e.preventDefault();
    e.returnValue = '';
  });
}

async function cloudInit() {
  bindCloudEvents();
  syncCloudUI('');
  refreshCatalogUI();
  refreshLoteUI();
  if (!gRestoreSession()) return;

  const id = savedSheetId();
  let msg = '';
  if (id) {
    syncCloudUI('Conectando…', true);
    try { await cloudOpen(id); } catch (err) { msg = err.message || String(err); }
  }
  syncCloudUI(msg);
}
