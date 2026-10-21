/* Pone una version nueva en index.html antes de publicar.

   Uso:  node scripts/bump-version.js

   Cambia data-version del <html> y el ?v= de cada script y hoja de estilo
   propios. Asi el navegador baja los archivos nuevos en lugar de usar los
   que tiene en cache: GitHub Pages los deja guardar 10 minutos, y Chrome en
   el celular a veces los conserva bastante mas (por ejemplo, al restaurar
   una pestana). La version es la fecha y hora: AAAAMMDD-HHMM. */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const d = new Date();
const dos = (n) => String(n).padStart(2, '0');
const version = `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}`;

let html = fs.readFileSync(file, 'utf8');
html = html.replace(/<html lang="es"( data-version="[^"]*")?>/, `<html lang="es" data-version="${version}">`);
// Solo los archivos del sitio (rutas relativas), no el script de Google.
html = html.replace(/((?:src|href)=")(?!https?:)([^"?]+\.(?:js|css))(\?v=[^"]*)?"/g, `$1$2?v=${version}"`);
fs.writeFileSync(file, html);
console.log('version', version);
