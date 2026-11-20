/**
 * Lector de albaranes — Control de existencias (Distribuciones Antonio Viña)
 *
 * Recibe desde la app las fotos de un albarán y las guarda en Google Drive:
 *   CARPETA / AAAA-MM-DD / almacén / almacén_AAAA-MM-DD_HHMMSS_p1.jpg
 * Antes de guardar comprueba que quien envía ha entrado en la app (sesión de Firebase),
 * para que nadie de fuera pueda subir archivos.
 * También LEE el albarán con IA (EN PRUEBAS, con Gemini): recibe la lista de ese almacén,
 * lee las fotos ya guardadas y devuelve las líneas relacionadas con la lista. La cuenta final
 * (correcto / diferencias / revisar) la hace la app, no la IA.
 * Toda la llamada a la IA está en leerConIA_(): para cambiar de IA solo se cambia esa función.
 *
 * Es un script aparte: no tiene nada que ver con vigilante-google.gs.
 *
 * Instalación (una sola vez, con la cuenta de Google donde estará la carpeta o que tenga
 * permiso de Editor sobre ella):
 *   1. script.google.com → Proyecto nuevo → llamarlo «Lector de albaranes».
 *   2. Borrar lo que haya y pegar este archivo entero. Guardar.
 *   3. Configuración del proyecto (rueda) → Propiedades de la secuencia de comandos → Añadir:
 *        CARPETA_ID = el ID de la carpeta de Drive (lo que va después de /folders/ en su enlace)
        GEMINI_API_KEY = la clave de Gemini (aistudio.google.com → Get API key). Nunca en el repo.
        GEMINI_MODELO = (opcional) el modelo de Gemini; si no se pone, gemini-flash-latest
        GEMINI_PENSAR = (opcional) cuánto «piensa» Gemini: minimal, low, medium o high; por defecto low
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
const FIREBASE_PROYECTO = 'control-existencias';
const ZONA = 'Atlantic/Canary';      // la app trabaja con la hora de Canarias
const MAX_PAGINAS = 10;
const MAX_BYTES_PAGINA = 8 * 1024 * 1024;

/** La app comprueba con esto que el script responde. */
function doGet() {
  return json_({ ok: true, servicio: 'lector-albaranes' });
}

/**
 * La app envía (como texto, para evitar problemas de CORS):
 *  Guardar fotos: { token, fecha: 'AAAA-MM-DD', g: 'CA', paginas: ['<jpeg en base64>', ...] }
 *     → { ok: true, archivos: [{ id, nombre }] }
 *  Leer con IA:   { token, accion: 'leer', id, fecha, g, fotos: ['<id de Drive>', ...], lista: [{ c, d, q, um }] }
 *     → { ok: true, lectura: {...}, modelo }
 *     Además guarda la lectura en el registro del albarán (dias/{fecha}/albaranes/{id}) con la
 *     sesión del usuario, así se guarda aunque el móvil deje de esperar la respuesta.
 *  Si algo falla: { ok: false, error: 'texto' }
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
    if (p.accion === 'leer') return json_(leer_(p, fecha, g));
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

/* ---------- lectura con IA ---------- */

// Lee las fotos (ya guardadas en Drive) de un albarán y las relaciona con la lista del almacén.
function leer_(p, fecha, g) {
  const ids = Array.isArray(p.fotos) ? p.fotos.slice(0, MAX_PAGINAS) : [];
  if (!ids.length) return { ok: false, error: 'No hay fotos que leer.' };
  const lista = (Array.isArray(p.lista) ? p.lista : []).slice(0, 400).map(x => ({
    c: String(x.c || '').slice(0, 40), d: String(x.d || '').slice(0, 120), q: Number(x.q) || 0, um: String(x.um || 'UNIDAD').slice(0, 10),
  }));
  // Solo se leen fotos de la carpeta de ese día y almacén.
  const carpeta = carpetaDe_(fecha, g);
  const imagenes = ids.map(id => {
    const f = DriveApp.getFileById(String(id));
    let dentro = false; const ps = f.getParents(); while (ps.hasNext()) if (ps.next().getId() === carpeta.getId()) dentro = true;
    if (!dentro) throw new Error('Una de las fotos no es de este almacén y día.');
    return { mime: f.getMimeType(), b64: Utilities.base64Encode(f.getBlob().getBytes()), nombre: f.getName() };
  });
  const r = leerConIA_(imagenes, lista, fecha);
  // Se guarda lo que respondió la IA junto a las fotos, para poder revisarlo o comparar IAs.
  try {
    const base = imagenes[0].nombre.replace(/_p1\.jpg$/i, '');
    carpeta.createFile(Utilities.newBlob(JSON.stringify(r, null, 1), 'application/json', `${base}_lectura_${r.modelo}.json`));
  } catch (e) { console.error(e); }
  // Guardar en el registro del albarán con la sesión del usuario (las reglas de Firebase deciden).
  const id = String(p.id || '');
  if (/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    try { guardarEnFirestore_(p.token, ['dias', fecha, 'albaranes', id], { lectura: r.lectura, modelo: r.modelo }); }
    catch (e) { console.error('Firestore', e); }
  }
  return { ok: true, lectura: r.lectura, modelo: r.modelo };
}

// Escribe campos en un documento de Firestore (API REST) con el token de sesión del usuario.
function guardarEnFirestore_(token, ruta, campos) {
  const mask = Object.keys(campos).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROYECTO}/databases/(default)/documents/${ruta.map(encodeURIComponent).join('/')}?${mask}&currentDocument.exists=true`;
  const fields = {}; Object.keys(campos).forEach(k => fields[k] = valorFS_(campos[k]));
  const r = UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify({ fields }) });
  if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 500));
}
function valorFS_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(x => Array.isArray(x) ? { stringValue: JSON.stringify(x) } : valorFS_(x)) } };
  const fields = {}; Object.keys(v).forEach(k => fields[k] = valorFS_(v[k]));
  return { mapValue: { fields } };
}

const INSTRUCCIONES = `Eres un asistente que lee albaranes de proveedores (España, Canarias) para un almacén de distribución.
Recibes las fotos de UN albarán (una por página) y la LISTA de artículos que había que recoger en ese proveedor.
Devuelve SOLO un JSON con esta forma:
{
 "numero": "nº de albarán o null", "fecha_doc": "AAAA-MM-DD o null", "emisor": "empresa que emite el documento o null",
 "facturado_a_nombre_de": "si el documento dice que factura otra empresa (p. ej. Unilever, Borges), su nombre; si no, null",
 "importe_total": número o null (null si no figura; 0 solo si pone 0,00),
 "totales_pie": { "unidades": número o null, "cajas": número o null, "kilos": número o null, "bultos": número o null },
 "lineas": [ {
   "codigo": "código tal cual aparece (texto, conserva ceros a la izquierda)", "descripcion": "texto",
   "cajas": número o null, "unidades": número o null, "piezas": número o null, "kilos": número o null,
   "precio": número o null,
   "codigo_lista": "el código EXACTO de la LISTA al que corresponde, o null si no corresponde a ninguno",
   "relacion": "codigo" | "sin_prefijo" | "descripcion" | null,
   "cantidad_lista": número o null,
   "confianza": "alta" | "media" | "baja",
   "nota": "texto corto o null"
 } ]
}
Reglas:
- Una línea por ARTÍCULO. Las líneas de lote, caducidad o el desglose de un mismo artículo en varios lotes NO son artículos nuevos: suma sus cantidades en una sola línea.
- Números con punto decimal (7,990 en el papel → 7.99). No inventes nada: si no se lee, pon null y confianza "baja".
- Relación con la LISTA: primero código igual; si no, el código de la lista puede llevar delante un prefijo de letras (CEN, UN…) y ceros a la izquierda: compara sin ellos ("sin_prefijo"); si no, por descripción, solo si es claramente el mismo producto ("descripcion", y como mucho confianza "media").
- cantidad_lista: la cantidad de esa línea expresada en la MISMA unidad que la lista. um "UNIDAD" = unidades sueltas (si el albarán da cajas y unidades por caja, conviértelo). um "EK" = piezas (no kilos): usa las piezas del albarán (en algunos van en la línea del lote, p. ej. "2,000 Unidades"); si el albarán solo trae kilos, pon null y explica en nota.
- Si un dato no es seguro, confianza "baja".`;

// ÚNICO sitio que habla con la IA. Devuelve { lectura, modelo }.
function leerConIA_(imagenes, lista, fecha) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Falta la propiedad GEMINI_API_KEY en la configuración del script.');
  const modelo = (props.getProperty('GEMINI_MODELO') || 'gemini-flash-latest').trim();
  const pensar = (props.getProperty('GEMINI_PENSAR') || 'low').trim();
  const contexto = `\n\nEl albarán es de una recogida del ${fecha || 'día de hoy'}. La fecha del documento suele ser ese día o unos días antes: si el año no se lee claro, no lo cambies, pon la fecha que leas y confianza en nota.`;
  const partes = [{ text: INSTRUCCIONES + contexto + '\n\nLISTA (JSON):\n' + JSON.stringify(lista) }]
    .concat(imagenes.map((im, i) => [{ text: `Página ${i + 1}:` }, { inline_data: { mime_type: im.mime || 'image/jpeg', data: im.b64 } }]).flat());
  const llamar = conPensar => UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: Object.assign({ responseMimeType: 'application/json' }, conPensar ? { thinkingConfig: { thinkingLevel: pensar } } : {}) }),
  });
  let r = llamar(true);
  // Si el modelo no admite el ajuste de «pensar», se repite sin él.
  if (r.getResponseCode() === 400 && /thinking/i.test(r.getContentText())) r = llamar(false);
  const code = r.getResponseCode(), txt = r.getContentText();
  if (code !== 200) {
    console.error(code, txt.slice(0, 2000));
    if (code === 429) throw new Error('La IA ha llegado a su límite de uso. Prueba en unos minutos.');
    if (code === 400 || code === 403) throw new Error('La IA rechazó la petición (¿clave GEMINI_API_KEY correcta?).');
    if (code === 404) throw new Error('No existe el modelo de IA configurado (GEMINI_MODELO).');
    throw new Error('La IA no respondió (código ' + code + ').');
  }
  const res = JSON.parse(txt);
  const cand = (res.candidates || [])[0];
  const texto = cand && cand.content && (cand.content.parts || []).map(x => x.text || '').join('');
  if (!texto) throw new Error('La IA no devolvió datos.');
  let lectura;
  try { lectura = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```\s*$/g, '')); }
  catch (e) { console.error(texto.slice(0, 2000)); throw new Error('La IA devolvió algo que no se pudo leer.'); }
  if (!lectura || !Array.isArray(lectura.lineas)) throw new Error('La IA no devolvió las líneas del albarán.');
  return { lectura, modelo: res.modelVersion || modelo };
}

/** Ejecutar a mano desde el editor para comprobar la clave y el modelo de la IA (sin fotos). */
function probarIA() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Falta GEMINI_API_KEY.');
  const modelo = (props.getProperty('GEMINI_MODELO') || 'gemini-flash-latest').trim();
  const r = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: OK' }] }] }),
  });
  console.log(r.getResponseCode() === 200 ? 'IA OK (' + modelo + '): ' + r.getContentText().slice(0, 300) : 'ERROR ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 500));
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
