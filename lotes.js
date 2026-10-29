/* EtiquetApp - seccion Lotes.
   Lista de los lotes registrados (pestana Lotes) para consultarlos: fecha,
   producto y presentacion, vencimiento, paquetes, bolsas usadas e imagen.
   Solo lectura: los lotes se registran y se corrigen en Etiquetas (Registro
   de lotes). Usa cloud (cloud.js) y las utilidades de bolsas.js. */

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
}
