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
   el peso del paquete. Los cuatro valores son de cada lote. */
const PRECIO_CAMPOS = { empaque: 'lpEmpaque', etiqueta: 'lpEtiqueta', agregado: 'lpAgregado', ganancia: 'lpGanancia' };
const KG_UNIDAD = { mg: 1e-6, gr: 0.001, kg: 1 };
const redondo = (n) => String(Math.round(n * 100) / 100);

/* Lee los cuatro campos (vacio cuenta como 0) y marca los que no sirven.
   Devuelve { valores, error }. */
function leerPrecioLote() {
  const valores = {};
  let error = '';
  Object.entries(PRECIO_CAMPOS).forEach(([k, id]) => {
    const txt = String($(id).value || '').trim();
    const n = txt ? leerDecimal(txt, k !== 'ganancia') : 0;
    const mal = n === null || (k === 'ganancia' && n >= 100);
    $(id).closest('.field').classList.toggle('missing', mal);
    if (mal && !error) error = k === 'ganancia' ? 'La ganancia es un porcentaje menor que 100.' : `El precio de ${k} no es un numero.`;
    valores[k] = mal ? null : n;
  });
  return { valores, error };
}

/* Devuelve { ok, msg } o { ok, granel, bolsa, varias, kg, porKg, costo, precio }. */
function calcPrecioLote(valores) {
  const l = currentLabel();
  const kg = (Number(String(l.cantidad || '').replace(',', '.')) || 0) * (KG_UNIDAD[l.unidad] || 0);
  if (!kg) return { ok: false, msg: 'Para calcular el granel, la presentacion tiene que estar en gramos o kilos.' };
  const bolsas = [...loteBolsasSel].map((id) => cloud.bolsas.find((b) => b.id === id)).filter(Boolean);
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

function paintPrecioLote() {
  const box = $('lpCalc');
  if (!box) return;
  const lote = currentLote();
  Object.values(PRECIO_CAMPOS).forEach((id) => { $(id).disabled = !lote; });
  box.innerHTML = '';
  if (!lote) return;
  const { valores, error } = leerPrecioLote();
  const r = error ? { ok: false, msg: error } : calcPrecioLote(valores);
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
}

/* Columnas del precio para la fila del lote, o null si algun campo no sirve.
   Si falta algo para calcular (bolsa sin precio), quedan los valores
   cargados y el costo y el precio vacios. */
function precioLoteRow() {
  const { valores, error } = leerPrecioLote();
  if (error) return null;
  const r = calcPrecioLote(valores);
  const campo = (k) => (String($(PRECIO_CAMPOS[k]).value || '').trim() ? redondo(valores[k]) : '');
  return {
    empaque: campo('empaque'), etiqueta: campo('etiqueta'), agregado: campo('agregado'), ganancia: campo('ganancia'),
    costoGranel: r.ok ? redondo(r.granel) : '', costo: r.ok ? redondo(r.costo) : '', precio: r.ok ? redondo(r.precio) : ''
  };
}

/* Al pasar a otro lote: los valores guardados del lote o, si es nuevo, los
   del ultimo lote registrado de la misma presentacion. */
function precioLoteDesde(reg) {
  const codigo = String(currentLabel().codigo || '').trim();
  const conPrecio = (x) => Object.keys(PRECIO_CAMPOS).some((k) => String(x[k] ?? '') !== '');
  const base = reg || (codigo ? cloud.lotes
    .filter((x) => String(x.codigo) === codigo && x.lote !== currentLote() && conPrecio(x))
    .sort((a, b) => fechaLote(b).localeCompare(fechaLote(a)) || String(b.actualizado).localeCompare(String(a.actualizado)))[0] : null);
  Object.entries(PRECIO_CAMPOS).forEach(([k, id]) => {
    $(id).value = base ? decimalUY(base[k] ?? '') : '';
    $(id).closest('.field').classList.remove('missing');
  });
  $('lpOrigen').textContent = !reg && base ? `Valores copiados del lote ${base.lote}: revisalos.` : '';
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
    card.appendChild(info);
    cont.appendChild(card);
  });
}

function bindLotesEvents() {
  $('lBuscar').addEventListener('input', renderLotesList);
  $('lPeriodo').addEventListener('change', renderLotesList);
  Object.values(PRECIO_CAMPOS).forEach((id) => $(id).addEventListener('input', paintPrecioLote));
}
