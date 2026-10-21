/* ============================================================
   EtiquetApp — bolsas de granel
   ============================================================

   Trazabilidad de lo que se compra a granel: cada bolsa (25 kg) que llega
   se registra con producto, proveedor, peso, vencimiento, precio y una foto
   de su etiqueta, y despues se asocia a los lotes de etiquetas que salieron
   de ella (columna `bolsas` de la pestana Lotes). Asi, desde un lote se sabe
   de que bolsas salio y desde una bolsa en que lotes se uso.
   Se carga despues de cloud.js y antes de app.js: solo declara funciones. */

const BOLSA_ESTADOS = ['disponible', 'en uso', 'agotada'];
const SECCION_KEY = 'etiquetapp-seccion';

const bolsaFromRow = (r) => {
  const estado = String(r.estado || '').trim().toLowerCase();
  return {
    id: String(r.id).trim(),
    ingreso: r.ingreso || '', producto: r.producto || '',
    proveedor: r.proveedor || '', loteProveedor: r.loteProveedor || '',
    peso: r.peso || '', vencimiento: r.vencimiento || '', precio: r.precio || '',
    estado: BOLSA_ESTADOS.includes(estado) ? estado : 'disponible',
    foto: r.foto || '', archivo: r.archivo || '', enlace: r.enlace || '',
    actualizado: r.actualizado || '', por: r.por || ''
  };
};

const bolsaToRow = (b) => ({
  id: b.id, ingreso: b.ingreso, producto: b.producto, proveedor: b.proveedor,
  loteProveedor: b.loteProveedor, peso: b.peso, vencimiento: b.vencimiento,
  precio: b.precio, estado: b.estado,
  ...(b.foto !== undefined ? { foto: b.foto, archivo: b.archivo, enlace: b.enlace } : {})
});

/* "B-0001, B-0003" -> ['B-0001', 'B-0003'] */
const parseBolsas = (txt) => String(txt || '').split(',').map((s) => s.trim()).filter(Boolean);

/* ---------------- Formatos ---------------- */

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* AAAA-MM-DD -> DD/MM/AAAA. Lo que no tenga ese formato (cargado a mano en
   la planilla) se muestra tal cual. */
const fechaUY = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const kilos = (n) => `${Number(n).toLocaleString('es-UY', { maximumFractionDigits: 3 })} kg`;
const pesos = (n) => '$ ' + Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------------- Menu de secciones ---------------- */

function setSeccion(s) {
  const seccion = s === 'bolsas' ? 'bolsas' : 'etiquetas';
  document.body.dataset.seccion = seccion;
  document.querySelectorAll('#secciones [data-seccion]').forEach((b) => {
    b.classList.toggle('on', b.dataset.seccion === seccion);
    b.setAttribute('aria-pressed', String(b.dataset.seccion === seccion));
  });
  try { localStorage.setItem(SECCION_KEY, seccion); } catch { /* se arranca en Etiquetas */ }
  if (seccion === 'bolsas') refreshBolsasUI();
}

/* ---------------- Productos ---------------- */

/* Nombres del catalogo, una vez cada uno y sin presentacion: una bolsa de
   "Pimienta blanca molida" sirve para los paquetes de 250 g y de 500 g. */
function productosGranel() {
  const vistos = new Map();
  cloud.catalog.forEach((c) => {
    const k = normalizar(c.producto);
    if (k && !vistos.has(k)) vistos.set(k, c.producto);
  });
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

function fillBolsaProductos(actual) {
  const sel = $('bProducto');
  const lista = productosGranel();
  // Una bolsa vieja puede tener un producto que ya no esta en el catalogo.
  if (actual && !lista.some((p) => normalizar(p) === normalizar(actual))) lista.unshift(actual);
  sel.innerHTML = '';
  sel.appendChild(new Option(lista.length ? '— elegí un producto —' : '— el catalogo esta vacio —', ''));
  lista.forEach((p) => sel.appendChild(new Option(p, p)));
  sel.value = actual && lista.find((p) => normalizar(p) === normalizar(actual)) || '';
}

/* ---------------- Formulario ---------------- */

let bolsaEdit = null;          // id de la bolsa que se esta editando (null: nueva)
let bolsaFoto = null;          // archivo elegido, se sube al guardar

const BOLSA_CAMPOS = ['bProducto', 'bIngreso', 'bPeso', 'bVenc', 'bPrecio'];

function resetBolsaForm(b = null) {
  bolsaEdit = b ? b.id : null;
  bolsaFoto = null;
  $('bTitulo').textContent = b ? `Editar bolsa ${b.id}` : 'Registrar bolsa';
  fillBolsaProductos(b ? b.producto : '');
  $('bIngreso').value = b ? b.ingreso : hoyISO();
  $('bPeso').value = b ? b.peso : '25';
  $('bVenc').value = b ? b.vencimiento : '';
  $('bPrecio').value = b ? b.precio : '';
  $('bProveedor').value = b ? b.proveedor : '';
  $('bLoteProv').value = b ? b.loteProveedor : '';
  $('bEstado').value = b ? b.estado : 'disponible';
  $('bEstadoField').hidden = !b;          // una bolsa nueva siempre entra disponible
  $('bErr').textContent = '';
  BOLSA_CAMPOS.forEach((id) => $(id).closest('.field').classList.remove('missing'));
  $('bGuardar').textContent = b ? 'Guardar cambios' : 'Registrar bolsa';
  $('bCancelar').hidden = !b;
  $('bEliminar').hidden = !b;
  $('bFotoBtn').textContent = b && b.foto ? 'Cambiar foto…' : 'Foto de la etiqueta…';
  pintarFotoForm(b);
}

function pintarFotoForm(b) {
  const box = $('bFotoBox');
  const img = $('bFotoImg');
  $('bFotoInfo').textContent = bolsaFoto
    ? `Foto nueva: ${bolsaFoto.name} (se sube al guardar)`
    : b && b.foto ? '' : 'Sin foto (opcional).';
  if (bolsaFoto) {
    box.hidden = false;
    img.src = URL.createObjectURL(bolsaFoto);
    return;
  }
  if (!b || !b.foto) { box.hidden = true; img.removeAttribute('src'); return; }
  box.hidden = false;
  cargarFoto(b.foto, img);
}

/* Baja una imagen de Drive (o la toma de la cache) y la pone en <img>. */
async function cargarFoto(id, img) {
  if (imgCache.has(id)) { img.src = imgCache.get(id); return; }
  img.removeAttribute('src');
  img.closest('.lote-img, .bolsa-thumb')?.classList.add('loading');
  try {
    const url = URL.createObjectURL(await gImageBlob(id));
    imgCache.set(id, url);
    img.src = url;
  } catch {
    img.alt = 'No se pudo cargar la foto';
  } finally {
    img.closest('.lote-img, .bolsa-thumb')?.classList.remove('loading');
  }
}

/* Lee y valida el formulario. Devuelve { datos, errores }. */
function leerBolsaForm() {
  const errores = [];
  const marcar = (id, mal, msg) => {
    $(id).closest('.field').classList.toggle('missing', mal);
    if (mal) errores.push(msg);
  };
  const producto = $('bProducto').value.trim();
  const ingreso = $('bIngreso').value;
  const peso = Number($('bPeso').value);
  const venc = $('bVenc').value;
  const precioTxt = String($('bPrecio').value).trim();
  const precio = Number(precioTxt);
  marcar('bProducto', !producto, 'Elegí el producto de la bolsa.');
  marcar('bIngreso', !/^\d{4}-\d{2}-\d{2}$/.test(ingreso), 'Cargá la fecha de ingreso.');
  marcar('bPeso', !(peso > 0), 'Cargá el peso de la bolsa en kg.');
  marcar('bVenc', !/^\d{4}-\d{2}-\d{2}$/.test(venc), 'Cargá el vencimiento de la bolsa.');
  marcar('bPrecio', precioTxt === '' || !(precio >= 0), 'Cargá el precio de compra.');
  return {
    errores,
    datos: {
      producto, ingreso, peso: String(peso), vencimiento: venc, precio: String(precio),
      proveedor: $('bProveedor').value.trim(), loteProveedor: $('bLoteProv').value.trim(),
      estado: bolsaEdit ? $('bEstado').value : 'disponible'
    }
  };
}

/* Proximo id correlativo, leido de la planilla en el momento: otra persona
   pudo haber registrado bolsas desde la ultima carga. */
async function nextBolsaId() {
  const { rows } = await gReadTab('Bolsas');
  const max = rows.reduce((m, r) => {
    const x = /^B-(\d+)$/i.exec(String(r.id || '').trim());
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return 'B-' + String(max + 1).padStart(4, '0');
}

async function guardarBolsa() {
  if (!requireCloud()) return;
  const { datos, errores } = leerBolsaForm();
  if (errores.length) { $('bErr').textContent = errores[0]; return; }
  $('bErr').textContent = '';

  const editando = bolsaEdit;
  const foto = bolsaFoto;
  showBusy(foto ? 'Preparando la foto…' : 'Guardando la bolsa…');
  let id;
  try {
    id = await cloudTask(null, async () => {
      const nuevoId = editando || await nextBolsaId();
      let campos = {};
      if (foto) {
        const file = await shrinkPhoto(foto);
        showBusy(`Subiendo la foto a Drive (${tamano(file.size)})…`);
        const carpeta = await imageFolder();
        const subida = await gUploadImage(file, `Bolsa ${nuevoId} - ${file.name}`, carpeta);
        imgCache.set(subida.id, URL.createObjectURL(file));
        campos = { foto: subida.id, archivo: file.name, enlace: subida.webViewLink || '' };
      }
      showBusy('Guardando la bolsa…');
      const prev = cloud.bolsas.find((b) => b.id === nuevoId);
      const bolsa = { id: nuevoId, ...datos, ...campos };
      await gUpsert('Bolsas', 'id', bolsaToRow(bolsa));
      // La foto anterior va a la papelera recien con la nueva ya guardada.
      if (campos.foto && prev && prev.foto) await gTrash(prev.foto);
      const full = { ...(prev || {}), ...bolsa, ...gStamp() };
      if (prev) Object.assign(prev, full);
      else cloud.bolsas.push(full);
      return nuevoId;
    });
  } finally {
    hideBusy();
  }
  if (!id) return;
  toast(editando ? `Bolsa ${id} actualizada` : `Bolsa ${id} registrada`);
  resetBolsaForm();
  refreshBolsasUI();
}

async function eliminarBolsa() {
  if (!requireCloud() || !bolsaEdit) return;
  const b = cloud.bolsas.find((x) => x.id === bolsaEdit);
  if (!b) return;
  const usada = bolsaLotes(b.id);
  if (usada.length) {
    return toast(`La bolsa ${b.id} esta asociada ${usada.length > 1 ? 'a los lotes' : 'al lote'} ${usada.join(', ')}: no se puede eliminar. Marcala como agotada.`, true);
  }
  if (!confirm(`¿Eliminar la bolsa ${b.id} (${b.producto})?`)) return;
  const ok = await cloudTask('Eliminando la bolsa…', async () => {
    await gDelete('Bolsas', 'id', b.id);
    if (b.foto) await gTrash(b.foto);
    return true;
  });
  if (!ok) return;
  cloud.bolsas = cloud.bolsas.filter((x) => x !== b);
  toast(`Bolsa ${b.id} eliminada`);
  resetBolsaForm();
  refreshBolsasUI();
}

/* ---------------- Lista ---------------- */

const bolsaLotes = (id) => cloud.lotes.filter((l) => parseBolsas(l.bolsas).includes(id)).map((l) => l.lote);

let thumbObs = null;

function renderBolsasList() {
  const cont = $('bList');
  cont.innerHTML = '';
  const filtro = $('bFiltro').value;
  const palabras = normalizar($('bBuscar').value).split(/\s+/).filter(Boolean);
  const lista = cloud.bolsas
    .filter((b) => filtro === 'todas' ? true : filtro === 'activas' ? b.estado !== 'agotada' : b.estado === filtro)
    .filter((b) => {
      const donde = normalizar(`${b.id} ${b.producto} ${b.proveedor} ${b.loteProveedor} ${bolsaLotes(b.id).join(' ')}`);
      return palabras.every((p) => donde.includes(p));
    })
    .sort((a, b) => b.ingreso.localeCompare(a.ingreso) || b.id.localeCompare(a.id));

  $('bCount').textContent = cloudReady() ? `${cloud.bolsas.length} registradas` : '—';
  if (!lista.length) {
    cont.appendChild(el('p', 'hint', cloud.bolsas.length ? 'Ninguna bolsa coincide con la busqueda.' : 'Todavia no hay bolsas registradas.'));
    return;
  }

  if (thumbObs) thumbObs.disconnect();
  /* Las fotos se bajan recien cuando la tarjeta se ve: con muchas bolsas,
     bajarlas todas juntas seria lento y gastaria datos en el celular. */
  thumbObs = 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        thumbObs.unobserve(e.target);
        cargarFoto(e.target.dataset.foto, e.target.querySelector('img'));
      }), { rootMargin: '200px' })
    : null;

  lista.forEach((b) => {
    const card = el('div', 'bolsa-card' + (b.id === bolsaEdit ? ' sel' : ''));
    card.tabIndex = 0;
    const thumb = el('div', 'bolsa-thumb' + (b.foto ? '' : ' vacia'));
    if (b.foto) {
      const img = el('img');
      img.alt = `Etiqueta de la bolsa ${b.id}`;
      thumb.appendChild(img);
      thumb.dataset.foto = b.foto;
      if (thumbObs) thumbObs.observe(thumb); else cargarFoto(b.foto, img);
    } else {
      thumb.appendChild(el('span', null, 'sin foto'));
    }
    card.appendChild(thumb);

    const info = el('div', 'bolsa-info');
    const cab = el('div', 'bolsa-cab');
    cab.appendChild(el('b', null, b.id));
    cab.appendChild(el('span', 'bolsa-estado e-' + b.estado.replace(' ', '-'), b.estado));
    info.appendChild(cab);
    info.appendChild(el('div', 'bolsa-prod', b.producto));
    info.appendChild(el('div', 'bolsa-det',
      [`Ingreso ${fechaUY(b.ingreso)}`, b.peso && kilos(b.peso), `Vence ${fechaUY(b.vencimiento)}`].filter(Boolean).join(' · ')));
    const prov = [b.proveedor, b.loteProveedor && `lote ${b.loteProveedor}`].filter(Boolean).join(' · ');
    info.appendChild(el('div', 'bolsa-det', [b.precio !== '' && pesos(b.precio), prov].filter(Boolean).join(' · ')));
    const lotes = bolsaLotes(b.id);
    info.appendChild(el('div', 'bolsa-lotes', lotes.length ? `Lotes: ${lotes.join(', ')}` : 'Sin lotes asociados'));
    card.appendChild(info);

    const abrir = () => {
      resetBolsaForm(b);
      renderBolsasList();
      $('bForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    card.addEventListener('click', abrir);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
    cont.appendChild(card);
  });
}

/* ---------------- Bolsas usadas en un lote ---------------- */

let loteBolsasSel = new Set();      // ids elegidos para el lote seleccionado

/* Al pasar a otro lote se toman las bolsas que tenia guardadas. */
function loteBolsasDesde(reg) {
  loteBolsasSel = new Set(parseBolsas(reg && reg.bolsas));
}

const loteBolsasTexto = () => [...loteBolsasSel].sort().join(', ');

/* Lista de bolsas para tildar en el registro de lotes: las no agotadas del
   mismo producto que la etiqueta (o de todos, con la casilla), mas las que
   el lote ya tenga aunque esten agotadas. */
function renderLoteBolsas() {
  const cont = $('loteBolsas');
  if (!cont) return;
  cont.innerHTML = '';
  const lote = currentLote();
  const prod = normalizar(currentLabel().producto);
  const todas = $('loteBolsasTodas').checked;
  const lista = cloud.bolsas
    .filter((b) => loteBolsasSel.has(b.id) || (b.estado !== 'agotada' && (todas || normalizar(b.producto) === prod)))
    .sort((a, b) => a.ingreso.localeCompare(b.ingreso) || a.id.localeCompare(b.id));
  if (!lista.length) {
    cont.appendChild(el('p', 'hint', cloud.bolsas.length
      ? 'No hay bolsas disponibles de este producto. Registralas en la seccion Bolsas.'
      : 'Todavia no hay bolsas registradas (seccion Bolsas).'));
    return;
  }
  lista.forEach((b) => {
    const fila = el('label', 'check bolsa-opc');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = b.id;
    cb.checked = loteBolsasSel.has(b.id);
    cb.disabled = !lote;
    cb.addEventListener('change', () => {
      if (cb.checked) loteBolsasSel.add(b.id); else loteBolsasSel.delete(b.id);
      $('loteBolsasAviso').hidden = false;
    });
    fila.appendChild(cb);
    fila.append(`${b.id} · ${b.producto} · vence ${fechaUY(b.vencimiento)} · ${b.estado}`);
    cont.appendChild(fila);
  });
}

/* Al registrar el lote, sus bolsas "disponibles" pasan a "en uso".
   "Agotada" se marca a mano desde la seccion Bolsas. */
async function marcarBolsasEnUso() {
  for (const id of loteBolsasSel) {
    const b = cloud.bolsas.find((x) => x.id === id);
    if (!b || b.estado !== 'disponible') continue;
    await gUpsert('Bolsas', 'id', { id, estado: 'en uso' });
    Object.assign(b, { estado: 'en uso' }, gStamp());
  }
  $('loteBolsasAviso').hidden = true;
}

/* ---------------- Refresco y eventos ---------------- */

function refreshBolsasUI() {
  if (!$('bList')) return;
  if (!bolsaEdit) fillBolsaProductos($('bProducto').value);
  renderBolsasList();
  renderLoteBolsas();
}

function bindBolsasEvents() {
  document.querySelectorAll('#secciones [data-seccion]').forEach((b) => {
    b.addEventListener('click', () => setSeccion(b.dataset.seccion));
  });
  let inicial = 'etiquetas';
  try { inicial = localStorage.getItem(SECCION_KEY) || 'etiquetas'; } catch { /* idem */ }
  setSeccion(inicial);

  $('bGuardar').addEventListener('click', guardarBolsa);
  $('bCancelar').addEventListener('click', () => { resetBolsaForm(); renderBolsasList(); });
  $('bEliminar').addEventListener('click', eliminarBolsa);
  $('bFotoBtn').addEventListener('click', async () => {
    const f = await pickFile('image/*');
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('El archivo no es una imagen.', true);
    if (f.size > IMG_MAX) return toast('La imagen es demasiado grande (max 20 MB).', true);
    bolsaFoto = f;
    pintarFotoForm(cloud.bolsas.find((b) => b.id === bolsaEdit));
  });
  $('bFotoImg').addEventListener('click', () => {
    const b = cloud.bolsas.find((x) => x.id === bolsaEdit);
    const url = (!bolsaFoto && b && b.enlace) || $('bFotoImg').src;
    if (url) window.open(url, '_blank', 'noopener');
  });
  BOLSA_CAMPOS.forEach((id) => $(id).addEventListener('input', () => {
    if ($(id).closest('.field').classList.contains('missing')) leerBolsaForm();
  }));
  $('bBuscar').addEventListener('input', renderBolsasList);
  $('bFiltro').addEventListener('change', renderBolsasList);
  $('loteBolsasTodas').addEventListener('change', renderLoteBolsas);

  resetBolsaForm();
}
