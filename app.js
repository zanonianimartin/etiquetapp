/* ============================================================
   EtiquetApp — logica de la aplicacion
   ============================================================ */

const DEFAULT_LOGO = 'assets/logo-xilo.png';
const MM_PX = 96 / 25.4;           // 1 mm en px @96dpi
const A4 = { w: 210, h: 297 };
const MAX_QTY = 2000;

const PRESETS = [
  { c: 1, r: 1 }, { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 2, r: 3 },
  { c: 2, r: 4 }, { c: 2, r: 5 }, { c: 2, r: 8 }, { c: 3, r: 4 },
  { c: 3, r: 7 }, { c: 3, r: 8 }, { c: 4, r: 4 }, { c: 4, r: 6 },
  { c: 4, r: 10 }, { c: 5, r: 8 }
];

/* Hojas comerciales: a diferencia de PRESETS (que solo fija la grilla y deja
   el tamano de etiqueta como resultado de los margenes que ya haya cargados),
   estas fijan tambien margenes y separacion para que el tamano de etiqueta
   calculado calce con el troquelado real de la hoja.
   Los margenes asumen etiquetas sin separacion entre si (troquel a tope) y
   sobrante repartido simetrico; si en la impresora real queda corrido un poco,
   ajustar a mano en "Margenes y separacion" (variacion tipica entre lotes de
   impresion, no de la app). */
const SHEET_TEMPLATES = [
  {
    id: 'rotola-a43-8',
    name: 'Rotola A4 3/8 — 8 etiquetas (99.0 x 67.7 mm)',
    cols: 2, rows: 4,
    mTop: 13.1, mBottom: 13.1, mLeft: 6, mRight: 6,
    gapX: 0, gapY: 0
  },
  {
    /* Mismo troquel fisico (2 columnas x 4 filas) partido al medio: como el
       gapX entre las 2 columnas fisicas ya es 0 (etiquetas a tope), duplicar
       las columnas a 4 reparte el mismo ancho util en mitades de 49.5mm y el
       borde entre ellas cae justo en el limite de cada etiqueta troquelada. */
    id: 'rotola-a43-8-x2',
    name: 'Rotola A4 3/8 — 16 etiquetas (2 por casillero, 49.5 x 67.7 mm)',
    cols: 4, rows: 4,
    mTop: 13.1, mBottom: 13.1, mLeft: 6, mRight: 6,
    gapX: 0, gapY: 0
  }
];

/* Solo se ofrece "Dos columnas". El render de los otros disenos (a-e) sigue
   en paintLabel y styles.css, pero ya no se puede elegir: una configuracion,
   plantilla o proyecto que traiga otro diseno se abre con este. */
const DESIGN = 'f';
const DESIGNS = [
  { id: 'f', name: 'Dos columnas' }
];

/* Disenos donde el logo va de fondo atenuado en vez de ocupar una ranura
   propia. "Dos columnas" hereda ese fondo de "Marca de agua". */
const isWatermark = (t) => t === 'e' || t === 'f';

const BARCODE_RULES = {
  EAN13: { digits: true, len: [12, 13] },
  EAN8:  { digits: true, len: [7, 8] },
  UPC:   { digits: true, len: [11, 12] },
  ITF14: { digits: true, len: [13, 14] },
  CODE39:  { digits: false, len: null },
  CODE128: { digits: false, len: null }
};

/* Campos obligatorios para poder imprimir.
   `codigo` no esta: el codigo de barras es opcional, pero si se carga igual
   se valida el formato (ver labelProblems). */
const REQUIRED = [
  ['producto', 'producto'],
  ['cantidad', 'cantidad'],
  ['unidad', 'unidad'],
  ['lote', 'lote'],
  ['venc', 'vencimiento']
];

/* ---------------- Estado ---------------- */

const emptyNutri = () => ({
  on: false,
  titulo: 'INFORMACION NUTRICIONAL',
  porcion: '100 g',
  items: [],                      // { nombre, valor, unidad, vd }
  pie: '',                        // nota al pie, dentro del recuadro
  nota: ''                        // nota suelta, debajo del recuadro
});

/* Rotulo estandar (Mercosur / CAA): los nombres y unidades habituales,
   con los valores en blanco para completar. */
const NUTRI_PRESET = [
  { nombre: 'Valor energetico', valor: '', unidad: 'kcal', vd: '' },
  { nombre: 'Carbohidratos', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Proteinas', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Grasas totales', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Grasas saturadas', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Grasas trans', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Fibra alimentaria', valor: '', unidad: 'g', vd: '' },
  { nombre: 'Sodio', valor: '', unidad: 'mg', vd: '' }
];

/* Frase de la declaracion nutricional simplificada. Se inserta como punto de
   partida: queda completarla con el valor energetico y/o los nutrientes que
   correspondan, que cambian en cada producto. */
const NUTRI_PIE = 'No aporta cantidades significativas de ';

/* `ingredientes` e `infoExtra` son opcionales: no entran en REQUIRED, asi que
   una etiqueta sin ellos sigue siendo imprimible. Al venir de emptyLabel(),
   los proyectos guardados antes de que existieran se abren con ambos vacios. */
const emptyLabel = () => ({
  producto: '', cantidad: '', unidad: 'gr', lote: '', venc: '', codigo: '',
  ingredientes: '', infoExtra: '',
  nutri: emptyNutri()
});

/* La tabla es un objeto anidado: sin copia profunda, dos etiquetas
   compartirian la misma tabla y editar una cambiaria la otra. */
const cloneNutri = (n) => ({
  ...emptyNutri(),
  ...(n || {}),
  items: ((n && n.items) || []).map((i) => ({ ...i }))
});
const cloneLabel = (l) => ({ ...emptyLabel(), ...l, nutri: cloneNutri(l && l.nutri) });

/* Configuracion por defecto de todas las etiquetas: hoja Rotola A4 3/8 de
   16 etiquetas (2 por casillero, 49.5 x 67.7 mm), diseno Dos columnas. */
const DEFAULT_CFG = {
  cols: 4, rows: 4,                       // = SHEET_TEMPLATES 'rotola-a43-8-x2'
  mTop: 13.1, mBottom: 13.1, mLeft: 6, mRight: 6,
  gapX: 0, gapY: 0,
  template: DESIGN,
  fontScale: 130,
  logoScale: 80,
  logoX: 50,              // 0 = izquierda, 100 = derecha
  logoY: 57,              // 0 = arriba, 100 = abajo
  wmOpacity: 14,          // intensidad del logo de fondo
  showLogo: true,
  showBorder: true,
  showGuides: false,
  barcodeType: 'CODE128',
  barcodeText: true,
  barcodeH: 80
};

/* Sube cuando cambian los valores por defecto: una configuracion guardada en
   el navegador con otra version se descarta una vez, asi todos arrancan con
   la nueva aunque ya hubieran usado la app. */
const CFG_VERSION = 2;

let state = {
  cfg: { ...DEFAULT_CFG },
  logo: DEFAULT_LOGO,
  logoAspect: 3,      // ancho/alto real del archivo; se mide al cargarlo
  items: [],          // datos cargados (nunca se recortan: bajar la cantidad no borra)
  qty: 8,             // cuantas etiquetas se imprimen
  sel: 0,             // indice dentro de items
  applyAll: true,
  templates: [],
  zoom: 0.7
};

const $ = (id) => document.getElementById(id);
const perPage = () => state.cfg.cols * state.cfg.rows;
const pageCount = () => Math.max(1, Math.ceil(state.qty / perPage()));
const runItems = () => state.items.slice(0, state.qty);
const currentLabel = () => state.items[state.sel] || emptyLabel();

/* ============================================================
   Cantidad de etiquetas
   ============================================================ */

/* Al ampliar la tirada las etiquetas nuevas se completan solas copiando
   la etiqueta de referencia. Al reducirla los datos quedan guardados,
   asi que volver a subir la cantidad los recupera. */
function setQty(n, ref) {
  state.qty = Math.max(1, Math.min(MAX_QTY, Math.round(n) || 1));
  const base = ref || state.items[state.sel] || state.items[state.items.length - 1] || emptyLabel();
  while (state.items.length < state.qty) state.items.push(cloneLabel(base));
  if (state.sel >= state.qty) state.sel = state.qty - 1;
}

/* ============================================================
   Geometria
   ============================================================ */

function metrics() {
  const c = state.cfg;
  const lw = (A4.w - c.mLeft - c.mRight - c.gapX * (c.cols - 1)) / c.cols;
  const lh = (A4.h - c.mTop - c.mBottom - c.gapY * (c.rows - 1)) / c.rows;
  const base = Math.min(lh * 0.085, lw * 0.052);
  const fs = Math.max(1.3, Math.min(base, 7)) * (c.fontScale / 100);
  const bch = Math.max(4, lh * 0.22 * (c.barcodeH / 100));
  return { lw, lh, fs, bch };
}

/* Caja del logo en mm dentro de la etiqueta.
   Se calcula con la proporcion real del archivo, asi la caja calza justa
   con la imagen y el espacio que se le reserva al contenido es exacto. */
function logoBox(m) {
  const c = state.cfg;
  const marca = isWatermark(c.template);
  const pad = (marca || c.template === 'c') ? 0 : m.fs * 0.55;
  /* Las coordenadas absolutas se miden contra la caja de padding, que ya
     excluye el borde: si no se descuenta, con padding 0 el logo se pasa
     del borde justo en los extremos del slider. */
  const borde = c.showBorder ? 0.25 : 0;
  const innerW = Math.max(1, m.lw - 2 * borde - 2 * pad);
  const innerH = Math.max(1, m.lh - 2 * borde - 2 * pad);
  const aspect = state.logoAspect > 0 ? state.logoAspect : 3;

  // La marca de agua se mide contra la etiqueta; el resto, contra la fuente.
  let h = marca
    ? innerH * 0.5 * (c.logoScale / 100)
    : m.fs * (c.template === 'd' ? 5.2 : 2.6) * (c.logoScale / 100);
  let w = h * aspect;

  const maxW = innerW * (marca ? 0.92 : c.template === 'd' ? 0.98 : 0.8);
  if (w > maxW) { w = maxW; h = w / aspect; }
  const maxH = innerH * (marca ? 0.85 : 0.55);
  if (h > maxH) { h = maxH; w = h * aspect; }

  const left = pad + (innerW - w) * (c.logoX / 100);
  const top = pad + (innerH - h) * (c.logoY / 100);

  /* El contenido se corre para no quedar debajo del logo: si el logo esta
     en la mitad de arriba libera por arriba, si no, por abajo.
     La marca de agua es fondo, asi que no reserva nada. */
  const gap = m.fs * 0.35;
  const relTop = top - pad;
  const padTop = (!marca && c.logoY <= 50) ? relTop + h + gap : 0;
  const padBottom = (!marca && c.logoY > 50) ? (innerH - relTop) + gap : 0;

  return { w, h, left, top, padTop, padBottom };
}

/* ============================================================
   Codigo de barras
   ============================================================ */

/* Digito verificador modulo 10 (EAN-8/13, UPC-A, ITF-14). */
function checkDigit(payload) {
  let sum = 0, w = 3;
  for (let i = payload.length - 1; i >= 0; i--) {
    sum += Number(payload[i]) * w;
    w = w === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function validateCode(value, type) {
  const v = (value || '').trim();
  if (!v) return { ok: false, msg: '' };
  const rule = BARCODE_RULES[type];
  if (!rule) return { ok: true, msg: '' };

  if (rule.digits && !/^\d+$/.test(v)) return { ok: false, msg: `${type} admite solo digitos.` };
  if (rule.len && !rule.len.includes(v.length)) {
    return { ok: false, msg: `${type} requiere ${rule.len.join(' o ')} digitos (tiene ${v.length}).` };
  }
  if (rule.len) {
    const full = rule.len[rule.len.length - 1];
    if (v.length === full) {
      const esperado = checkDigit(v.slice(0, -1));
      if (Number(v[v.length - 1]) !== esperado) {
        return {
          ok: false,
          msg: `Digito verificador incorrecto: deberia ser ${esperado} (${v.slice(0, -1)}${esperado}).`
        };
      }
    }
  }
  return { ok: true, msg: '' };
}

/* Codigo de barras de un producto a partir de su clave de 5 caracteres.
   Es la misma cuenta que la funcion TEXTO_A_DECIMAL de Apps Script de la
   planilla (cada caracter es un digito en base 256), para que la app y la
   planilla den siempre el mismo numero. Se imprime como CODE128: el ultimo
   digito no es un verificador EAN valido. 5 caracteres dan a lo sumo
   0x7E7E7E7E7E = 543.288.098.430, muy por debajo de 2^53: sin perdida de
   precision con numeros comunes de JavaScript. */
const CLAVE_LEN = 5;

function textoADecimal(texto) {
  const str = String(texto ?? '');
  if (!str) return { ok: false, codigo: '', msg: '' };
  if (!/^[\x20-\x7E]*$/.test(str)) return { ok: false, codigo: '', msg: 'Solo letras sin tilde, numeros y signos comunes (sin ñ ni tildes).' };
  if (str.length > CLAVE_LEN) return { ok: false, codigo: '', msg: `Maximo ${CLAVE_LEN} caracteres.` };
  let n = 0;
  for (let i = 0; i < str.length; i++) n = n * 256 + str.charCodeAt(i);
  return { ok: true, codigo: String(n).padStart(13, '0'), msg: '' };
}

/* Cache: en una tirada casi todas las etiquetas comparten el mismo codigo. */
const bcCache = new Map();

function makeBarcode(value, type, showText) {
  const key = `${type}|${showText ? 1 : 0}|${value}`;
  if (bcCache.has(key)) {
    const hit = bcCache.get(key);
    return hit ? hit.cloneNode(true) : null;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lb-bc');
  let built = null;
  try {
    JsBarcode(svg, String(value).trim(), {
      format: type,
      displayValue: !!showText,
      height: 60, width: 2, margin: 0, marginTop: 2,
      fontSize: 18, textMargin: 2, font: 'Arial',
      valid: (v) => { if (!v) throw new Error('invalid'); }
    });
    // JsBarcode no agrega viewBox: lo derivamos para poder escalar el SVG.
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w && h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.removeAttribute('style');
      built = svg;
    }
  } catch { built = null; }

  if (bcCache.size > 200) bcCache.clear();
  bcCache.set(key, built);
  return built ? built.cloneNode(true) : null;
}

/* ============================================================
   Validacion de la tirada
   ============================================================ */

/* "Sin datos" = ningun campo cargado por el usuario.
   `unidad` no cuenta: siempre viene con un valor por defecto. */
const isBlankLabel = (l) =>
  REQUIRED.every(([k]) => k === 'unidad' || !String(l[k] || '').trim());

/* Filas de la tabla que se van a imprimir (las totalmente vacias se ignoran). */
const nutriRows = (n) =>
  ((n && n.items) || []).filter((i) =>
    String(i.nombre || '').trim() || String(i.valor || '').trim());

const nutriVisible = (l) => !!(l.nutri && l.nutri.on && nutriRows(l.nutri).length);

function labelProblems(l) {
  const faltan = REQUIRED.filter(([k]) => !String(l[k] || '').trim()).map(([, n]) => n);
  const v = validateCode(l.codigo, state.cfg.barcodeType);
  if (l.codigo && !v.ok) faltan.push('codigo valido');

  // La tabla es opcional, pero si esta activada no puede quedar a medio cargar.
  if (l.nutri && l.nutri.on) {
    const filas = nutriRows(l.nutri);
    if (!filas.length) faltan.push('elementos de la tabla nutricional');
    else if (filas.some((i) => !String(i.nombre || '').trim() || !String(i.valor || '').trim())) {
      faltan.push('nombre o valor en la tabla nutricional');
    }
  }
  return faltan;
}

function validateRun() {
  const run = runItems();
  if (!run.length) return { ok: false, msg: 'No hay etiquetas para imprimir.', bad: [], todo: [] };

  const malas = [], pendientes = [];
  run.forEach((l, i) => {
    if (!labelProblems(l).length) return;
    (isBlankLabel(l) ? pendientes : malas).push(i);
  });

  if (!malas.length && !pendientes.length) {
    return { ok: true, msg: `Listo para imprimir · ${run.length} etiquetas`, bad: [], todo: [] };
  }
  // Se informa primero lo que esta a medio cargar; despues lo que falta cargar.
  const foco = malas.length ? malas[0] : pendientes[0];
  const falta = labelProblems(run[foco]).join(', ');
  const total = malas.length + pendientes.length;
  const extra = total > 1 ? ` (y ${total - 1} mas)` : '';
  return {
    ok: false,
    msg: `Etiqueta ${foco + 1}: falta ${falta}${extra}`,
    bad: malas,
    todo: pendientes
  };
}

let badSet = new Set();
let todoSet = new Set();

function refreshPrintState() {
  const r = validateRun();
  badSet = new Set(r.bad || []);
  todoSet = new Set(r.todo || []);
  const pill = $('printStatus');
  pill.textContent = r.msg;
  pill.className = 'status ' + (r.ok ? 'ok' : 'bad');
  $('btnPrint').disabled = !r.ok;
  $('btnPdf').disabled = !r.ok;
  $('btnPrint').title = r.ok ? 'Imprimir' : r.msg;
  $('btnPdf').title = r.ok ? 'Exportar PDF' : r.msg;
  return r;
}

/* ============================================================
   Render de una etiqueta
   ============================================================ */

function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

function logoNode() {
  const img = el('img', 'lb-logo');
  img.src = state.logo;
  img.alt = '';
  return img;
}

function qtyNode(l) {
  if (!l.cantidad) return null;
  const span = el('span');
  span.append(document.createTextNode(l.cantidad));
  span.append(el('span', 'u', l.unidad || ''));
  return span;
}

function metaNode(l) {
  const m = el('div', 'lb-meta');
  if (l.lote) {
    const s = el('span');
    s.appendChild(el('b', null, 'Lote: '));
    s.append(document.createTextNode(l.lote));
    m.appendChild(s);
  }
  if (l.venc) {
    const s = el('span');
    s.appendChild(el('b', null, 'Vto: '));
    s.append(document.createTextNode(l.venc));
    m.appendChild(s);
  }
  return m.childNodes.length ? m : null;
}

/* Tabla nutricional compacta. Devuelve null si no corresponde mostrarla. */
function nutriNode(l) {
  if (!nutriVisible(l)) return null;
  const n = l.nutri;
  const filas = nutriRows(n);
  const conVd = filas.some((i) => String(i.vd || '').trim());

  const box = el('div', 'lb-nutri' + (conVd ? '' : ' sin-vd'));
  if (n.titulo) box.appendChild(el('div', 'nt-tit', n.titulo));
  if (n.porcion) box.appendChild(el('div', 'nt-por', `Porcion ${n.porcion}`));

  const rows = el('div', 'nt-rows');
  // Cabecera de columnas del rotulo.
  rows.appendChild(el('span', 'hd n', ''));
  rows.appendChild(el('span', 'hd v', 'Cantidad por porcion'));
  if (conVd) rows.appendChild(el('span', 'hd vd', '%VD'));

  filas.forEach((i) => {
    rows.appendChild(el('span', 'n', i.nombre || ''));
    const val = [i.valor, i.unidad].filter((x) => String(x || '').trim()).join(' ');
    rows.appendChild(el('span', 'v', val));
    if (conVd) rows.appendChild(el('span', 'vd', String(i.vd || '').trim() ? i.vd + '%' : ''));
  });
  box.appendChild(rows);

  // Pie: va dentro del recuadro, debajo de las filas.
  const pie = String(n.pie || '').trim();
  if (pie) box.appendChild(el('div', 'nt-pie', pie));

  /* La nota va afuera, debajo del recuadro. Se devuelve un fragmento con los
     dos nodos —y no un wrapper— para que `.lb-nutri` siga siendo hijo directo
     del contenedor: los cinco disenos la posicionan por ese selector. */
  const nota = String(n.nota || '').trim();
  if (!nota) return box;

  const frag = document.createDocumentFragment();
  frag.appendChild(box);
  frag.appendChild(el('div', 'nt-nota', nota));
  return frag;
}

/* Lista de ingredientes: texto libre en un recuadro, al lado de la tabla
   nutricional. Devuelve null si el campo esta vacio. */
function ingredientesNode(l) {
  const txt = String(l.ingredientes || '').trim();
  if (!txt) return null;
  const box = el('div', 'lb-ingr');
  box.appendChild(el('div', 'ig-tit', 'INGREDIENTES'));
  box.appendChild(el('div', 'ig-txt', txt));
  return box;
}

/* Codigo de barras con la linea de informacion adicional encima.
   El grupo es el que lleva la posicion (margin-top:auto, ancho) para que el
   texto viaje pegado a las barras en vez de quedar empujado hacia arriba. */
function barcodeBlock(l) {
  const info = String(l.infoExtra || '').trim();
  if (!l.codigo && !info) return null;    // opcional: sin codigo ni info, no ocupa lugar

  const group = el('div', 'lb-bcgroup');

  if (info) group.appendChild(el('div', 'lb-bcinfo', info));

  if (l.codigo) {
    const wrap = el('div', 'lb-bcwrap');
    const svg = makeBarcode(l.codigo, state.cfg.barcodeType, state.cfg.barcodeText);
    if (svg) wrap.appendChild(svg);
    else wrap.appendChild(el('span', 'lb-extra bc-bad', l.codigo));
    group.appendChild(wrap);
  }
  return group;
}

function paintLabel(node, l, flatIdx) {
  node.innerHTML = '';
  const c = state.cfg;

  if (!l) {                                  // hueco fuera de la tirada
    node.className = 'label blank' + (c.showBorder ? ' bordered' : '');
    node.appendChild(el('span', 'ph', '+'));
    return;
  }

  node.className = `label tpl-${c.template}` +
    (nutriVisible(l) ? ' has-nutri' : '') +
    (c.showBorder ? ' bordered' : '') +
    (badSet.has(flatIdx) ? ' bad' : todoSet.has(flatIdx) ? ' todo' : '') +
    (flatIdx === state.sel ? ' sel' : '');

  if (todoSet.has(flatIdx)) {                // sin ningun dato cargado todavia
    node.appendChild(el('span', 'ph', 'sin datos'));
    return;
  }

  const showLogo = c.showLogo && state.logo;
  const content = el('div', 'lb-content');

  /* El logo va en su propia ranura; donde se ubica lo decide el CSS
     segun `pos-*`. En "Marca de agua" no hay ranura: el logo es el fondo. */
  if (showLogo && !isWatermark(c.template)) {
    const slot = el('div', 'lb-slot');
    slot.appendChild(logoNode());
    node.appendChild(slot);
  }

  if (c.template === 'a') {
    if (l.producto) content.appendChild(el('div', 'lb-prod', l.producto));
    const q = qtyNode(l);
    if (q) { const d = el('div', 'lb-qty'); d.appendChild(q); content.appendChild(d); }
    const m = metaNode(l);
    if (m) content.appendChild(m);
    const nt = nutriNode(l);
    if (nt) content.appendChild(nt);
    const bcA = barcodeBlock(l);
    if (bcA) content.appendChild(bcA);

  } else if (c.template === 'b') {
    const head = el('div', 'lb-head');
    head.appendChild(el('div', 'lb-prod', l.producto || ''));
    content.appendChild(head);

    const body = el('div', 'lb-body');
    const left = el('div', 'lb-left');
    const q = qtyNode(l);
    if (q) { const d = el('div', 'lb-qty'); d.appendChild(q); left.appendChild(d); }
    const m = metaNode(l);
    if (m) left.appendChild(m);
    body.appendChild(left);
    const bcB = barcodeBlock(l);
    if (bcB) body.appendChild(bcB);
    content.appendChild(body);
    const ntB = nutriNode(l);
    if (ntB) content.appendChild(ntB);

  } else if (c.template === 'c') {
    const top = el('div', 'lb-top');
    const q = qtyNode(l);
    if (q) { const box = el('div', 'lb-qtybox'); box.appendChild(q); top.appendChild(box); }
    content.appendChild(top);

    if (l.producto) content.appendChild(el('div', 'lb-prod', l.producto));
    const m = metaNode(l);
    if (m) content.appendChild(m);
    const ntC = nutriNode(l);
    if (ntC) content.appendChild(ntC);
    const bcC = barcodeBlock(l);
    if (bcC) content.appendChild(bcC);

  } else if (c.template === 'd') {
    const head = el('div', 'lb-head');
    if (l.producto) head.appendChild(el('div', 'lb-prod', l.producto));
    const q = qtyNode(l);
    if (q) { const d = el('div', 'lb-qty'); d.appendChild(q); head.appendChild(d); }
    if (head.childNodes.length) content.appendChild(head);
    const m = metaNode(l);
    if (m) content.appendChild(m);
    const ntD = nutriNode(l);
    if (ntD) content.appendChild(ntD);
    const bcD = barcodeBlock(l);
    if (bcD) content.appendChild(bcD);

  } else if (c.template === 'f') {
    /* Dos columnas: mismo fondo que "Marca de agua", pero la tabla
       nutricional y los ingredientes se reparten el ancho al 50%. */
    if (showLogo) {
      const wm = el('img', 'lb-wm');
      wm.src = state.logo;
      wm.alt = '';
      node.appendChild(wm);
    }
    content.classList.add('lb-fg');
    if (l.producto) content.appendChild(el('div', 'lb-prod', l.producto));
    const q = qtyNode(l);
    if (q) { const d = el('div', 'lb-qty'); d.appendChild(q); content.appendChild(d); }
    const m = metaNode(l);
    if (m) content.appendChild(m);

    /* Las dos columnas se arman solo si hay algo que poner en alguna: sin
       datos, la fila no ocupa lugar y el codigo sube como en el resto. */
    const ntF = nutriNode(l);
    const igF = ingredientesNode(l);
    if (ntF || igF) {
      const cols = el('div', 'lb-cols');
      /* Solo se agrega la columna que tiene contenido. Si falta una, la otra
         crece y toma el ancho completo, en vez de dejar media etiqueta vacia. */
      if (ntF) { const izq = el('div', 'lb-col'); izq.appendChild(ntF); cols.appendChild(izq); }
      if (igF) { const der = el('div', 'lb-col'); der.appendChild(igF); cols.appendChild(der); }
      content.appendChild(cols);
    }
    const bcF = barcodeBlock(l);
    if (bcF) content.appendChild(bcF);

  } else {
    // Marca de agua: el logo va de fondo, atenuado, y los datos encima.
    if (showLogo) {
      const wm = el('img', 'lb-wm');
      wm.src = state.logo;
      wm.alt = '';
      node.appendChild(wm);
    }
    content.classList.add('lb-fg');
    if (l.producto) content.appendChild(el('div', 'lb-prod', l.producto));
    const q = qtyNode(l);
    if (q) { const d = el('div', 'lb-qty'); d.appendChild(q); content.appendChild(d); }
    const m = metaNode(l);
    if (m) content.appendChild(m);
    const ntE = nutriNode(l);
    if (ntE) content.appendChild(ntE);
    const bcE = barcodeBlock(l);
    if (bcE) content.appendChild(bcE);
  }

  node.appendChild(content);
}

/* ============================================================
   Render de hojas
   ============================================================ */

function renderSheets() {
  const c = state.cfg;
  const m = metrics();
  const n = perPage();
  const pages = pageCount();
  const cont = $('sheets');

  refreshPrintState();
  cont.innerHTML = '';
  cont.style.zoom = state.zoom;

  for (let pi = 0; pi < pages; pi++) {
    const sheet = el('div', 'sheet');
    sheet.style.setProperty('--fs', m.fs.toFixed(3) + 'mm');
    sheet.style.setProperty('--bch', m.bch.toFixed(3) + 'mm');
    sheet.style.setProperty('--logoScale', c.logoScale / 100);
    sheet.style.setProperty('--wmOpacity', c.wmOpacity / 100);
    const lb = logoBox(m);
    sheet.style.setProperty('--logoL', lb.left.toFixed(3) + 'mm');
    sheet.style.setProperty('--logoT', lb.top.toFixed(3) + 'mm');
    sheet.style.setProperty('--logoW', lb.w.toFixed(3) + 'mm');
    sheet.style.setProperty('--logoH', lb.h.toFixed(3) + 'mm');
    const conLogo = c.showLogo && state.logo;
    sheet.style.setProperty('--ctPadTop', (conLogo ? lb.padTop : 0).toFixed(3) + 'mm');
    sheet.style.setProperty('--ctPadBottom', (conLogo ? lb.padBottom : 0).toFixed(3) + 'mm');

    const grid = el('div', 'sheet-grid');
    grid.style.setProperty('--cols', c.cols);
    grid.style.setProperty('--rows', c.rows);
    grid.style.setProperty('--mt', c.mTop + 'mm');
    grid.style.setProperty('--mb', c.mBottom + 'mm');
    grid.style.setProperty('--ml', c.mLeft + 'mm');
    grid.style.setProperty('--mr', c.mRight + 'mm');
    grid.style.setProperty('--gx', c.gapX + 'mm');
    grid.style.setProperty('--gy', c.gapY + 'mm');

    for (let li = 0; li < n; li++) {
      const flat = pi * n + li;
      const node = el('div');
      paintLabel(node, flat < state.qty ? state.items[flat] : null, flat);
      node.addEventListener('click', () => onLabelClick(flat));
      grid.appendChild(node);
    }

    sheet.appendChild(grid);
    if (c.showGuides) sheet.appendChild(buildGuides(m));
    cont.appendChild(sheet);
  }

  const huecos = pages * n - state.qty;
  $('pageInfo').textContent =
    `${state.qty} etiquetas · ${pages} hoja${pages > 1 ? 's' : ''}` +
    (huecos ? ` · ${huecos} en blanco` : '');
  $('labelSizeHint').textContent =
    `Etiqueta: ${m.lw.toFixed(1)} × ${m.lh.toFixed(1)} mm · ${n} por hoja`;
  $('qtyHint').textContent =
    `${pages} hoja${pages > 1 ? 's' : ''} A4 · ${n} por hoja` +
    (huecos ? ` · quedan ${huecos} espacios en blanco` : ' · hojas completas');

  checkFit();
}

/* Avisa si el contenido no entra en la etiqueta (tipico al activar la tabla
   nutricional en grillas chicas). No bloquea: marca las que se recortan. */
function checkFit() {
  const nodos = document.querySelectorAll('.label:not(.blank):not(.todo)');
  let cortadas = 0;
  nodos.forEach((n) => {
    // La tabla nutricional y los ingredientes recortan por dentro
    // (overflow:hidden propio), asi que no basta con mirar el desborde de la
    // etiqueta: hay que mirar tambien cada uno de esos recuadros.
    const cajas = n.querySelectorAll('.lb-nutri, .lb-ingr');
    const corta = n.scrollHeight > n.clientHeight + 1
               || n.scrollWidth > n.clientWidth + 1
               || Array.from(cajas).some((b) => b.scrollHeight > b.clientHeight + 1);
    n.classList.toggle('clip', !!corta);
    if (corta) cortadas++;
  });

  const w = $('fitWarn');
  if (!cortadas) { w.hidden = true; w.textContent = ''; w.title = ''; return; }
  w.hidden = false;
  w.textContent = `${cortadas} etiqueta${cortadas > 1 ? 's' : ''} con contenido recortado`;
  w.title = 'El contenido no entra. Reduci la escala de texto, usá menos filas/columnas '
          + 'o achicá la tabla nutricional.';
}

function buildGuides(m) {
  const c = state.cfg;
  const g = el('div', 'guides');
  for (let i = 0; i <= c.cols; i++) {
    const x = c.mLeft + i * (m.lw + c.gapX) - (i === c.cols ? c.gapX : 0);
    ['top', 'bottom'].forEach((side) => {
      const t = el('i', 'v');
      t.style.left = x + 'mm';
      t.style[side] = '1mm';
      g.appendChild(t);
    });
  }
  for (let j = 0; j <= c.rows; j++) {
    const y = c.mTop + j * (m.lh + c.gapY) - (j === c.rows ? c.gapY : 0);
    ['left', 'right'].forEach((side) => {
      const t = el('i', 'h');
      t.style.top = y + 'mm';
      t.style[side] = '1mm';
      g.appendChild(t);
    });
  }
  return g;
}

/* Click en una etiqueta: la selecciona; si es un hueco, extiende la tirada. */
function onLabelClick(flat) {
  if (flat >= state.qty) {
    setQty(flat + 1);
    state.sel = flat;
    syncQty();
    renderSheets();
    fillForm();
    return;
  }
  state.sel = flat;
  document.querySelectorAll('.label.sel').forEach((n) => n.classList.remove('sel'));
  const node = document.querySelectorAll('.sheet-grid > *')[flat];
  if (node) node.classList.add('sel');
  fillForm();
}

/* ============================================================
   Formulario
   ============================================================ */

function fillForm() {
  const l = currentLabel();
  $('fProducto').value = l.producto;
  $('fCantidad').value = l.cantidad;
  $('fUnidad').value = l.unidad || 'gr';
  $('fLote').value = l.lote;
  $('fVenc').value = l.venc;
  $('fCodigo').value = l.codigo;
  $('fIngredientes').value = l.ingredientes || '';
  $('fInfoExtra').value = l.infoExtra || '';
  const n = perPage();
  const pg = Math.floor(state.sel / n) + 1;
  const col = (state.sel % n) % state.cfg.cols + 1;
  const row = Math.floor((state.sel % n) / state.cfg.cols) + 1;
  $('selInfo').textContent = `N° ${state.sel + 1} · Hoja ${pg} F${row} C${col}`;
  markMissing();
  syncNutriBadge();
  refreshLoteUI();
  paintCatLink();
}

function readForm() {
  const prev = state.items[state.sel] || emptyLabel();
  const l = {
    producto: $('fProducto').value,
    cantidad: $('fCantidad').value,
    unidad: $('fUnidad').value,
    lote: $('fLote').value,
    venc: $('fVenc').value,
    codigo: $('fCodigo').value,
    ingredientes: $('fIngredientes').value,
    infoExtra: $('fInfoExtra').value,
    nutri: cloneNutri(prev.nutri)     // el formulario no toca la tabla
  };
  if (state.applyAll) state.items = state.items.map(() => cloneLabel(l));
  else state.items[state.sel] = l;
}

/* Marca en rojo los campos vacios y muestra el error del codigo. */
function markMissing() {
  const map = {
    producto: 'fProducto', cantidad: 'fCantidad', unidad: 'fUnidad',
    lote: 'fLote', venc: 'fVenc'
  };
  Object.entries(map).forEach(([k, id]) => {
    const empty = !String($(id).value || '').trim();
    $(id).closest('.field').classList.toggle('missing', empty);
  });
  const r = validateCode($('fCodigo').value, state.cfg.barcodeType);
  $('codigoErr').textContent = r.msg;
  if (r.msg) $('fCodigo').closest('.field').classList.add('missing');
}

/* ============================================================
   Plantillas guardadas
   ============================================================ */

function refreshTemplateList(selectId) {
  const sel = $('tplSaved');
  sel.innerHTML = '<option value="">— ninguna —</option>';
  state.templates.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
  if (selectId) sel.value = selectId;
}

async function saveTemplate(name) {
  const l = currentLabel();
  const tpl = {
    id: 't' + Date.now().toString(36),
    name,
    producto: l.producto,
    cantidad: l.cantidad,
    unidad: l.unidad,
    codigo: l.codigo,
    ingredientes: l.ingredientes,     // describen al producto, no a la tirada
    infoExtra: l.infoExtra,
    nutri: cloneNutri(l.nutri),       // la tabla describe al producto, se guarda
    design: state.cfg.template
    // lote y vencimiento quedan fuera a proposito: cambian en cada tirada
  };
  const dup = state.templates.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  if (dup >= 0) tpl.id = state.templates[dup].id;
  if (!await cloudSaveTemplate(tpl)) return;
  if (dup >= 0) state.templates[dup] = tpl;
  else state.templates.push(tpl);
  refreshTemplateList(tpl.id);
  toast(dup >= 0 ? `Plantilla "${name}" actualizada` : `Plantilla "${name}" guardada`);
}

/* Completa con `patch` la etiqueta seleccionada, o todas si esta tildado
   "Aplicar los cambios a todas las etiquetas". */
function applyPatch(patch) {
  if (state.applyAll) state.items = state.items.map((l) => cloneLabel({ ...l, ...patch }));
  else state.items[state.sel] = cloneLabel({ ...state.items[state.sel], ...patch });
}

function applyTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return toast('Elegi una plantilla de la lista.', true);
  const patch = {
    producto: t.producto, cantidad: t.cantidad, unidad: t.unidad, codigo: t.codigo,
    nutri: cloneNutri(t.nutri)
  };
  /* Las plantillas guardadas antes de que existieran estos campos no traen la
     clave. En ese caso se respeta lo que ya tenga la etiqueta: borrarlo haria
     desaparecer lo que el usuario acaba de escribir. Si la clave esta pero
     vacia, es que se guardo vacia a proposito y si corresponde limpiarla. */
  if ('ingredientes' in t) patch.ingredientes = t.ingredientes || '';
  if ('infoExtra' in t) patch.infoExtra = t.infoExtra || '';
  applyPatch(patch);
  // El diseno que guarde la plantilla se ignora: hay uno solo (DESIGN).

  renderSheets();
  fillForm();
  toast(`Plantilla "${t.name}" aplicada · falta cargar lote y vencimiento`);
}

/* Mide la proporcion real del archivo para que la caja del logo calce
   justa. Un SVG sin tamano intrinseco devuelve 0: ahi se usa 3:1. */
function medirLogo(src, luego) {
  const img = new Image();
  img.onload = () => {
    state.logoAspect = (img.naturalWidth > 0 && img.naturalHeight > 0)
      ? img.naturalWidth / img.naturalHeight : 3;
    if (luego) luego();
  };
  img.onerror = () => { state.logoAspect = 3; if (luego) luego(); };
  img.src = src;
}

/* ============================================================
   Tabla nutricional (modal)
   ============================================================ */

let nutriDraft = emptyNutri();     // se edita una copia; solo se aplica al guardar

function nutriRowNode(item, idx) {
  const row = el('div', 'nutri-row');
  const mk = (key, ph, cls) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = item[key] || '';
    inp.placeholder = ph;
    inp.maxLength = key === 'nombre' ? 40 : 12;
    if (cls) inp.className = cls;
    const obligatorio = key === 'nombre' || key === 'valor';
    const marcar = (v) => inp.classList.toggle('missing', obligatorio && !String(v || '').trim());
    marcar(item[key]);                    // tambien al abrir, no solo al tipear
    inp.addEventListener('input', () => {
      nutriDraft.items[idx][key] = inp.value;
      marcar(inp.value);
    });
    return inp;
  };
  row.appendChild(mk('nombre', 'Carbohidratos'));
  row.appendChild(mk('valor', '12'));
  row.appendChild(mk('unidad', 'g'));
  row.appendChild(mk('vd', '4'));

  const del = el('button', 'btn ghost small x', '×');
  del.title = 'Quitar este elemento';
  del.addEventListener('click', () => {
    nutriDraft.items.splice(idx, 1);
    renderNutriList();
  });
  row.appendChild(del);
  return row;
}

function renderNutriList() {
  const list = $('nutriList');
  list.innerHTML = '';
  nutriDraft.items.forEach((it, i) => list.appendChild(nutriRowNode(it, i)));
  $('nutriEmpty').hidden = nutriDraft.items.length > 0;
  $('nutriBody').classList.toggle('off', !nutriDraft.on);
}

function openNutri() {
  nutriDraft = cloneNutri(currentLabel().nutri);
  $('nutriOn').checked = !!nutriDraft.on;
  $('nutriTitulo').value = nutriDraft.titulo || '';
  $('nutriPorcion').value = nutriDraft.porcion || '';
  $('nutriPie').value = nutriDraft.pie || '';
  $('nutriNota').value = nutriDraft.nota || '';
  $('nutriErr').textContent = '';
  renderNutriList();
  $('nutriModal').classList.add('show');
}

function closeNutri() { $('nutriModal').classList.remove('show'); }

function saveNutri() {
  nutriDraft.on = $('nutriOn').checked;
  nutriDraft.titulo = $('nutriTitulo').value;
  nutriDraft.porcion = $('nutriPorcion').value;
  nutriDraft.pie = $('nutriPie').value;
  nutriDraft.nota = $('nutriNota').value;
  // Descarta filas totalmente vacias; las que quedan a medio cargar se avisan.
  nutriDraft.items = nutriDraft.items.filter(
    (i) => String(i.nombre || '').trim() || String(i.valor || '').trim());

  if (nutriDraft.on) {
    if (!nutriDraft.items.length) {
      $('nutriErr').textContent = 'Agregá al menos un elemento o desactivá la tabla.';
      return;
    }
    const incompleta = nutriDraft.items.some(
      (i) => !String(i.nombre || '').trim() || !String(i.valor || '').trim());
    if (incompleta) {
      $('nutriErr').textContent = 'Cada elemento necesita nombre y valor.';
      renderNutriList();
      return;
    }
  }

  const nutri = cloneNutri(nutriDraft);
  if (state.applyAll) state.items = state.items.map((l) => ({ ...l, nutri: cloneNutri(nutri) }));
  else state.items[state.sel] = { ...state.items[state.sel], nutri };

  closeNutri();
  syncNutriBadge();
  catalogEdited(true);                // la tabla tambien es dato del producto: se guarda al confirmarla
  renderSheets();
  toast(nutri.on
    ? `Tabla nutricional con ${nutri.items.length} elementos` + (state.applyAll ? ' en todas las etiquetas' : '')
    : 'Tabla nutricional desactivada');
}

function syncNutriBadge() {
  const n = currentLabel().nutri;
  const badge = $('nutriBadge');
  if (n && n.on && nutriRows(n).length) {
    badge.textContent = `${nutriRows(n).length} elementos`;
    badge.className = 'badge on';
  } else {
    badge.textContent = 'opcional';
    badge.className = 'badge';
  }
}

/* ============================================================
   Utilidades UI
   ============================================================ */

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
}

/* Configuracion local de este navegador. Las plantillas no van aca: viven en
   la planilla de Google, compartidas con el equipo (ver cloud.js). */
let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    window.api.saveConfig({ cfgVersion: CFG_VERSION, cfg: state.cfg, logo: state.logo, zoom: state.zoom });
  }, 400);
}

function clampNum(v, min, max, fallback) {
  const n = parseFloat(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* Chromium no cambia los <input type=number> con la rueda del mouse.
   Lo hacemos a mano, pero solo cuando el campo tiene el foco: asi el
   scroll sobre el panel sigue funcionando si el cursor apenas pasa por
   encima de un campo. Shift acelera x10. */
function enableWheelStep(id, step, min, max) {
  const el = $(id);
  el.addEventListener('wheel', (e) => {
    if (document.activeElement !== el) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const cur = parseFloat(el.value);
    const base = isFinite(cur) ? cur : min;
    const next = clampNum(base + dir * step * (e.shiftKey ? 10 : 1), min, max, base);
    el.value = String(parseFloat(next.toFixed(3)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });
}

/* Modal de texto (en lugar de window.prompt, que no respeta el estilo de la app). */
let modalResolve = null;
function askText(title, initial) {
  $('modalTitle').textContent = title;
  $('modalInput').value = initial || '';
  $('modalErr').textContent = '';
  $('modal').classList.add('show');
  setTimeout(() => { $('modalInput').focus(); $('modalInput').select(); }, 30);
  return new Promise((res) => { modalResolve = res; });
}
function closeModal(value) {
  $('modal').classList.remove('show');
  if (modalResolve) { modalResolve(value); modalResolve = null; }
}

function syncQty() {
  $('qty').value = state.qty;
}

/* ============================================================
   Acciones
   ============================================================ */

function bulkGenerate() {
  const raw = $('bulk').value.trim();
  if (!raw) return toast('Escribi al menos una linea.', true);

  const items = [];
  const errores = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const f = line.split('|').map((s) => s.trim());
    const count = Math.max(1, Math.min(MAX_QTY, parseInt(f[6], 10) || 1));
    const label = {
      producto: f[0] || '', cantidad: f[1] || '', unidad: f[2] || 'gr',
      lote: f[3] || '', venc: f[4] || '', codigo: f[5] || ''
    };
    const faltan = labelProblems(label);
    if (faltan.length) errores.push(`Linea ${i + 1}: falta ${faltan.join(', ')}`);
    for (let k = 0; k < count && items.length < MAX_QTY; k++) items.push(cloneLabel(label));
  });

  if (!items.length) return toast('No se pudo leer ninguna linea.', true);

  state.items = items;
  state.qty = items.length;
  state.sel = 0;
  state.applyAll = false;              // cada producto conserva sus datos
  $('applyAll').checked = false;
  syncQty();
  renderSheets();
  fillForm();

  if (errores.length) toast(errores[0] + (errores.length > 1 ? ` (+${errores.length - 1})` : ''), true);
  else toast(`${items.length} etiquetas en ${pageCount()} hoja(s)`);
}

function sequenceLots() {
  const prefix = $('seqPrefix').value;
  const pad = clampNum($('seqPad').value, 1, 10, 3);
  let n = clampNum($('seqFrom').value, 0, 1e9, 1);
  for (let i = 0; i < state.qty; i++) {
    state.items[i].lote = prefix + String(n).padStart(pad, '0');
    n++;
  }
  state.applyAll = false;             // si no, el proximo cambio borraria la numeracion
  $('applyAll').checked = false;
  renderSheets();
  fillForm();
  toast(`${state.qty} lotes numerados`);
}

/* ============================================================
   Eventos
   ============================================================ */

function bindEvents() {

  /* --- formato de hoja --- */
  $('preset').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'custom') return;

    if (val.startsWith('sheet:')) {
      const t = SHEET_TEMPLATES.find((x) => x.id === val.slice(6));
      if (!t) return;
      Object.assign(state.cfg, {
        cols: t.cols, rows: t.rows,
        mTop: t.mTop, mBottom: t.mBottom, mLeft: t.mLeft, mRight: t.mRight,
        gapX: t.gapX, gapY: t.gapY
      });
    } else {
      const [c, r] = val.split('x').map(Number);
      state.cfg.cols = c; state.cfg.rows = r;
    }
    syncControls(); renderSheets(); fillForm(); persist();
  });

  ['cols', 'rows'].forEach((id) => {
    $(id).addEventListener('change', () => {
      state.cfg.cols = clampNum($('cols').value, 1, 12, 2);
      state.cfg.rows = clampNum($('rows').value, 1, 20, 4);
      syncControls(); renderSheets(); fillForm(); persist();
    });
  });

  [['mTop', 0, 60], ['mBottom', 0, 60], ['mLeft', 0, 60], ['mRight', 0, 60],
   ['gapX', 0, 30], ['gapY', 0, 30]].forEach(([id, lo, hi]) => {
    $(id).addEventListener('input', () => {
      state.cfg[id] = clampNum($(id).value, lo, hi, state.cfg[id]);
      renderSheets(); persist();
    });
  });

  ['showBorder', 'showGuides', 'showLogo', 'barcodeText'].forEach((id) => {
    $(id).addEventListener('change', () => {
      state.cfg[id] = $(id).checked;
      bcCache.clear(); renderSheets(); persist();
    });
  });

  const slider = (id, label) => {
    $(id).addEventListener('input', () => {
      state.cfg[id] = parseInt($(id).value, 10);
      $(label).textContent = state.cfg[id] + '%';
      renderSheets(); persist();
    });
  };
  slider('fontScale', 'fontScaleVal');
  slider('logoScale', 'logoScaleVal');
  slider('barcodeH', 'barcodeHVal');
  slider('wmOpacity', 'wmOpacityVal');

  $('barcodeType').addEventListener('change', () => {
    state.cfg.barcodeType = $('barcodeType').value;
    bcCache.clear(); markMissing(); renderSheets(); persist();
  });

  /* --- posicion del logo --- */
  ['logoX', 'logoY'].forEach((id) => {
    $(id).addEventListener('input', () => {
      state.cfg[id] = clampNum($(id).value, 0, 100, state.cfg[id]);
      syncLogoPos();
      renderSheets();
      persist();
    });
    enableWheelStep(id, 1, 0, 100);
  });

  /* --- logo --- */
  $('btnLogo').addEventListener('click', async () => {
    const res = await window.api.pickLogo();
    if (!res) return;
    state.logo = res.dataUrl;
    $('logoPreview').src = state.logo;
    medirLogo(state.logo, renderSheets);
    renderSheets(); persist();
    toast('Logo actualizado: ' + res.name);
  });

  $('btnLogoReset').addEventListener('click', () => {
    state.logo = DEFAULT_LOGO;
    $('logoPreview').src = state.logo;
    medirLogo(state.logo, renderSheets);
    renderSheets(); persist();
    toast('Logo restaurado');
  });

  /* --- campos de la etiqueta --- */
  let editTimer = null;
  const onEdit = (e) => {
    readForm();
    markMissing();
    refreshPrintState();            // el boton Imprimir reacciona al instante
    refreshLoteUI();
    /* Los datos del producto se copian al catalogo (cloud.js): mientras se
       escribe solo se anota el cambio; el select de unidad no tiene
       "mientras", su `change` ya es la eleccion final y se guarda. Lote y
       vencimiento no van al producto: de eso se encarga catalogEdited. */
    catalogEdited(e.type === 'change');
    clearTimeout(editTimer);
    editTimer = setTimeout(renderSheets, 90);
  };
  ['fProducto', 'fCantidad', 'fLote', 'fVenc',
   'fIngredientes', 'fInfoExtra'].forEach((id) => {
    $(id).addEventListener('input', onEdit);
    // Al salir del campo (clic afuera, Tab o Enter) se guarda en la planilla.
    $(id).addEventListener('change', () => catalogEdited(true));
  });
  $('fUnidad').addEventListener('change', onEdit);

  $('applyAll').addEventListener('change', () => {
    state.applyAll = $('applyAll').checked;
    if (state.applyAll) { readForm(); renderSheets(); }
  });

  $('btnClearAll').addEventListener('click', () => {
    state.items = state.items.map(() => emptyLabel());
    state.sel = 0;
    renderSheets(); fillForm();
    toast('Etiquetas vaciadas');
  });

  /* --- cantidad de etiquetas --- */
  let qtyTimer = null;
  const onQty = () => {
    const raw = $('qty').value.trim();
    if (!raw) return;                      // el usuario esta borrando para reescribir
    setQty(clampNum(raw, 1, MAX_QTY, state.qty));
    clearTimeout(qtyTimer);
    qtyTimer = setTimeout(() => { renderSheets(); fillForm(); }, 200);
  };
  $('qty').addEventListener('input', onQty);
  $('qty').addEventListener('change', () => { onQty(); syncQty(); });
  document.querySelectorAll('[data-qty]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.qty === 'hoja' ? perPage() : parseInt(b.dataset.qty, 10);
      setQty(v); syncQty(); renderSheets(); fillForm();
      $('qty').focus();          // deja el campo listo para seguir ajustando
      $('qty').select();
    });
  });

  /* La rueda del mouse ajusta los campos numericos (con el campo enfocado). */
  enableWheelStep('qty', 1, 1, MAX_QTY);
  enableWheelStep('cols', 1, 1, 12);
  enableWheelStep('rows', 1, 1, 20);
  [['mTop', 60], ['mBottom', 60], ['mLeft', 60], ['mRight', 60],
   ['gapX', 30], ['gapY', 30]].forEach(([id, hi]) => enableWheelStep(id, 0.5, 0, hi));
  enableWheelStep('seqFrom', 1, 0, 999999);
  enableWheelStep('seqPad', 1, 1, 10);

  /* --- plantillas guardadas --- */
  $('btnTplSave').addEventListener('click', async () => {
    if (!requireCloud()) return;
    const l = currentLabel();
    if (!String(l.producto || '').trim()) return toast('Cargá al menos el producto.', true);
    const name = await askText('Guardar plantilla', l.producto.slice(0, 40));
    if (name === null) return;
    const clean = name.trim();
    if (!clean) return toast('El nombre no puede estar vacio.', true);
    saveTemplate(clean);
  });

  $('btnTplApply').addEventListener('click', () => applyTemplate($('tplSaved').value));
  $('tplSaved').addEventListener('dblclick', () => applyTemplate($('tplSaved').value));

  $('btnTplDelete').addEventListener('click', async () => {
    const id = $('tplSaved').value;
    const t = state.templates.find((x) => x.id === id);
    if (!t) return toast('Elegi una plantilla de la lista.', true);
    // Es un dato compartido: borrarla la saca para todo el equipo.
    if (!confirm(`¿Eliminar la plantilla "${t.name}" de la planilla?`)) return;
    if (!await cloudDeleteTemplate(id)) return;
    state.templates = state.templates.filter((x) => x.id !== id);
    refreshTemplateList();
    toast(`Plantilla "${t.name}" eliminada`);
  });

  /* --- tabla nutricional --- */
  $('btnNutri').addEventListener('click', openNutri);
  $('nutriOk').addEventListener('click', saveNutri);
  $('nutriCancel').addEventListener('click', closeNutri);
  $('nutriModal').addEventListener('click', (e) => {
    if (e.target === $('nutriModal')) closeNutri();
  });
  $('nutriOn').addEventListener('change', () => {
    nutriDraft.on = $('nutriOn').checked;
    if (nutriDraft.on && !nutriDraft.items.length) nutriDraft.items = NUTRI_PRESET.map((i) => ({ ...i }));
    renderNutriList();
  });
  $('nutriAdd').addEventListener('click', () => {
    nutriDraft.items.push({ nombre: '', valor: '', unidad: 'g', vd: '' });
    renderNutriList();
    const inputs = $('nutriList').querySelectorAll('.nutri-row input');
    if (inputs.length) inputs[inputs.length - 4].focus();
  });
  $('nutriPreset').addEventListener('click', () => {
    nutriDraft.items = NUTRI_PRESET.map((i) => ({ ...i }));
    renderNutriList();
    toast('Rotulo estandar cargado: completá los valores');
  });
  /* Inserta la frase estandar y deja el cursor al final, listo para escribir
     los nutrientes que faltan completar. */
  const frasePie = (id) => {
    const inp = $(id);
    inp.value = NUTRI_PIE;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  };
  $('nutriPieStd').addEventListener('click', () => frasePie('nutriPie'));
  $('nutriNotaStd').addEventListener('click', () => frasePie('nutriNota'));

  $('nutriDelete').addEventListener('click', () => {
    nutriDraft.items = [];
    nutriDraft.pie = '';
    nutriDraft.nota = '';
    nutriDraft.on = false;
    $('nutriPie').value = '';
    $('nutriNota').value = '';
    $('nutriOn').checked = false;
    renderNutriList();
  });

  /* --- modal --- */
  $('modalOk').addEventListener('click', () => closeModal($('modalInput').value));
  $('modalCancel').addEventListener('click', () => closeModal(null));
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(null); });
  $('modalInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeModal($('modalInput').value);
    if (e.key === 'Escape') closeModal(null);
  });

  /* --- listas --- */
  $('btnBulk').addEventListener('click', bulkGenerate);
  $('btnBulkDemo').addEventListener('click', () => {
    $('bulk').value =
      'Yerba mate compuesta | 500 | gr | L-001 | 12/2027 | 7791234567898 | 8\n' +
      'Miel pura de abeja | 1 | kg | L-002 | 06/2028 | 7790000000010 | 4\n' +
      'Nuez pelada mariposa | 250 | gr | L-003 | 03/2027 | 7798765432107 | 4';
  });
  $('btnSeq').addEventListener('click', sequenceLots);

  /* --- zoom --- */
  const setZoom = (z) => {
    state.zoom = Math.min(2, Math.max(0.2, z));
    $('sheets').style.zoom = state.zoom;
    $('zoomVal').textContent = Math.round(state.zoom * 100) + '%';
    persist();
  };
  $('zoomIn').addEventListener('click', () => setZoom(state.zoom + 0.1));
  $('zoomOut').addEventListener('click', () => setZoom(state.zoom - 0.1));
  $('zoomFit').addEventListener('click', () => {
    setZoom(($('scroll').clientWidth - 56) / (A4.w * MM_PX));
  });
  $('scroll').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(state.zoom + (e.deltaY < 0 ? 0.08 : -0.08));
  }, { passive: false });

  /* --- proyecto / salida --- */
  $('btnSave').addEventListener('click', async () => {
    const ok = await window.api.saveProject({
      version: 2, cfg: state.cfg, logo: state.logo,
      items: state.items, qty: state.qty, templates: state.templates
    });
    if (ok) toast('Proyecto guardado');
  });

  $('btnOpen').addEventListener('click', async () => {
    const data = await window.api.openProject();
    if (!data) return;
    state.cfg = { ...state.cfg, ...(data.cfg || {}), template: DESIGN };
    // Igual que en init: una ruta al logo de fabrica (de esta version o de la
    // de escritorio) se reemplaza por el de fabrica actual.
    state.logo = data.logo && String(data.logo).startsWith('data:') ? data.logo : DEFAULT_LOGO;
    const items = Array.isArray(data.items) ? data.items : [];
    state.items = items.length ? items.map(cloneLabel) : [emptyLabel()];
    state.qty = Math.min(state.items.length, Math.max(1, data.qty || state.items.length));
    state.sel = 0;
    bcCache.clear();
    medirLogo(state.logo, renderSheets);
    buildDesignPicker(); syncControls(); syncQty();
    renderSheets(); fillForm(); persist();
    toast('Proyecto abierto');
    /* Las plantillas del archivo no reemplazan a las de la planilla: se
       ofrece subir las que falten (asi se migran las de la version de
       escritorio). */
    if (Array.isArray(data.templates) && data.templates.length) cloudImportTemplates(data.templates);
  });

  $('btnPrint').addEventListener('click', async () => {
    const r = refreshPrintState();
    if (!r.ok) return toast('No se puede imprimir. ' + r.msg, true);
    document.activeElement?.blur();
    const res = await window.api.print();
    if (!res.success && res.reason && res.reason !== 'cancelled') {
      toast('No se pudo imprimir: ' + res.reason, true);
    }
  });

  /* El navegador no deja escribir un PDF directo a disco: se usa el mismo
     dialogo de impresion, con "Guardar como PDF" como destino. */
  $('btnPdf').addEventListener('click', async () => {
    const r = refreshPrintState();
    if (!r.ok) return toast('No se puede exportar. ' + r.msg, true);
    document.activeElement?.blur();
    toast('En el dialogo elegí "Guardar como PDF" como destino');
    setTimeout(() => window.api.print(), 600);   // que se alcance a leer el aviso
  });

  /* --- teclado --- */
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-bg.show')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); $('btnPrint').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('btnSave').click(); }
    if (typing) return;

    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: state.cfg.cols, ArrowUp: -state.cfg.cols }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      const next = state.sel + move;
      if (next >= 0 && next < state.qty) onLabelClick(next);
    }
  });
}

/* ============================================================
   Controles / sincronizacion
   ============================================================ */

function buildPresetOptions() {
  const sel = $('preset');
  sel.innerHTML = '';

  const gSheets = document.createElement('optgroup');
  gSheets.label = 'Hojas comerciales';
  SHEET_TEMPLATES.forEach((t) => {
    const o = document.createElement('option');
    o.value = `sheet:${t.id}`;
    o.textContent = t.name;
    gSheets.appendChild(o);
  });
  sel.appendChild(gSheets);

  const gGrid = document.createElement('optgroup');
  gGrid.label = 'Distribucion (columnas x filas)';
  PRESETS.forEach((p) => {
    const o = document.createElement('option');
    o.value = `${p.c}x${p.r}`;
    o.textContent = `${p.c} x ${p.r}  (${p.c * p.r} etiquetas)`;
    gGrid.appendChild(o);
  });
  sel.appendChild(gGrid);

  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Personalizado';
  sel.appendChild(custom);
}

const DESIGN_ICON = {
  a: `<svg viewBox="0 0 60 40"><g fill="#8b93a5">
      <rect x="21" y="4" width="18" height="6" rx="1"/>
      <rect x="12" y="13" width="36" height="4" rx="1"/>
      <rect x="20" y="20" width="20" height="5" rx="1"/>
      <g fill="#5c6479"><rect x="14" y="29" width="2" height="8"/><rect x="18" y="29" width="1" height="8"/>
      <rect x="21" y="29" width="3" height="8"/><rect x="26" y="29" width="1" height="8"/>
      <rect x="29" y="29" width="2" height="8"/><rect x="33" y="29" width="3" height="8"/>
      <rect x="38" y="29" width="1" height="8"/><rect x="41" y="29" width="2" height="8"/>
      <rect x="45" y="29" width="1" height="8"/></g></g></svg>`,
  b: `<svg viewBox="0 0 60 40"><g fill="#8b93a5">
      <rect x="6" y="5" width="14" height="6" rx="1"/>
      <rect x="26" y="6" width="28" height="4" rx="1"/>
      <rect x="6" y="14" width="48" height="1"/>
      <rect x="6" y="19" width="16" height="6" rx="1"/>
      <rect x="6" y="28" width="18" height="3" rx="1"/>
      <g fill="#5c6479"><rect x="31" y="19" width="2" height="13"/><rect x="35" y="19" width="1" height="13"/>
      <rect x="38" y="19" width="3" height="13"/><rect x="43" y="19" width="1" height="13"/>
      <rect x="46" y="19" width="2" height="13"/><rect x="50" y="19" width="3" height="13"/></g></g></svg>`,
  c: `<svg viewBox="0 0 60 40"><g fill="#8b93a5">
      <rect x="6" y="5" width="14" height="6" rx="1"/>
      <rect x="34" y="4" width="20" height="9" rx="2" fill="#5c6479"/>
      <rect x="6" y="17" width="34" height="4" rx="1"/>
      <rect x="6" y="24" width="20" height="3" rx="1"/>
      <g fill="#5c6479"><rect x="6" y="31" width="2" height="6"/><rect x="10" y="31" width="1" height="6"/>
      <rect x="13" y="31" width="3" height="6"/><rect x="18" y="31" width="1" height="6"/>
      <rect x="21" y="31" width="2" height="6"/><rect x="25" y="31" width="3" height="6"/>
      <rect x="30" y="31" width="1" height="6"/><rect x="33" y="31" width="2" height="6"/>
      <rect x="37" y="31" width="3" height="6"/><rect x="42" y="31" width="1" height="6"/>
      <rect x="45" y="31" width="2" height="6"/><rect x="49" y="31" width="3" height="6"/></g></g></svg>`,
  d: `<svg viewBox="0 0 60 40"><g fill="#8b93a5">
      <rect x="5" y="4" width="50" height="14" rx="2" fill="#5c6479"/>
      <rect x="5" y="20" width="50" height="1" fill="#454c5c"/>
      <rect x="5" y="23" width="24" height="4" rx="1"/>
      <rect x="43" y="23" width="12" height="4" rx="1"/>
      <g fill="#5c6479"><rect x="5" y="30" width="2" height="7"/><rect x="9" y="30" width="1" height="7"/>
      <rect x="12" y="30" width="3" height="7"/><rect x="17" y="30" width="1" height="7"/>
      <rect x="20" y="30" width="2" height="7"/><rect x="24" y="30" width="3" height="7"/>
      <rect x="29" y="30" width="1" height="7"/><rect x="32" y="30" width="2" height="7"/>
      <rect x="36" y="30" width="3" height="7"/><rect x="41" y="30" width="1" height="7"/>
      <rect x="44" y="30" width="2" height="7"/><rect x="48" y="30" width="3" height="7"/></g></g></svg>`,
  e: `<svg viewBox="0 0 60 40">
      <g fill="#5c6479" opacity=".3">
        <path d="M16 14 L30 7 L44 14 L44 28 L30 35 L16 28 Z"/>
      </g>
      <g fill="#8b93a5">
      <rect x="11" y="7" width="38" height="4" rx="1"/>
      <rect x="21" y="14" width="18" height="6" rx="1"/>
      <g fill="#5c6479"><rect x="13" y="27" width="2" height="8"/><rect x="17" y="27" width="1" height="8"/>
      <rect x="20" y="27" width="3" height="8"/><rect x="25" y="27" width="1" height="8"/>
      <rect x="28" y="27" width="2" height="8"/><rect x="32" y="27" width="3" height="8"/>
      <rect x="37" y="27" width="1" height="8"/><rect x="40" y="27" width="2" height="8"/>
      <rect x="44" y="27" width="3" height="8"/></g></g></svg>`,
  f: `<svg viewBox="0 0 60 40">
      <g fill="#5c6479" opacity=".3">
        <path d="M16 11 L30 4 L44 11 L44 24 L30 31 L16 24 Z"/>
      </g>
      <g fill="#8b93a5">
      <rect x="13" y="3" width="34" height="3.5" rx="1"/>
      <g fill="none" stroke="#8b93a5" stroke-width="1">
        <rect x="5" y="10" width="23" height="15" rx="1"/>
        <rect x="32" y="10" width="23" height="15" rx="1"/>
      </g>
      <g fill="#5c6479">
      <rect x="7.5" y="13" width="13" height="1.6"/><rect x="7.5" y="16.5" width="18" height="1.2"/>
      <rect x="7.5" y="19.5" width="18" height="1.2"/><rect x="7.5" y="22.5" width="14" height="1.2"/>
      <rect x="34.5" y="13" width="13" height="1.6"/><rect x="34.5" y="16.5" width="18" height="1.2"/>
      <rect x="34.5" y="19.5" width="18" height="1.2"/><rect x="34.5" y="22.5" width="11" height="1.2"/></g>
      <g fill="#5c6479"><rect x="13" y="29" width="2" height="7"/><rect x="17" y="29" width="1" height="7"/>
      <rect x="20" y="29" width="3" height="7"/><rect x="25" y="29" width="1" height="7"/>
      <rect x="28" y="29" width="2" height="7"/><rect x="32" y="29" width="3" height="7"/>
      <rect x="37" y="29" width="1" height="7"/><rect x="40" y="29" width="2" height="7"/>
      <rect x="44" y="29" width="3" height="7"/></g></g></svg>`
};

function buildDesignPicker() {
  const cont = $('templatePicker');
  cont.innerHTML = '';
  DESIGNS.forEach((t) => {
    const b = el('div', 'tpl-opt' + (state.cfg.template === t.id ? ' on' : ''));
    b.innerHTML = DESIGN_ICON[t.id] + `<span>${t.name}</span>`;
    b.addEventListener('click', () => {
      state.cfg.template = t.id;
      buildDesignPicker();
      renderSheets();
      persist();
    });
    cont.appendChild(b);
  });
  $('wmField').hidden = !isWatermark(state.cfg.template);
  syncLogoPos();
}

const nombreX = (v) => v <= 12 ? 'Izquierda' : v >= 88 ? 'Derecha' : v === 50 ? 'Centro' : v + '%';
const nombreY = (v) => v <= 12 ? 'Arriba' : v >= 88 ? 'Abajo' : v === 50 ? 'Medio' : v + '%';

function syncLogoPos() {
  const c = state.cfg;
  $('logoX').value = c.logoX;
  $('logoY').value = c.logoY;
  $('logoXVal').textContent = nombreX(c.logoX);
  $('logoYVal').textContent = nombreY(c.logoY);
  $('logoPosHint').textContent = isWatermark(c.template)
    ? 'La marca de agua se mueve por detras de los datos.'
    : 'El contenido de la etiqueta se corre para no quedar tapado.';
}

function syncControls() {
  const c = state.cfg;
  $('cols').value = c.cols;
  $('rows').value = c.rows;
  $('mTop').value = c.mTop;
  $('mBottom').value = c.mBottom;
  $('mLeft').value = c.mLeft;
  $('mRight').value = c.mRight;
  $('gapX').value = c.gapX;
  $('gapY').value = c.gapY;
  $('fontScale').value = c.fontScale;
  $('fontScaleVal').textContent = c.fontScale + '%';
  $('logoScale').value = c.logoScale;
  $('logoScaleVal').textContent = c.logoScale + '%';
  $('showLogo').checked = c.showLogo;
  $('showBorder').checked = c.showBorder;
  $('showGuides').checked = c.showGuides;
  $('barcodeType').value = c.barcodeType;
  $('barcodeText').checked = c.barcodeText;
  $('barcodeH').value = c.barcodeH;
  $('barcodeHVal').textContent = c.barcodeH + '%';
  syncLogoPos();
  $('wmOpacity').value = c.wmOpacity;
  $('wmOpacityVal').textContent = c.wmOpacity + '%';
  $('wmField').hidden = !isWatermark(c.template);  // "Marca de agua" y "Dos columnas"
  $('applyAll').checked = state.applyAll;
  $('logoPreview').src = state.logo;
  $('zoomVal').textContent = Math.round(state.zoom * 100) + '%';
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const sheet = SHEET_TEMPLATES.find((t) =>
    t.cols === c.cols && t.rows === c.rows &&
    near(t.mTop, c.mTop) && near(t.mBottom, c.mBottom) &&
    near(t.mLeft, c.mLeft) && near(t.mRight, c.mRight) &&
    near(t.gapX, c.gapX) && near(t.gapY, c.gapY));
  if (sheet) {
    $('preset').value = `sheet:${sheet.id}`;
  } else {
    const key = `${c.cols}x${c.rows}`;
    $('preset').value = PRESETS.some((p) => `${p.c}x${p.r}` === key) ? key : 'custom';
  }
}

/* ============================================================
   Inicio
   ============================================================ */

async function init() {
  buildPresetOptions();

  const saved = await window.api.loadConfig();
  if (saved) {
    // Una configuracion de otra version de los valores por defecto se descarta.
    if (saved.cfgVersion === CFG_VERSION) state.cfg = { ...state.cfg, ...(saved.cfg || {}) };
    state.cfg.template = DESIGN;
    /* Solo se recupera un logo subido a mano (data URL). Si lo guardado es
       la ruta del logo de fabrica, se ignora: asi, al cambiar el de fabrica,
       nadie se queda con el anterior o con una ruta que ya no existe. */
    if (saved.logo && String(saved.logo).startsWith('data:')) state.logo = saved.logo;
    if (saved.zoom) state.zoom = saved.zoom;
  }

  state.qty = perPage();
  state.items = Array.from({ length: state.qty }, emptyLabel);
  state.sel = 0;

  medirLogo(state.logo, renderSheets);
  buildDesignPicker();
  refreshTemplateList();
  syncControls();
  syncQty();
  bindEvents();
  renderSheets();
  fillForm();
  cloudInit();
}

init();
