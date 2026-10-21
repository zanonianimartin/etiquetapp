# EtiquetApp

Aplicación web para armar hojas A4 de etiquetas y mandarlas a imprimir. Es un sitio
estático (HTML + JavaScript, sin servidor ni compilación) pensado para publicarse en
GitHub Pages. El catálogo de códigos, las plantillas y el registro de lotes se guardan en
una única planilla de Google Sheets que usa todo el equipo, y las imágenes de los lotes en
una carpeta de Google Drive, con login de Google.

## Puesta en marcha

Se hace una sola vez. Hacen falta una cuenta de GitHub y una de Google.

### 1. Publicar el sitio en GitHub Pages

1. Crear un repositorio **público** en GitHub (por ejemplo `etiquetapp`). Con una cuenta
   gratuita, Pages solo publica repositorios públicos: el código queda visible, pero no
   contiene datos ni claves (ver `config.js`).
2. Subir el contenido de esta carpeta:
   ```
   git init
   git add .
   git commit -m "EtiquetApp web"
   git branch -M main
   git remote add origin https://github.com/USUARIO/etiquetapp.git
   git push -u origin main
   ```
3. En el repositorio: **Settings → Pages → Build and deployment**. Source: *Deploy from a
   branch*; Branch: `main`, carpeta `/ (root)`. Guardar.
4. Al minuto el sitio queda en `https://USUARIO.github.io/etiquetapp/`.

### 2. Crear el acceso a Google

En [console.cloud.google.com](https://console.cloud.google.com):

1. Crear un proyecto nuevo (por ejemplo "EtiquetApp").
2. **APIs y servicios → Biblioteca**: buscar y habilitar **Google Sheets API** y
   **Google Drive API**.
3. **Google Auth Platform** (pantalla de consentimiento OAuth):
   - *Información de la marca*: nombre de la app y mail de contacto.
   - *Público*: **Interno** si el equipo usa Google Workspace (entra cualquier cuenta de la
     organización). Si son cuentas @gmail, **Externo**, dejarlo en estado *Prueba* y
     agregar en *Usuarios de prueba* el mail de cada persona del equipo (hasta 100).
   - *Acceso a los datos*: agregar los permisos `.../auth/spreadsheets` y `.../auth/drive`.
     El de Drive es el completo (no `drive.file`) porque con `drive.file` cada persona solo
     ve las imágenes que subió ella misma. La app solo usa la carpeta de imágenes.
4. **Clientes → Crear cliente**: tipo **Aplicación web**. En *Orígenes autorizados de
   JavaScript* agregar `https://USUARIO.github.io` (sin la ruta del repositorio) y, para
   probar en la PC, `http://localhost:8080`. No hace falta ninguna URI de redireccionamiento.
5. Copiar el **ID de cliente** (termina en `.apps.googleusercontent.com`) en `config.js`,
   en `googleClientId`, y volver a subir el cambio a GitHub.

En estado *Prueba* Google muestra el aviso "Google no verificó esta app" al conectarse: es
esperable para una herramienta interna, se sigue con *Continuar*. La verificación de Google
solo hace falta para abrir la app a cualquier cuenta.

### 3. Crear la planilla del equipo

1. Entrar al sitio y tocar **Iniciar sesión con Google**.
2. En la ventana *Planilla de Google*, **Crear planilla nueva**. La app arma las pestañas
   y anota a quien la creó como **administrador** en la pestaña `Usuarios`.
3. Copiar el ID de la planilla (aparece en esa misma ventana) en `config.js`, en
   `spreadsheetId`, y subir el cambio a GitHub. **Todo el equipo usa esa planilla**: con el
   ID cargado, la app entra directo a ella y ya no ofrece elegir ni crear otra.
4. Instalar el script de permisos (ver abajo). Desde ese momento, para dar acceso a alguien
   alcanza con agregar su mail en la pestaña `Usuarios`: no hace falta compartir la planilla
   ni la carpeta de imágenes a mano.

La carpeta de imágenes (*EtiquetApp - imagenes de lotes*) la crea la app sola con la
primera foto, en la misma carpeta de Drive donde está la planilla, y anota su ID en la
pestaña `Ajustes` para que todos suban a la misma. Se puede mover a otra carpeta desde
Drive sin romper nada.

### 4. Quién puede entrar: la pestaña Usuarios

La app solo deja entrar a las cuentas de la pestaña `Usuarios`:

| email | nombre | rol | activo |
|---|---|---|---|
| ana@gmail.com | Ana | admin | SI |
| juan@gmail.com | Juan | usuario | |
| ex.empleado@gmail.com | Pedro | usuario | NO |

- **activo** vacío o `SI` habilita; `NO` deshabilita sin borrar la fila.
- **rol** `admin` puede editar la pestaña `Usuarios`; cualquier otro valor es un usuario común.
- Una cuenta que se quita o se pasa a `NO` queda afuera la próxima vez que la app relee la
  planilla (al volver a la pestaña o al recargar).

Ese control lo hace la app en el navegador, y se puede saltear modificando la página. Lo
que protege los datos de verdad es **con quién está compartida la planilla**. Para que la
pestaña `Usuarios` mande también sobre eso, hay que instalar el script
[`apps-script/usuarios.gs`](apps-script/usuarios.gs). Cada 5 minutos, y en cada cambio
hecho a mano en la planilla:

- comparte la planilla y la carpeta de imágenes como **Editor** con las cuentas activas y se
  las quita a las demás;
- deja la pestaña `Usuarios` editable solo por los administradores.

Instalación (la hace el dueño de la planilla, una sola vez):

1. En la planilla: **Extensiones → Apps Script**.
2. Borrar lo que haya en el editor, pegar el contenido de `apps-script/usuarios.gs` y
   guardar (ícono de disquete).
3. Arriba, elegir la función **instalar** y tocar **Ejecutar**. Google pide autorizar el
   acceso a la planilla y a Drive (para poder compartirla): aceptar.

> El script quita a cualquier editor que no figure en la lista, aunque se haya agregado a
> mano desde *Compartir*. Los lectores y comentadores no se tocan. El dueño de la planilla
> nunca pierde el acceso.

Como las cuentas se agregan desde la planilla, conviene publicar la app en Google Cloud
(*Google Auth Platform → Público → Publicar app*) en lugar de cargar cada mail también como
usuario de prueba. Sin la verificación de Google, la pantalla de login sigue mostrando el
aviso de "app no verificada" y admite hasta 100 cuentas.

### Migrar las plantillas de la versión de escritorio

La versión Electron guardaba las plantillas y el logo en
`%APPDATA%\etiquetapp\etiquetapp-config.json`. Se convierten a un proyecto (`.etq.json`)
y se abre con **Abrir** estando conectado: la app ofrece subir a la planilla las
plantillas que no estén (las compara por nombre) y toma el logo.

### Probar en la PC

El login de Google no funciona abriendo `index.html` con doble clic: hace falta servir la
carpeta por HTTP. Con Node.js instalado:

```
npx http-server -p 8080 -c-1
```

y abrir `http://localhost:8080` (tiene que estar entre los orígenes autorizados del paso 2).

## La planilla

La app crea cinco pestañas y encuentra cada columna por el nombre de la fila 1, así que se
pueden reordenar columnas o agregar columnas propias. Si falta una pestaña o una columna,
la app la agrega sola al conectarse.

| Pestaña | Una fila por | Columnas |
|---|---|---|
| `Catalogo` | producto | codigo, clave, tipo, producto, cantidad, unidad, ingredientes, infoExtra, nutri, actualizado, por |
| `Plantillas` | plantilla | id, nombre, producto, cantidad, unidad, codigo, ingredientes, infoExtra, nutri, diseno, actualizado, por |
| `Lotes` | lote | lote, codigo, producto, vencimiento, imagen, archivo, enlace, actualizado, por |
| `Usuarios` | cuenta habilitada | email, nombre, rol, activo, actualizado, por |
| `Ajustes` | valor compartido | clave, valor, actualizado, por |

- `nutri` es la tabla nutricional en formato JSON. Conviene editarla desde la app.
- `actualizado` y `por` se completan solos con la fecha y el mail de quien guardó.
- Las plantillas se identifican por `id`: una fila agregada a mano sin `id` se ignora.
- En `Lotes`, `imagen` es el ID del archivo en Drive, `archivo` el nombre original de la foto
  y `enlace` el link para abrirla desde la planilla.
- En `Ajustes`, `carpetaImagenes` es el ID de la carpeta de Drive de las imágenes.

Las fotos se suben a Drive tal cual (hasta 20 MB), sin recomprimirlas, con el nombre
`Lote <lote> - <archivo original>`. Al cambiar o quitar la imagen de un lote, la anterior va a
la papelera de Drive (se puede recuperar durante 30 días). Si la subió otra persona, Drive no
deja mandarla a la papelera: queda en la carpeta, desvinculada del lote.

## Qué hace

**Configuración por defecto.** Todas las etiquetas arrancan con:

| Ajuste | Valor |
|---|---|
| Hoja | Rotola A4 3/8 — 16 etiquetas (2 por casillero, 49.5 × 67.7 mm): 4 × 4, márgenes 13.1 / 13.1 / 6 / 6 mm, sin separación |
| Diseño | Dos columnas |
| Escala de texto | 130 % |
| Logo | Xilo, centrado horizontal, vertical 57 %, tamaño 80 %, intensidad de la marca de agua 14 % |
| Código de barras | CODE128, con el número debajo, altura 80 % |
| Bordes | con borde de corte, sin marcas en las esquinas |

Lo que se cambie queda guardado en el navegador. Cuando cambian estos valores por defecto
en una versión nueva de la app, cada navegador vuelve a ellos una vez.

**Formatos de hoja.** Preajustes de 1x1 hasta 5x8 (2x4 = 8 etiquetas, 4x4 = 16, 3x7 = 21,
4x10 = 40, etc.) o columnas y filas a mano. Los márgenes de la hoja y la separación entre
etiquetas se ajustan en milímetros; el panel muestra el tamaño real de cada etiqueta.
Opcionalmente imprime borde de corte y marcas de corte en los bordes de la hoja.

**Datos de la etiqueta.** Producto, cantidad, unidad (gr, kg, mg, ml, lt, cc, un), lote,
vencimiento y código de barras. **Los seis campos son obligatorios**: mientras falte alguno,
los botones *Imprimir* y *Exportar PDF* quedan deshabilitados y la barra superior indica qué
etiqueta y qué campo falta. En la vista previa, las etiquetas incompletas salen marcadas en
rojo y las que todavía no tienen datos en gris.

Hay además dos campos **opcionales**, que no bloquean la impresión y no se imprimen si
quedan vacíos:

- **Ingredientes.** Texto libre (hasta 400 caracteres, respeta los saltos de línea). Se
  imprime en la columna derecha de la etiqueta.
- **Información adicional.** Una línea (hasta 120 caracteres) que se imprime **justo encima
  del código de barras**. Pensado para leyendas del tipo
  "Industria Uruguaya" o "Conservar en lugar fresco y seco".

Los dos describen al producto y no a la tirada, así que se guardan junto con las
**plantillas** (a diferencia del lote y el vencimiento).

**Cantidad de etiquetas.** Se escribe cuántas se quieren imprimir (1 a 2000) y la app arma
las hojas que hagan falta, replicando los datos automáticamente en cada etiqueta. Hay accesos
rápidos para 1 hoja, 50, 64 y 100. Bajar la cantidad no borra nada: los datos quedan
guardados y vuelven si se sube de nuevo. Los espacios que sobran en la última hoja se
imprimen en blanco.

Si hace falta editar una etiqueta suelta, se destilda *Aplicar los cambios a todas las
etiquetas* y se hace clic sobre la que se quiera cambiar (las flechas del teclado también
mueven la selección).

**Tabla nutricional** (opcional). Se carga elemento por elemento desde una ventana modal:
título, porción de referencia y una fila por nutriente con nombre, valor, unidad y %VD. Al
activarla se precarga el rótulo estándar (valor energético, carbohidratos, proteínas, grasas
totales, saturadas y trans, fibra y sodio) con los valores en blanco para completar; también
se pueden agregar o quitar filas a mano. La tabla se imprime **dentro** de la etiqueta, en
la mitad izquierda. Si el %VD queda
vacío en todas las filas, esa columna no se
imprime. Mientras la tabla esté activada no se puede imprimir con filas a medio cargar.

La tabla admite además dos aclaraciones opcionales, de hasta 200 caracteres cada una:

- **Pie dentro del recuadro.** Va debajo de las filas, separado por una línea, con letra
  más chica que los datos.
- **Nota debajo de la tabla.** Va fuera del recuadro, sin borde y con letra todavía más
  chica que el pie, para que se lea como aclaración al margen.

Se pueden usar las dos o solo una; la que quede vacía no imprime nada. Cada una tiene un
botón que carga la frase de la **declaración nutricional simplificada** —"No aporta
cantidades significativas de …"— como punto de partida: queda completarla con el valor
energético y/o los nutrientes que correspondan a cada producto. Si la tabla está
desactivada no se imprime ninguna de las dos.

**Plantillas guardadas.** *Guardar datos actuales como plantilla* archiva producto, cantidad,
unidad, código, ingredientes, información adicional y tabla nutricional con un
nombre. **No guarda el lote ni el
vencimiento**, porque cambian en cada tirada. Al aplicar una plantilla se completan los datos
del producto y hay que cargar esos dos campos. Las plantillas se guardan en la planilla de
Google, así que las ve todo el equipo; para usarlas hay que estar conectado. Guardar con un
nombre que ya existe (sin distinguir mayúsculas) actualiza esa plantilla.

Las plantillas guardadas antes de que existieran los campos *ingredientes* e *información
adicional* no los traen. Al aplicarlas **se respeta lo que ya tenga la etiqueta** en vez de
borrarlo; solo se limpian si la plantilla los guardó explícitamente vacíos.

**Catálogo de productos** (requiere conexión con Google). Cada producto se da de alta con
**Nuevo producto…**, que pide una **clave de 5 caracteres** (por ejemplo `sal1k` o `pb250`).
El código de barras sale de esa clave con la misma cuenta que la función
`=TEXTO_A_DECIMAL()` de Apps Script de la planilla: cada carácter es un dígito en base 256 y
el resultado se completa con ceros a la izquierda hasta 13 dígitos (`sal1k` →
`0495555719531`). Se imprime como **CODE128**, porque ese último dígito no es un
verificador EAN válido. La ventana muestra el código dibujado mientras se escribe la clave y
no deja crear una clave repetida. La clave:

- lleva exactamente 5 caracteres, sin tildes ni ñ y sin espacios al principio o al final;
- distingue mayúsculas de minúsculas (`sal1k` y `SAL1K` dan códigos distintos; la app avisa
  si se carga una que solo difiere en eso).

El alta parte de los datos de la etiqueta seleccionada (producto, cantidad, unidad,
ingredientes, información adicional y tabla nutricional) y al terminar deja el producto
cargado en la etiqueta. *Guardar etiqueta actual en el catálogo* actualiza un producto que
ya existe con lo que tenga la etiqueta (por ejemplo, una tabla nutricional nueva), sin
tocar su clave.

Elegir un producto —desde el buscador, por clave, código o nombre, o directamente en el
campo *Código de barras*— completa todo **menos el lote y el vencimiento**.

**Los cambios se guardan solos.** Una etiqueta cuyo código está en el catálogo queda
vinculada a ese producto (el panel del catálogo lo indica). Lo que se cambie en sus datos
—producto, cantidad, unidad, ingredientes, información adicional o tabla nutricional— se
guarda en la planilla un segundo después de dejar de escribir, y lo ve todo el equipo. El
lote y el vencimiento no se guardan en el producto, y la clave y el código nunca cambian.
Si el producto o la cantidad quedan vacíos, no se guarda nada hasta completarlos. Cambiar
el código de la etiqueta no edita el producto: pasa a otro producto, o a ninguno.

**Registro de lotes** (requiere conexión con Google). Asocia el lote de la etiqueta
seleccionada con su código, producto y vencimiento, y opcionalmente con una imagen de
registro (por ejemplo, una foto de la tirada), que se guarda en la carpeta del equipo en
Google Drive. **La imagen no se imprime**: se ve en el panel y, con un clic, se abre en Drive.
Cambiar la imagen reemplaza la anterior. El campo *Lote*
sugiere los lotes ya registrados.

**Datos compartidos.** Con varias personas trabajando a la vez, cada guardado relee la
planilla antes de escribir, para no pisar filas que otro haya agregado o borrado. Las listas
se refrescan solas al volver a la pestaña (si pasó más de un minuto) o con *Actualizar
datos* en la ventana de la planilla.

**Aviso de contenido recortado.** Si lo cargado no entra en la etiqueta —lo habitual al activar
la tabla nutricional en grillas chicas— la barra sobre la vista previa avisa cuántas etiquetas
se van a imprimir recortadas y esas etiquetas se marcan en ámbar. No bloquea la impresión: se
resuelve bajando la escala de texto, usando menos filas y columnas o achicando la tabla.

**Diseño de etiqueta: Dos columnas.** Es el único diseño. El logo va de fondo, atenuado, y
los datos encima: producto, cantidad, lote y vencimiento arriba; en el medio el cuerpo
partido en dos mitades, con la tabla nutricional a la izquierda y los ingredientes a la
derecha; abajo la información adicional y el código de barras. Las dos mitades son
**50 % y 50 %** y se estiran al mismo alto, así el bloque queda parejo aunque la lista de
ingredientes sea corta. Si falta uno de los dos —no hay tabla, o no hay ingredientes— el que
quede **ocupa el ancho completo** en lugar de dejar media etiqueta vacía. Conviene vigilar el
aviso de contenido recortado cuando la tabla nutricional es larga.

Las plantillas, configuraciones o proyectos que traigan otro diseño (de versiones
anteriores, que tenían seis) se abren con este. El código de los otros cinco diseños sigue en
`app.js` y `styles.css`, pero ya no se puede elegir.

La **intensidad** del logo de fondo (4 % a 40 %, por defecto 14 %) gradúa cuánto se nota
según el logo que se use. El fondo se dibuja como imagen y no como fondo CSS, así que sale
impreso siempre, sin depender de la opción "imprimir fondos" del driver de la impresora.

**Logo.** Por defecto usa el logo de Xilo (`assets/logo-xilo.png`) y se reemplaza por cualquier
PNG, JPG, SVG, GIF, WEBP o BMP de hasta 3 MB. El logo elegido, igual que el formato de hoja,
el diseño y el zoom, queda guardado **en este navegador** (cada computadora recuerda el suyo).
Se puede ocultar o escalar del 40 % al 180 %.

**Posición del logo.** Dos sliders, horizontal y vertical, lo mueven libremente por la
etiqueta (0 a 100 en cada eje, de a 1). Mueven el logo de fondo, que se superpone a los
datos a propósito.

La caja del logo se calcula con la proporción real del archivo, así que ocupa exactamente
lo que la imagen necesita, sin márgenes muertos, y nunca se sale de la etiqueta.

**Códigos de barras.** CODE128 (por defecto), EAN-13, EAN-8, UPC-A, CODE39 e ITF-14.
Valida largo y dígito verificador, y cuando está mal indica cuál debería ser. Si se cargan
12 dígitos en un EAN-13, el dígito verificador se calcula solo.

**Carga por lista** (opcional, solo si hacen falta productos distintos en la misma tirada).
Una línea por producto con el formato

```
producto | cantidad | unidad | lote | vencimiento | código | cantidad de etiquetas
```

y la app reparte las etiquetas en las hojas que hagan falta. Si una línea queda incompleta,
lo avisa y no deja imprimir. También hay numeración correlativa de lotes (prefijo + contador
con relleno de ceros), útil para tiradas donde cada etiqueta lleva un lote distinto.

**Salida.** *Imprimir* abre el diálogo de impresión del navegador. *Exportar PDF* abre el
mismo diálogo: hay que elegir **Guardar como PDF** como destino. En ambos casos conviene
dejar los márgenes en *Ninguno* y la escala en 100 % si el navegador los ofrece. *Guardar*
descarga el proyecto como `etiquetas.etq.json` y *Abrir* lo vuelve a cargar.

## Estructura

```
index.html                   interfaz
styles.css                   UI + hoja A4 en mm + estilos de impresión
app.js                       estado, render de etiquetas, códigos de barras
config.js                    ID de cliente de Google y planilla por defecto
google.js                    login de Google y acceso a las APIs de Sheets y Drive
cloud.js                     catálogo, plantillas y lotes contra la planilla
browser-api.js               archivos, impresión y configuración local del navegador
apps-script/usuarios.gs      script de la planilla: permisos según la pestaña Usuarios
assets/logo-xilo.png         logo por defecto (Xilo)
vendor/JsBarcode.all.min.js
```

Toda la hoja se maquetea en milímetros con `@page { size: A4; margin: 0 }`, así que lo que
se ve en pantalla es lo que sale impreso.

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl` + `P` | Imprimir |
| `Ctrl` + `S` | Guardar proyecto |
| Flechas | Mover la selección de etiqueta |
| Rueda del mouse | Ajustar un campo numérico (hay que hacer clic en el campo primero) |
| `Shift` + rueda | Igual, pero de a 10 |
| `Ctrl` + rueda | Zoom de la vista previa |
