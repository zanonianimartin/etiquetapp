/* EtiquetApp - lotes: precio sugerido de venta y seccion Lotes.
   El precio se carga y se calcula en Etiquetas (Registro de lotes). La seccion
   Lotes lista los lotes registrados (pestana Lotes) para consultarlos: fecha,
   producto y presentacion, vencimiento, paquetes, precio, bolsas e imagen.
   Usa cloud (cloud.js) y las utilidades de bolsas.js. */

/* Fecha del lote, AAAA-MM-DD: la de su nombre (L-DDMMAA-clave) o, si el lote
   se escribio a mano, la de su ultima actualizacion en la planilla. */
function fechaLote(l) {
  const m = /^L-(\d{2})(\d{2})(\d{2})(?!\d)/i.exec(l.lote);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return String(l.actualizado || '').slice(0, 10);
}

/* "250 gr" de la presentacion del catalogo con ese codigo, si existe. */
function presentacionDeLote(l) {
  const c = cloud.catalog.find((x) => String(x.codigo) === String(l.codigo));
  return c && c.cantidad ? `${c.cantidad} ${c.unidad}` : '';
}

/* Ir a una bolsa usada en el lote: abre Bolsas buscandola. */
function verBolsa(id) {
  setSeccion('bolsas');
  $('bBuscar').value = id;
  $('bFiltro').value = 'todas';
  renderBolsasList();
}

/* ---------------- Precio sugerido del lote ---------------- */

/* Por paquete: granel + empaque + etiqueta + agregado = costo, y el precio
   deja `ganancia` % de margen sobre la venta: precio = costo / (1 - g/100).
   El granel es el de la bolsa tildada mas cara por kilo (precio / peso) por
   el peso del paquete. Los cuatro valores son de cada lote. Se cargan en dos
   lugares con los mismos campos: Registro de lotes (Etiquetas, el lote de la
   etiqueta) y la ventana Precio… de la seccion Lotes (cualquier lote). */
const PRECIO_CAMPOS = { empaque: 'lpEmpaque', etiqueta: 'lpEtiqueta', agregado: 'lpAgregado', ganancia: 'lpGanancia' };
const PRECIO_MODAL = { empaque: 'lmEmpaque', etiqueta: 'lmEtiqueta', agregado: 'lmAgregado', ganancia: 'lmGanancia' };
const KG_UNIDAD = { mg: 1e-6, gr: 0.001, kg: 1 };
const redondo = (n) => String(Math.round(n * 100) / 100);

/* Lee los cuatro campos (vacio cuenta como 0) y marca los que no sirven.
   Devuelve { valores, error }. */
function leerPrecio(campos) {
  const valores = {};
  let error = '';
  Object.entries(campos).forEach(([k, id]) => {
    const txt = String($(id).value || '').trim();
    const n = txt ? leerDecimal(txt, k !== 'ganancia') : 0;
    const mal = n === null || (k === 'ganancia' && n >= 100);
    $(id).closest('.field').classList.toggle('missing', mal);
    if (mal && !error) error = k === 'ganancia' ? 'La ganancia es un porcentaje menor que 100.' : `El precio de ${k} no es un numero.`;
    valores[k] = mal ? null : n;
  });
  return { valores, error };
}

/* `pres`: { cantidad, unidad } del paquete; `ids`: bolsas usadas.
   Devuelve { ok, msg } o { ok, granel, bolsa, varias, kg, porKg, costo, precio }. */
function calcPrecio(pres, ids, valores) {
  if (!pres) return { ok: false, msg: 'La presentacion del lote no esta en el catalogo: no se sabe el peso del paquete.' };
  const kg = (Number(String(pres.cantidad || '').replace(',', '.')) || 0) * (KG_UNIDAD[pres.unidad] || 0);
  if (!kg) return { ok: false, msg: 'Para calcular el granel, la presentacion tiene que estar en gramos o kilos.' };
  const bolsas = ids.map((id) => cloud.bolsas.find((b) => b.id === id)).filter(Boolean);
  if (!bolsas.length) return { ok: false, msg: 'Tildá la bolsa usada para calcular el costo del granel.' };
  const sin = bolsas.filter((b) => !(Number(b.precio) > 0 && Number(b.peso) > 0));
  if (sin.length) return { ok: false, msg: `Falta el precio o el peso de la bolsa ${sin.map((b) => b.id).join(', ')} (se cargan en Bolsas).` };
  const porKgDe = (b) => Number(b.precio) / Number(b.peso);
  const cara = bolsas.reduce((a, b) => (porKgDe(b) > porKgDe(a) ? b : a));
  const porKg = porKgDe(cara);
  const granel = porKg * kg;
  const costo = granel + valores.empaque + valores.etiqueta + valores.agregado;
  return { ok: true, granel, bolsa: cara.id, varias: bolsas.length > 1, kg, porKg, costo, precio: costo / (1 - valores.ganancia / 100) };
}

/* Ganancia neta = precio sugerido - costo de produccion: por paquete y, con
   la cantidad de paquetes, la del lote entero. */
function pintarPrecio(box, campos, pres, ids, paquetes) {
  box.innerHTML = '';
  const { valores, error } = leerPrecio(campos);
  const r = error ? { ok: false, msg: error } : calcPrecio(pres, ids, valores);
  if (!r.ok) { box.appendChild(el('p', 'precio-falta', r.msg)); return; }
  const linea = (txt, val, cls) => {
    const p = el('div', 'precio-linea' + (cls ? ' ' + cls : ''));
    p.appendChild(el('span', null, txt));
    p.appendChild(el('b', null, pesos(val)));
    box.appendChild(p);
  };
  linea(`Granel: ${kilos(r.kg)} a ${pesos(r.porKg)} el kg (${r.bolsa}${r.varias ? ', la mas cara' : ''})`, r.granel);
  linea('Empaque', valores.empaque);
  linea('Etiqueta', valores.etiqueta);
  linea('Agregado', valores.agregado);
  linea('Costo por paquete', r.costo, 'total');
  linea(`Precio sugerido (margen ${String(valores.ganancia).replace('.', ',')} %)`, r.precio, 'final');
  // Con precio y costo en centavos, como se guardan: da lo mismo que la seccion Lotes.
  const neta = Number(redondo(r.precio)) - Number(redondo(r.costo));
  linea('Ganancia neta por paquete', neta, 'neta');
  const n = Number(paquetes) || 0;
  if (n > 0) linea(`Ganancia neta del lote (${n} paquetes)`, neta * n, 'neta');
}

/* Columnas del precio para la fila del lote, o null si algun campo no sirve.
   Si falta algo para calcular (bolsa sin precio), quedan los valores
   cargados y el costo y el precio vacios. */
function filaPrecio(campos, pres, ids) {
  const { valores, error } = leerPrecio(campos);
  if (error) return null;
  const r = calcPrecio(pres, ids, valores);
  const campo = (k) => (String($(campos[k]).value || '').trim() ? redondo(valores[k]) : '');
  return {
    empaque: campo('empaque'), etiqueta: campo('etiqueta'), agregado: campo('agregado'), ganancia: campo('ganancia'),
    costoGranel: r.ok ? redondo(r.granel) : '', costo: r.ok ? redondo(r.costo) : '', precio: r.ok ? redondo(r.precio) : ''
  };
}

/* Pone en los campos los valores de `reg` o, si no tiene ninguno, los del
   ultimo lote de la misma presentacion. Devuelve el lote de donde se copiaron. */
function llenarPrecio(campos, reg, codigo, lote) {
  const conPrecio = (x) => Object.keys(campos).some((k) => String(x[k] ?? '') !== '');
  codigo = String(codigo || '').trim();
  const base = reg && conPrecio(reg) ? reg : (codigo ? cloud.lotes
    .filter((x) => String(x.codigo) === codigo && x.lote !== lote && conPrecio(x))
    .sort((a, b) => fechaLote(b).localeCompare(fechaLote(a)) || String(b.actualizado).localeCompare(String(a.actualizado)))[0] : null);
  Object.entries(campos).forEach(([k, id]) => {
    $(id).value = base ? decimalUY(base[k] ?? '') : '';
    $(id).closest('.field').classList.remove('missing');
  });
  return base && base !== reg ? base : null;
}

/* --- en Etiquetas: el lote de la etiqueta seleccionada --- */

const leerPrecioLote = () => leerPrecio(PRECIO_CAMPOS);
const calcPrecioLote = (valores) => calcPrecio(currentLabel(), [...loteBolsasSel], valores);
const precioLoteRow = () => filaPrecio(PRECIO_CAMPOS, currentLabel(), [...loteBolsasSel]);

function paintPrecioLote() {
  const box = $('lpCalc');
  if (!box) return;
  const lote = currentLote();
  Object.values(PRECIO_CAMPOS).forEach((id) => { $(id).disabled = !lote; });
  if (!lote) { box.innerHTML = ''; return; }
  pintarPrecio(box, PRECIO_CAMPOS, currentLabel(), [...loteBolsasSel], lotePaquetesValor());
}

/* Al pasar a otro lote: los valores guardados del lote o, si es nuevo, los
   del ultimo lote registrado de la misma presentacion. */
function precioLoteDesde(reg) {
  const copia = reg ? null : llenarPrecio(PRECIO_CAMPOS, null, currentLabel().codigo, currentLote());
  if (reg) llenarPrecio(PRECIO_CAMPOS, reg, '', reg.lote);
  $('lpOrigen').textContent = copia ? `Valores copiados del lote ${copia.lote}: revisalos.` : '';
}

/* --- en la seccion Lotes: ventana Precio… de cualquier lote --- */

let loteModal = null;               // lote que se edita en la ventana
let lmSel = new Set();              // bolsas tildadas en la ventana

const presentacionLote = (l) => cloud.catalog.find((x) => String(x.codigo) === String(l.codigo)) || null;

function openLoteModal(l) {
  if (!requireCloud()) return;
  loteModal = l;
  lmSel = new Set(parseBolsas(l.bolsas));
  const pres = presentacionLote(l);
  $('lmTitulo').textContent = `Precio del lote ${l.lote}`;
  $('lmInfo').textContent = [l.producto, pres && `${pres.cantidad} ${pres.unidad}`, l.paquetes && `${l.paquetes} paquetes`, fechaUY(fechaLote(l))]
    .filter(Boolean).join(' · ');
  // Solo copia de otro lote si este no tiene ningun valor cargado.
  const copia = llenarPrecio(PRECIO_MODAL, l, l.codigo, l.lote);
  $('lmOrigen').textContent = copia ? `Este lote no tenia precio: valores copiados del lote ${copia.lote}. Revisalos.` : '';
  $('lmErr').textContent = '';
  renderLmBolsas();
  $('loteModal').classList.add('show');
  setTimeout(() => $('lmEmpaque').focus(), 30);
}

const closeLoteModal = () => { $('loteModal').classList.remove('show'); loteModal = null; };

/* Bolsas para elegir: las del producto del lote (en cualquier estado: un
   lote viejo pudo usar una que ya esta agotada) y las que el lote ya tenga. */
function renderLmBolsas() {
  const cont = $('lmBolsas');
  cont.innerHTML = '';
  const l = loteModal;
  const prod = normalizar(l.producto);
  const lista = cloud.bolsas
    .filter((b) => lmSel.has(b.id) || normalizar(b.producto) === prod)
    .sort((a, b) => b.ingreso.localeCompare(a.ingreso) || b.id.localeCompare(a.id));
  if (!lista.length) cont.appendChild(el('p', 'hint', 'No hay bolsas registradas de este producto.'));
  lista.forEach((b) => {
    const fila = el('label', 'check bolsa-opc');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = lmSel.has(b.id);
    cb.addEventListener('change', () => {
      if (cb.checked) lmSel.add(b.id); else lmSel.delete(b.id);
      paintLmPrecio();
    });
    fila.appendChild(cb);
    fila.append([b.id, `ingreso ${fechaUY(b.ingreso)}`, b.peso && kilos(b.peso), b.precio !== '' && pesos(b.precio), b.estado]
      .filter(Boolean).join(' · '));
    cont.appendChild(fila);
  });
  paintLmPrecio();
}

function paintLmPrecio() {
  if (loteModal) pintarPrecio($('lmCalc'), PRECIO_MODAL, presentacionLote(loteModal), [...lmSel], loteModal.paquetes);
}

async function guardarLoteModal() {
  const l = loteModal;
  const row = filaPrecio(PRECIO_MODAL, presentacionLote(l), [...lmSel]);
  if (!row) { $('lmErr').textContent = leerPrecio(PRECIO_MODAL).error; return; }
  const datos = { lote: l.lote, bolsas: [...lmSel].sort().join(', '), ...row };
  const ok = await cloudTask('Guardando el precio del lote…', async () => {
    await gUpsert('Lotes', 'lote', datos);
    return true;
  });
  if (!ok) return;
  Object.assign(l, datos, gStamp());
  closeLoteModal();
  // Si ese lote esta abierto en Etiquetas, se ve lo nuevo (y no se pisa
  // despues con lo viejo al tocar Actualizar registro).
  if (currentLote() === l.lote) { loteBolsasDesde(l); precioLoteDesde(l); }
  refreshLoteUI();
  refreshBolsasUI();                   // tarjetas de bolsas (lotes) y de lotes
  toast(row.precio ? `Lote ${l.lote}: precio sugerido ${pesos(row.precio)}` : `Lote ${l.lote} actualizado (sin precio: falta un dato para calcularlo)`);
}
/* ---------------- Seccion Lotes ---------------- */

let lotesThumbObs = null;

function renderLotesList() {
  const cont = $('lList');
  if (!cont) return;
  cont.innerHTML = '';
  const dias = Number($('lPeriodo').value) || 0;
  const desde = dias ? new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10) : '';
  const palabras = normalizar($('lBuscar').value).split(/\s+/).filter(Boolean);
  const lista = cloud.lotes
    .map((l) => ({ l, fecha: fechaLote(l) }))
    .filter(({ fecha }) => !desde || fecha >= desde)
    .filter(({ l }) => {
      const donde = normalizar(`${l.lote} ${l.producto} ${presentacionDeLote(l)} ${l.codigo} ${l.bolsas} ${l.vencimiento}`);
      return palabras.every((p) => donde.includes(p));
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.l.lote.localeCompare(a.l.lote));

  $('lCount').textContent = cloudReady() ? `${cloud.lotes.length} registrados` : '—';
  const paquetes = lista.reduce((s, { l }) => s + (Number(l.paquetes) || 0), 0);
  $('lResumen').textContent = lista.length
    ? `${lista.length} lote${lista.length > 1 ? 's' : ''} · ${paquetes.toLocaleString('es-UY')} paquetes`
    : '';
  if (!lista.length) {
    cont.appendChild(el('p', 'hint', cloud.lotes.length ? 'Ningun lote coincide con la busqueda.' : 'Todavia no hay lotes registrados.'));
    return;
  }

  // Igual que en Bolsas: las imagenes se bajan recien cuando la tarjeta se ve.
  if (lotesThumbObs) lotesThumbObs.disconnect();
  lotesThumbObs = 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        lotesThumbObs.unobserve(e.target);
        cargarFoto(e.target.dataset.foto, e.target.querySelector('img'));
      }), { rootMargin: '200px' })
    : null;

  lista.forEach(({ l, fecha }) => {
    const card = el('div', 'bolsa-card lote-card');
    const thumb = el('div', 'bolsa-thumb' + (l.imagen ? '' : ' vacia'));
    if (l.imagen) {
      const img = el('img');
      img.alt = `Imagen del lote ${l.lote}`;
      img.title = 'Abrir en tamano real';
      thumb.appendChild(img);
      thumb.dataset.foto = l.imagen;
      thumb.addEventListener('click', () => {
        const url = l.enlace || img.src;
        if (url) window.open(url, '_blank', 'noopener');
      });
      if (lotesThumbObs) lotesThumbObs.observe(thumb); else cargarFoto(l.imagen, img);
    } else {
      thumb.appendChild(el('span', null, 'sin imagen'));
    }
    card.appendChild(thumb);

    const info = el('div', 'bolsa-info');
    const cab = el('div', 'bolsa-cab');
    cab.appendChild(el('b', null, l.lote));
    cab.appendChild(el('span', 'lote-fecha', fechaUY(fecha)));
    info.appendChild(cab);
    info.appendChild(el('div', 'bolsa-prod', [l.producto, presentacionDeLote(l)].filter(Boolean).join(' · ')));
    info.appendChild(el('div', 'bolsa-det', [
      l.paquetes !== '' && `${l.paquetes} paquetes`,
      l.vencimiento ? `Vence ${l.vencimiento}` : 'Sin vencimiento',
      l.codigo && `Codigo ${l.codigo}`
    ].filter(Boolean).join(' · ')));
    if (String(l.precio ?? '') !== '') {
      info.appendChild(el('div', 'lote-precio', `Precio sugerido ${pesos(l.precio)}` +
        (String(l.costo ?? '') !== '' ? ` · costo ${pesos(l.costo)}` : '')));
      if (String(l.costo ?? '') !== '') {
        const neta = Number(l.precio) - Number(l.costo);
        const n = Number(l.paquetes) || 0;
        info.appendChild(el('div', 'lote-precio', `Ganancia neta ${pesos(neta)} por paquete` + (n > 0 ? ` · ${pesos(neta * n)} el lote` : '')));
      }
    }
    const bolsas = parseBolsas(l.bolsas);
    const fila = el('div', 'bolsa-lotes', bolsas.length ? 'Bolsas: ' : 'Sin bolsas registradas');
    bolsas.forEach((id, i) => {
      const a = el('button', 'link', id);
      a.type = 'button';
      a.title = `Ver la bolsa ${id}`;
      a.addEventListener('click', () => verBolsa(id));
      if (i) fila.appendChild(document.createTextNode(', '));
      fila.appendChild(a);
    });
    info.appendChild(fila);
    if (l.por) info.appendChild(el('div', 'bolsa-det', `Registrado por ${l.por}`));
    const editar = el('button', 'btn ghost small lote-btn', String(l.precio ?? '') !== '' ? 'Modificar precio…' : 'Precio…');
    editar.type = 'button';
    editar.addEventListener('click', () => openLoteModal(l));
    info.appendChild(editar);
    card.appendChild(info);
    cont.appendChild(card);
  });
}

function bindLotesEvents() {
  $('lBuscar').addEventListener('input', renderLotesList);
  $('lPeriodo').addEventListener('change', renderLotesList);
  Object.values(PRECIO_CAMPOS).forEach((id) => $(id).addEventListener('input', paintPrecioLote));

  Object.values(PRECIO_MODAL).forEach((id) => $(id).addEventListener('input', paintLmPrecio));
  $('lmOk').addEventListener('click', guardarLoteModal);
  $('lmCancel').addEventListener('click', closeLoteModal);
  $('loteModal').addEventListener('click', (e) => { if (e.target === $('loteModal')) closeLoteModal(); });
  $('loteModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLoteModal();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') guardarLoteModal();
  });
}
