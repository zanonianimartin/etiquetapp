/* ============================================================
   EtiquetApp — configuracion del sitio
   ============================================================

   Estos dos valores no son secretos: el ID de cliente de OAuth es publico
   por diseno (Google solo lo acepta desde los origenes autorizados en la
   consola de Google Cloud) y el ID de la planilla no da acceso por si solo,
   cada usuario necesita permiso de edicion sobre ella en Google Drive. */

window.ETIQUETAPP_CONFIG = {
  /* ID de cliente OAuth (tipo "Aplicacion web") creado en
     https://console.cloud.google.com/apis/credentials
     Termina en ".apps.googleusercontent.com". */
  googleClientId: '',

  /* ID de la planilla del equipo (la parte entre "/d/" y "/edit" de su URL).
     Con este valor cargado todos los usuarios trabajan sobre esa planilla y
     la app no ofrece elegir ni crear otra. Vacio solo durante la puesta en
     marcha: deja crear la planilla una vez para despues copiar su ID aca. */
  spreadsheetId: ''
};
