/**
 * Lector de albaranes — Control de existencias (Distribuciones Antonio Viña)
 *
 * Recibe desde la app las fotos de un albarán y las guarda en Google Drive:
 *   CARPETA / AAAA-MM-DD / almacén / almacén_AAAA-MM-DD_HHMMSS_p1.jpg
 * Antes de guardar comprueba que quien envía ha entrado en la app (sesión de Firebase),
 * para que nadie de fuera pueda subir archivos.
 * Por ahora SOLO guarda las fotos. La lectura con IA se añadirá aquí más adelante.
 *
 * Es un script aparte: no tiene nada que ver con vigilante-google.gs.
 *
 * Instalación (una sola vez, con la cuenta de Google donde estará la carpeta o que tenga
 * permiso de Editor sobre ella):
 *   1. script.google.com → Proyecto nuevo → llamarlo «Lector de albaranes».
 *   2. Borrar lo que haya y pegar este archivo entero. Guardar.
 *   3. Configuración del proyecto (rueda) → Propiedades de la secuencia de comandos → Añadir:
 *        CARPETA_ID = el ID de la carpeta de Drive (lo que va después de /folders/ en su enlace)
 *   4. Elegir la función probarCarpeta → Ejecutar. Aceptar los permisos que pide Google.
 *      En «Registro de ejecución» debe salir «Carpeta OK: …».
 *   5. Implementar → Nueva implementación → tipo «Aplicación web»:
 *        Ejecutar como: Yo
 *        Quién tiene acceso: Cualquier usuario
 *      → Implementar → copiar la «URL de la aplicación web» y pasarla para ponerla en la app.
 *   («Cualquier usuario» es necesario para que la app llegue al script; la seguridad la da la
 *    comprobación de sesión de Firebase que hace el propio script.)
 *
 * Para cambiar a otra carpeta (p. ej. la de compras): solo cambiar CARPETA_ID. No hace falta
 * volver a implementar.
 * Si se cambia el código: Implementar → Gestionar implementaciones → editar (lápiz) →
 * Versión: «Nueva versión» → Implementar. Así la URL sigue siendo la misma.
 */

// Clave pública del proyecto Firebase (la misma de firebase-config.js; no es secreta).
const FIREBASE_API_KEY = 'AIzaSyDHL0jepTCOBG3MgkEgb7H4A1OIsr-nLR0';
const ZONA = 'Atlantic/Canary';      // la app trabaja con la hora de Canarias
const MAX_PAGINAS = 10;
const MAX_BYTES_PAGINA = 8 * 1024 * 1024;

/** La app comprueba con esto que el script responde. */
function doGet() {
  return json_({ ok: true, servicio: 'lector-albaranes' });
}

/**
 * La app envía (como texto, para evitar problemas de CORS):
 *   { token, fecha: 'AAAA-MM-DD', g: 'CA', paginas: ['<jpeg en base64>', ...] }
 * Responde: { ok: true, archivos: [{ id, nombre }] }  o  { ok: false, error: 'texto' }
 */
function doPost(e) {
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const uid = comprobarSesion_(p.token);
    if (!uid) return json_({ ok: false, error: 'Sesión no válida. Sal y vuelve a entrar en la app.' });

    const fecha = String(p.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json_({ ok: false, error: 'Fecha no válida.' });
    const g = String(p.g || '').replace(/[^A-Za-z0-9 _.\-]/g, '').trim().slice(0, 40);
    if (!g) return json_({ ok: false, error: 'Almacén no válido.' });
    const paginas = Array.isArray(p.paginas) ? p.paginas : [];
    if (!paginas.length) return json_({ ok: false, error: 'No llegó ninguna foto.' });
    if (paginas.length > MAX_PAGINAS) return json_({ ok: false, error: `Máximo ${MAX_PAGINAS} fotos por albarán.` });

    const carpeta = carpetaDe_(fecha, g);
    const hora = Utilities.formatDate(new Date(), ZONA, 'HHmmss');
    const archivos = paginas.map((b64, i) => {
      const bytes = Utilities.base64Decode(String(b64).replace(/^data:[^,]*,/, ''));
      if (bytes.length > MAX_BYTES_PAGINA) throw new Error(`La foto ${i + 1} es demasiado grande.`);
      const nombre = `${g}_${fecha}_${hora}_p${i + 1}.jpg`;
      const f = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', nombre));
      f.setDescription(`Subida desde la app por ${uid}`);
      return { id: f.getId(), nombre };
    });
    return json_({ ok: true, archivos });
  } catch (err) {
    console.error(err);
    const msg = /Access denied|not found|No item with the given ID/i.test(String(err))
      ? 'No se puede guardar en la carpeta de Drive (¿se dejó de compartir o cambió el CARPETA_ID?).'
      : 'No se pudo guardar: ' + (err && err.message ? err.message : err);
    return json_({ ok: false, error: msg });
  }
}

/** Ejecutar a mano desde el editor para comprobar que la carpeta está bien configurada. */
function probarCarpeta() {
  const raiz = DriveApp.getFolderById(carpetaId_());
  console.log('Carpeta OK: ' + raiz.getName());
}

/* ---------- interno ---------- */

function carpetaId_() {
  const id = PropertiesService.getScriptProperties().getProperty('CARPETA_ID');
  if (!id) throw new Error('Falta la propiedad CARPETA_ID en la configuración del script.');
  return id.trim();
}

// Devuelve la carpeta fecha/almacén, creándola si no existe. El candado evita carpetas
// repetidas si dos personas suben a la vez.
function carpetaDe_(fecha, g) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const raiz = DriveApp.getFolderById(carpetaId_());
    return sub_(sub_(raiz, fecha), g);
  } finally {
    lock.releaseLock();
  }
}
function sub_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

// Comprueba el token de sesión de Firebase. Devuelve el uid del usuario o null.
function comprobarSesion_(token) {
  if (!token) return null;
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: String(token) }),
  });
  if (r.getResponseCode() !== 200) return null;
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  return u && !u.disabled ? u.localId : null;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
