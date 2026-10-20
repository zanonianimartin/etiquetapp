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

  /* Opcional: ID de la planilla compartida del equipo (la parte entre
     "/d/" y "/edit" de su URL). Si queda vacio, cada usuario la elige o la
     crea desde la app la primera vez que se conecta. */
  spreadsheetId: ''
};
