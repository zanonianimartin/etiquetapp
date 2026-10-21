/* ============================================================
   EtiquetApp — servicios del navegador
   ============================================================

   Reemplaza al puente de Electron (window.api) con APIs del navegador:
   mismos nombres y mismas respuestas, asi app.js no cambia de forma.
   La configuracion local (diseno, logo, zoom) queda en localStorage; los
   datos compartidos (catalogo, lotes) van a Google Sheets. */

const CONFIG_KEY = 'etiquetapp-config';
const LOGO_MAX = 3 * 1024 * 1024;   // en base64 crece 4/3 y localStorage ronda los 5 MB

/* Abre el selector de archivos del sistema. Resuelve null si se cancela. */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

let quotaWarned = false;

window.api = {
  async pickLogo() {
    const file = await pickFile('image/png,image/jpeg,image/svg+xml,image/gif,image/webp,image/bmp');
    if (!file || !file.type.startsWith('image/')) return null;
    if (file.size > LOGO_MAX) {
      toast('La imagen es demasiado grande (max 3 MB).', true);
      return null;
    }
    return { dataUrl: await readAsDataURL(file), name: file.name };
  },

  async loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    } catch {
      return null;
    }
  },

  /* Si el logo no entra en el espacio del navegador se guarda el resto de la
     configuracion igual: perder el logo al recargar es mejor que perder todo. */
  async saveConfig(data) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(data));
      return true;
    } catch {
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...data, logo: null }));
      } catch { return false; }
      if (!quotaWarned) {
        quotaWarned = true;
        toast('El logo es muy pesado para recordarlo en este navegador: al recargar vuelve el de fabrica.', true);
      }
      return false;
    }
  },

  async print() {
    window.print();
    return { success: true };
  }
};
