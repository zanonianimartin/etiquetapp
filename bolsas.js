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

const baseFromRow = (r) => ({
  nombre: String(r.nombre).trim(), ingredientes: r.ingredientes || '', infoExtra: r.infoExtra || ''
});

const findBase = (nombre) => {
  const k = normalizar(nombre);
  return k ? cloud.productos.find((p) => normalizar(p.nombre) === k) || null : null;
};

const provFromRow = (r) => ({
  nombre: String(r.nombre).trim(), telefono: r.telefono || '', email: r.email || '', notas: r.notas || ''
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

/* Numero escrito a mano, con coma o punto decimal ("25,5", "25.5"). Con
   `miles`, para precios, acepta ademas el punto de miles: "1.250,50" y
   "1.250" son 1250,5 y 1250 (un punto seguido de exactamente 3 cifras se toma
   como miles). Devuelve null si no es un numero >= 0. En la planilla se
   guarda con punto, como cualquier numero. */
function leerDecimal(txt, miles = false) {
  let s = String(txt || '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');        // 1.250,50 / 25,5
  else if (miles && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.250
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/* Al reves, para mostrar en el formulario lo guardado: "25.5" -> "25,5". */
const decimalUY = (v) => String(v ?? '').replace('.', ',');

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

/* Productos que puede tener una bolsa: los productos a granel (pestana
   Productos: nombre, ingredientes e info, sin cantidad) y los nombres del
   catalogo, una vez cada uno y sin presentacion. Una bolsa de "Pimienta
   blanca molida" sirve para los paquetes de 250 g y de 500 g. */
function productosGranel() {
  const vistos = new Map();
  [...cloud.productos.map((p) => p.nombre), ...cloud.catalog.map((c) => c.producto)].forEach((n) => {
    const k = normalizar(n);
    if (k && !vistos.has(k)) vistos.set(k, n);
  });
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

/* ---------------- Producto a granel ---------------- */

/* Ventana "Nuevo producto" de Bolsas: nombre, ingredientes e informacion
   adicional. La cantidad, la clave y el codigo de barras son de cada
   presentacion y se cargan en Etiquetas (Nuevo producto del catalogo). */
/* Para quien se abrio: 'bolsa' (formulario de Bolsas) o 'presentacion' (alta
   de producto de Etiquetas). Ahi queda elegido el producto nuevo. */
let baseDestino = 'bolsa';

function openBaseModal(destino = 'bolsa') {
  if (!requireCloud()) return;
  baseDestino = destino;
  $('baNombre').value = '';
  $('baIngr').value = '';
  $('baInfo').value = '';
  $('baErr').textContent = '';
  $('baseModal').classList.add('show');
  setTimeout(() => $('baNombre').focus(), 30);
}

const closeBaseModal = () => $('baseModal').classList.remove('show');

async function guardarBase() {
  const nombre = $('baNombre').value.trim().replace(/\s+/g, ' ');
  if (!nombre) { $('baErr').textContent = 'Cargá el nombre del producto.'; return; }
  const existe = productosGranel().find((p) => normalizar(p) === normalizar(nombre));
  if (existe) { $('baErr').textContent = `Ya existe el producto "${existe}": elegilo de la lista.`; return; }
  const base = { nombre, ingredientes: $('baIngr').value.trim(), infoExtra: $('baInfo').value.trim() };
  const ok = await cloudTask('Guardando producto…', async () => {
    await gUpsert('Productos', 'nombre', base);
    return true;
  });
  if (!ok) return;
  cloud.productos.push(base);
  closeBaseModal();
  if (baseDestino === 'presentacion') {
    // Queda elegido en el alta de producto, con sus ingredientes e info.
    fillProdProductos(nombre);
    completarDesdeGranel(true);
  } else {
    fillBolsaProductos(nombre);          // queda elegido en la bolsa
    $('bProducto').closest('.field').classList.remove('missing');
  }
  toast(`Producto "${nombre}" guardado`);
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

/* ---------------- Proveedores ---------------- */

/* Los guardados, mas los que quedaron escritos en bolsas viejas (antes de que
   existiera la pestana Proveedores), para que esas bolsas se puedan editar
   sin perder el dato. */
function nombresProveedores() {
  const vistos = new Map();
  [...cloud.proveedores.map((p) => p.nombre), ...cloud.bolsas.map((b) => b.proveedor)]
    .forEach((n) => { const k = normalizar(n); if (k && !vistos.has(k)) vistos.set(k, n); });
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

const findProv = (nombre) => cloud.proveedores.find((p) => normalizar(p.nombre) === normalizar(nombre)) || null;

function fillProveedores(actual) {
  const sel = $('bProveedor');
  sel.innerHTML = '';
  sel.appendChild(new Option('— sin proveedor —', ''));
  nombresProveedores().forEach((n) => sel.appendChild(new Option(n, n)));
  sel.value = actual && nombresProveedores().find((n) => normalizar(n) === normalizar(actual)) || '';
  $('bProvEditar').disabled = !sel.value;
}

/* Ventana para crear o editar un proveedor. `nombre`: el que se edita (null:
   nuevo). El nombre no se cambia al editar: es lo que guardan las bolsas. */
let provEdit = null;

function openProvModal(nombre = null) {
  if (!requireCloud()) return;
  const p = nombre ? findProv(nombre) || { nombre, telefono: '', email: '', notas: '' } : null;
  provEdit = p ? p.nombre : null;
  $('pvTitulo').textContent = p ? `Editar proveedor` : 'Nuevo proveedor';
  $('pvNombre').value = p ? p.nombre : '';
  $('pvNombre').readOnly = !!p;
  $('pvTel').value = p ? p.telefono : '';
  $('pvEmail').value = p ? p.email : '';
  $('pvNotas').value = p ? p.notas : '';
  $('pvErr').textContent = '';
  $('pvEliminar').hidden = !p || !findProv(p.nombre);
  $('provModal').classList.add('show');
  setTimeout(() => (p ? $('pvTel') : $('pvNombre')).focus(), 30);
}

const closeProvModal = () => $('provModal').classList.remove('show');

async function guardarProv() {
  const nombre = $('pvNombre').value.trim().replace(/\s+/g, ' ');
  if (!nombre) { $('pvErr').textContent = 'Cargá el nombre del proveedor.'; return; }
  if (!provEdit && findProv(nombre)) { $('pvErr').textContent = `Ya existe el proveedor "${findProv(nombre).nombre}".`; return; }
  const prov = {
    nombre: provEdit || nombre, telefono: $('pvTel').value.trim(),
    email: $('pvEmail').value.trim(), notas: $('pvNotas').value.trim()
  };
  const ok = await cloudTask('Guardando proveedor…', async () => {
    await gUpsert('Proveedores', 'nombre', prov);
    return true;
  });
  if (!ok) return;
  const prev = findProv(prov.nombre);
  if (prev) Object.assign(prev, prov); else cloud.proveedores.push(prov);
  closeProvModal();
  fillProveedores(prov.nombre);          // queda elegido en la bolsa
  toast(provEdit ? `Proveedor "${prov.nombre}" actualizado` : `Proveedor "${prov.nombre}" guardado`);
}

async function eliminarProv() {
  const p = findProv(provEdit);
  if (!p) return;
  const usan = cloud.bolsas.filter((b) => normalizar(b.proveedor) === normalizar(p.nombre)).map((b) => b.id);
  if (usan.length) {
    $('pvErr').textContent = `No se puede eliminar: lo usan las bolsas ${usan.join(', ')}.`;
    return;
  }
  if (!confirm(`¿Eliminar el proveedor "${p.nombre}"?`)) return;
  const ok = await cloudTask('Eliminando proveedor…', async () => {
    await gDelete('Proveedores', 'nombre', p.nombre);
    return true;
  });
  if (!ok) return;
  cloud.proveedores = cloud.proveedores.filter((x) => x !== p);
  closeProvModal();
  fillProveedores('');
  toast(`Proveedor "${p.nombre}" eliminado`);
}

/* ---------------- Formulario ---------------- */

let bolsaEdit = null;          // id de la bolsa que se esta editando (null: nueva)
let bolsaFoto = null;          // archivo elegido, se sube al guardar

const BOLSA_CAMPOS = ['bProducto', 'bIngreso', 'bPeso', 'bVenc', 'bPrecio', 'bCantidad'];
const BOLSAS_MAX_JUNTAS = 50;

function resetBolsaForm(b = null) {
  bolsaEdit = b ? b.id : null;
  bolsaFoto = null;
  $('bTitulo').textContent = b ? `Editar bolsa ${b.id}` : 'Registrar bolsa';
  fillBolsaProductos(b ? b.producto : '');
  $('bIngreso').value = b ? b.ingreso : hoyISO();
  $('bPeso').value = b ? decimalUY(b.peso) : '25';
  $('bVenc').value = b ? b.vencimiento : '';
  $('bPrecio').value = b ? decimalUY(b.precio) : '';
  fillProveedores(b ? b.proveedor : '');
  $('bLoteProv').value = b ? b.loteProveedor : '';
  // Varias bolsas iguales se registran juntas; al editar se edita una sola.
  $('bCantidad').value = '1';
  $('bCantidadField').hidden = !!b;
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
  const peso = leerDecimal($('bPeso').value);
  const venc = $('bVenc').value;
  const precio = leerDecimal($('bPrecio').value, true);
  marcar('bProducto', !producto, 'Elegí el producto de la bolsa.');
  marcar('bIngreso', !/^\d{4}-\d{2}-\d{2}$/.test(ingreso), 'Cargá la fecha de ingreso.');
  marcar('bPeso', !(peso > 0), 'Cargá el peso de la bolsa en kg (por ejemplo 25 o 25,5).');
  marcar('bVenc', !/^\d{4}-\d{2}-\d{2}$/.test(venc), 'Cargá el vencimiento de la bolsa.');
  marcar('bPrecio', precio === null, 'Cargá el precio de compra (por ejemplo 1250 o 1.250,50).');
  const cantTxt = String($('bCantidad').value).trim();
  const cantidad = bolsaEdit ? 1 : Number(cantTxt);
  marcar('bCantidad', !bolsaEdit && !(/^\d+$/.test(cantTxt) && cantidad >= 1 && cantidad <= BOLSAS_MAX_JUNTAS),
    `La cantidad de bolsas va de 1 a ${BOLSAS_MAX_JUNTAS}.`);
  return {
    errores,
    cantidad,
    datos: {
      producto, ingreso, peso: String(peso), vencimiento: venc, precio: String(precio),
      proveedor: $('bProveedor').value.trim(), loteProveedor: $('bLoteProv').value.trim(),
      estado: bolsaEdit ? $('bEstado').value : 'disponible'
    }
  };
}

/* Proximo numero correlativo, leido de la planilla en el momento: otra
   persona pudo haber registrado bolsas desde la ultima carga. */
async function nextBolsaNum() {
  const { rows } = await gReadTab('Bolsas');
  return rows.reduce((m, r) => {
    const x = /^B-(\d+)$/i.exec(String(r.id || '').trim());
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0) + 1;
}

const bolsaId = (n) => 'B-' + String(n).padStart(4, '0');

/* Varias bolsas registradas juntas comparten la foto: no se manda a la
   papelera mientras otra bolsa la siga usando. */
const fotoEnUso = (fotoId, salvo) => cloud.bolsas.some((b) => b.foto === fotoId && b.id !== salvo);

async function guardarBolsa() {
  if (!requireCloud()) return;
  const { datos, errores, cantidad } = leerBolsaForm();
  if (errores.length) { $('bErr').textContent = errores[0]; return; }
  $('bErr').textContent = '';

  const editando = bolsaEdit;
  const foto = bolsaFoto;
  const plural = cantidad > 1;
  showBusy(foto ? 'Preparando la foto…' : plural ? `Guardando ${cantidad} bolsas…` : 'Guardando la bolsa…');
  let ids;
  try {
    ids = await cloudTask(null, async () => {
      // Al registrar varias, quedan con ids seguidos: B-0005, B-0006, B-0007…
      const primero = editando ? null : await nextBolsaNum();
      const lista = editando ? [editando] : Array.from({ length: cantidad }, (_, i) => bolsaId(primero + i));
      const rango = lista.length > 1 ? `${lista[0]} a ${lista[lista.length - 1]}` : lista[0];

      let campos = {};
      if (foto) {
        const file = await shrinkPhoto(foto);
        showBusy(`Subiendo la foto a Drive (${tamano(file.size)})…`);
        const carpeta = await imageFolder();
        const subida = await gUploadImage(file, `${lista.length > 1 ? 'Bolsas' : 'Bolsa'} ${rango} - ${file.name}`, carpeta);
        imgCache.set(subida.id, URL.createObjectURL(file));
        campos = { foto: subida.id, archivo: file.name, enlace: subida.webViewLink || '' };
      }
      showBusy(plural ? `Guardando ${cantidad} bolsas…` : 'Guardando la bolsa…');

      if (editando) {
        const prev = cloud.bolsas.find((b) => b.id === editando);
        const bolsa = { id: editando, ...datos, ...campos };
        await gUpsert('Bolsas', 'id', bolsaToRow(bolsa));
        // La foto anterior va a la papelera recien con la nueva ya guardada,
        // y solo si ninguna otra bolsa la comparte.
        if (campos.foto && prev && prev.foto && !fotoEnUso(prev.foto, editando)) await gTrash(prev.foto);
        Object.assign(prev, bolsa, gStamp());
      } else {
        const nuevas = lista.map((id) => ({ id, ...datos, ...campos }));
        await gAppendRows('Bolsas', nuevas.map(bolsaToRow));
        nuevas.forEach((b) => cloud.bolsas.push({ ...b, ...gStamp() }));
      }
      return lista;
    });
  } finally {
    hideBusy();
  }
  if (!ids) return;
  toast(editando ? `Bolsa ${ids[0]} actualizada`
    : ids.length > 1 ? `${ids.length} bolsas registradas: ${ids[0]} a ${ids[ids.length - 1]}`
    : `Bolsa ${ids[0]} registrada`);
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
    if (b.foto && !fotoEnUso(b.foto, b.id)) await gTrash(b.foto);
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
    /* Sin bolsas no se puede seguir (el paso a paso pide una): se ofrece ir
       a registrarla, con el producto ya elegido. */
    cont.appendChild(el('p', 'hint', cloud.bolsas.length
      ? 'No hay bolsas sin agotar de este producto.'
      : 'Todavia no hay bolsas registradas.'));
    const ir = el('button', 'btn small wide', 'Registrar la bolsa en la seccion Bolsas');
    ir.type = 'button';
    ir.addEventListener('click', () => {
      const prod = currentLabel().producto;
      setSeccion('bolsas');
      resetBolsaForm();
      fillBolsaProductos(prod);
    });
    cont.appendChild(ir);
    syncPasos();
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
      // Tildada = en uso, en el momento. Destildada vuelve a disponible si
      // ningun otro lote la usa (se habia tildado por error).
      const otros = bolsaLotes(b.id).filter((x) => x !== lote);
      if (cb.checked && b.estado === 'disponible') cambiarEstadoBolsa(b, 'en uso');
      else if (!cb.checked && b.estado === 'en uso' && !otros.length) cambiarEstadoBolsa(b, 'disponible');
      vencDesdeBolsas();
      syncPasos();
    });
    fila.appendChild(cb);
    fila.append(`${b.id} · ${b.producto} · vence ${fechaUY(b.vencimiento)} · ${b.estado}`);
    cont.appendChild(fila);
  });
  syncPasos();
}

/* Cambia el estado de una bolsa en la planilla. Se actualiza la pantalla en
   el momento y, si la planilla no responde, se vuelve atras y se avisa. */
async function cambiarEstadoBolsa(b, estado) {
  const antes = b.estado;
  b.estado = estado;
  renderLoteBolsas();
  renderBolsasList();
  try {
    await gUpsert('Bolsas', 'id', { id: b.id, estado });
    Object.assign(b, gStamp());
  } catch (err) {
    b.estado = antes;
    renderLoteBolsas();
    renderBolsasList();
    toast(`No se pudo marcar la bolsa ${b.id} como ${estado}: ${err.message || err}`, true);
  }
}

/* Paso a paso de la etiqueta: con producto elegido aparecen las bolsas; con
   una bolsa tildada, los datos de la etiqueta, el registro del lote y la
   impresion (clases requiere-producto / requiere-bolsa en index.html). */
function syncPasos() {
  const l = currentLabel();
  const conProducto = !!String(l.codigo || l.producto || '').trim();
  document.body.classList.toggle('paso-producto', conProducto);
  document.body.classList.toggle('paso-bolsa', conProducto && loteBolsasSel.size > 0);
}

/* El vencimiento de la etiqueta es el de la bolsa usada. Con varias, el mas
   proximo: el producto no puede vencer despues que la primera de sus bolsas.
   Sin bolsas tildadas no se toca (puede haberse cargado a mano). */
function vencDesdeBolsas() {
  const vencs = [...loteBolsasSel]
    .map((id) => (cloud.bolsas.find((b) => b.id === id) || {}).vencimiento)
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v || ''))
    .sort();
  if (!vencs.length) return;
  const venc = fechaUY(vencs[0]);
  if (currentLabel().venc === venc) return;
  applyPatch({ venc });
  renderSheets();
  fillForm();
  toast(`Vencimiento ${venc}, el de la bolsa${vencs.length > 1 ? ' que vence primero' : ''}`);
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
  if (!bolsaEdit) {
    fillBolsaProductos($('bProducto').value);
    fillProveedores($('bProveedor').value);
  }
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

  // Producto a granel que todavia no existe: nombre, ingredientes e info.
  $('bProdNuevo').addEventListener('click', () => openBaseModal('bolsa'));
  $('baOk').addEventListener('click', guardarBase);
  $('baCancelar').addEventListener('click', closeBaseModal);
  $('baseModal').addEventListener('click', (e) => { if (e.target === $('baseModal')) closeBaseModal(); });
  $('baseModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBaseModal();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') guardarBase();
  });

  /* --- proveedores --- */
  $('bProveedor').addEventListener('change', () => { $('bProvEditar').disabled = !$('bProveedor').value; });
  $('bProvNuevo').addEventListener('click', () => openProvModal());
  $('bProvEditar').addEventListener('click', () => { if ($('bProveedor').value) openProvModal($('bProveedor').value); });
  $('pvOk').addEventListener('click', guardarProv);
  $('pvCancelar').addEventListener('click', closeProvModal);
  $('pvEliminar').addEventListener('click', eliminarProv);
  $('provModal').addEventListener('click', (e) => { if (e.target === $('provModal')) closeProvModal(); });
  $('provModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProvModal();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') guardarProv();
  });

  resetBolsaForm();
}
