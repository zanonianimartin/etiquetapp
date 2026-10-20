/* ============================================================
   EtiquetApp — permisos de la planilla segun la pestana Usuarios
   ============================================================

   La app web revisa la pestana Usuarios al iniciar sesion, pero ese control
   corre en el navegador y se puede saltear. Lo que protege los datos de
   verdad es con quien esta compartida la planilla. Este script hace que
   esa lista sea la unica fuente: cada 5 minutos, y cada vez que se edita
   la planilla a mano,

     - comparte la planilla y la carpeta de imagenes de los lotes como
       Editor con las cuentas activas,
     - le quita el permiso de edicion a las que no estan (o estan en NO),
     - deja la pestana Usuarios editable solo por los administradores.

   Instalacion (una sola vez, la hace el dueno de la planilla):
     1. En la planilla: Extensiones > Apps Script.
     2. Borrar lo que haya, pegar este archivo y guardar.
     3. Elegir la funcion "instalar" arriba y tocar Ejecutar. Google pide
        autorizar el acceso a la planilla y a Drive (para compartirla).

   Ojo: el script quita a cualquier editor que no figure en la lista,
   aunque se haya agregado a mano desde "Compartir". Los lectores y
   comentadores no se tocan. */

const PESTANA = 'Usuarios';
const INACTIVO = ['no', 'n', 'false', '0', 'inactivo'];

/* Crea los disparadores y hace la primera sincronizacion. Se puede volver a
   ejecutar sin duplicar nada. */
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'sincronizar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sincronizar').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  sincronizar();
}

function leerUsuarios(hoja) {
  const datos = hoja.getDataRange().getValues();
  const cab = (datos.shift() || []).map((h) => String(h).trim().toLowerCase());
  const iEmail = cab.indexOf('email');
  const iRol = cab.indexOf('rol');
  const iActivo = cab.indexOf('activo');
  if (iEmail < 0) return null;

  const activos = new Map();          // email -> rol
  datos.forEach((fila) => {
    const email = String(fila[iEmail] || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    const activo = iActivo < 0 ? '' : String(fila[iActivo] || '').trim().toLowerCase();
    if (INACTIVO.includes(activo)) return;
    const rol = iRol < 0 ? '' : String(fila[iRol] || '').trim().toLowerCase();
    activos.set(email, rol === 'admin' ? 'admin' : 'usuario');
  });
  return activos;
}

function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;   // ya hay otra sincronizacion corriendo
  try {
    const ss = SpreadsheetApp.getActive();
    const hoja = ss.getSheetByName(PESTANA);
    if (!hoja) return;
    const activos = leerUsuarios(hoja);
    // Una lista vacia o ilegible casi seguro es un error de carga: no se
    // deja la planilla sin nadie.
    if (!activos || !activos.size) return;

    const yo = Session.getEffectiveUser().getEmail().toLowerCase();
    const archivo = DriveApp.getFileById(ss.getId());
    const protegidos = sincronizarEditores(archivo, activos, yo);

    // La carpeta de imagenes de los lotes (la crea la app con la primera foto).
    const idCarpeta = leerAjuste(ss, 'carpetaImagenes');
    if (idCarpeta) {
      try {
        sincronizarEditores(DriveApp.getFolderById(idCarpeta), activos, yo);
      } catch (e) {
        console.warn('No se pudo sincronizar la carpeta de imagenes: ' + e);
      }
    }

    protegerPestana(hoja, activos, protegidos);
  } finally {
    lock.releaseLock();
  }
}

/* Deja como editores de `item` (archivo o carpeta de Drive) exactamente a
   las cuentas activas, sin tocar nunca al dueno ni a quien corre el script.
   Devuelve ese conjunto de cuentas intocables. */
function sincronizarEditores(item, activos, yo) {
  const owner = item.getOwner();
  const protegidos = new Set([owner ? owner.getEmail().toLowerCase() : '', yo]);
  const editores = item.getEditors().map((u) => u.getEmail().toLowerCase());
  activos.forEach((_rol, email) => {
    if (!editores.includes(email) && !protegidos.has(email)) item.addEditor(email);
  });
  editores.forEach((email) => {
    if (!activos.has(email) && !protegidos.has(email)) item.removeEditor(email);
  });
  return protegidos;
}

function leerAjuste(ss, clave) {
  const hoja = ss.getSheetByName('Ajustes');
  if (!hoja) return '';
  const datos = hoja.getDataRange().getValues();
  const cab = (datos.shift() || []).map((h) => String(h).trim().toLowerCase());
  const iClave = cab.indexOf('clave');
  const iValor = cab.indexOf('valor');
  if (iClave < 0 || iValor < 0) return '';
  const fila = datos.find((f) => String(f[iClave]).trim() === clave);
  return fila ? String(fila[iValor]).trim() : '';
}

/* Solo los administradores (y el dueno) pueden editar la pestana Usuarios:
   si no, cualquier usuario podria habilitar a quien quisiera. */
function protegerPestana(hoja, activos, protegidos) {
  const prot = hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || hoja.protect();
  prot.setDescription('EtiquetApp: solo administradores');
  if (prot.canDomainEdit()) prot.setDomainEdit(false);

  const admins = [...activos].filter(([, rol]) => rol === 'admin').map(([email]) => email);
  const actuales = prot.getEditors().map((u) => u.getEmail().toLowerCase());
  const sobran = actuales.filter((e) => !admins.includes(e) && !protegidos.has(e));
  const faltan = admins.filter((e) => !actuales.includes(e));
  if (sobran.length) prot.removeEditors(sobran);
  if (faltan.length) prot.addEditors(faltan);
}
