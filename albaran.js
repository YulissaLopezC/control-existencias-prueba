// Escanear albarán (EN PRUEBAS: solo lo ve quien tiene la marca «dev»).
// Paso C: hacer las fotos del albarán (una por página), guardarlas en Drive con el
// script de Google (automatico/lector-albaranes.gs) y dejar el registro en
// dias/{fecha}/albaranes/{id}. No toca la recogida ni nada más del día.
// La lectura con IA y la comparación con la lista vendrán en los pasos siguientes.
import { db, auth, doc, collection, setDoc, onSnapshot, MODO } from './fb.js?v=28';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVvZly3YpUWv5W-vFE8PZT1y0Pf2zZhLpNcDmPLLlMcg0gnNpzDDE_ln-dB0tuGQA/exec';
const LADO_MAX = 1600;   // píxeles del lado largo de cada foto
const CALIDAD = 0.72;    // calidad JPEG (≈ 200–400 KB por foto)
const MAX_FOTOS = 10;

let ctx = null;               // lo que pasa app.js: getFecha, firma, toast, puede(g)
let albs = {}, subFecha = null, unsub = null;
let abierto = null;           // { g, fotos: [{ blob, url }] }
let enviando = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const delAlmacen = g => Object.entries(albs).filter(([, a]) => a.g === g).sort((a, b) => String(a[1].ts).localeCompare(String(b[1].ts)));

export function initAlbaran(c) {
  ctx = c;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-alb]');
    if (b) { e.preventDefault(); abrir(b.dataset.alb); }
  });
}

// Botón para el pie de cada almacén de Recogida (app.js solo lo pone si esDev()).
export function botonAlbaran(g) {
  suscribir(ctx && ctx.getFecha());
  return `<button class="alb-btn" type="button" data-alb="${esc(g)}">📷 Albarán${etiqueta(g)}</button>`;
}
const etiqueta = g => { const n = delAlmacen(g).length; return n ? ` · ${n}` : ''; };

function suscribir(fecha) {
  if (fecha === subFecha) return;
  if (unsub) { unsub(); unsub = null; }
  albs = {}; subFecha = fecha;
  if (!fecha) return;
  unsub = onSnapshot(collection(db, 'dias', fecha, 'albaranes'), snap => {
    albs = {}; snap.forEach(x => albs[x.id] = x.data());
    document.querySelectorAll('[data-alb]').forEach(b => b.textContent = '📷 Albarán' + etiqueta(b.dataset.alb));
    if (abierto) pintar();
  }, e => console.error('albaranes', e));
}

/* ---------------- ventana ---------------- */
function caja() {
  let el = document.getElementById('alb-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'alb-modal'; el.className = 'alb-modal'; el.hidden = true;
  el.innerHTML = `<div class="alb-panel" role="dialog" aria-modal="true" aria-labelledby="alb-tit">
    <div class="alb-h"><h2 id="alb-tit"></h2><button type="button" class="alb-x" data-alb-cerrar aria-label="Cerrar">✕</button></div>
    <p class="alb-prueba">En pruebas · solo lo ves tú</p>
    <div class="alb-hechos"></div>
    <h3 class="alb-sub">Albarán nuevo</h3>
    <p class="hint alb-hint">Haz una foto por página, con el albarán entero y bien de luz.</p>
    <div class="alb-fotos"></div>
    <div class="btnrow">
      <label class="btn ghost sm alb-add">📷 Hacer foto<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn ghost sm alb-add">🖼 Galería<input type="file" accept="image/*" multiple hidden></label>
    </div>
    <p class="alb-err" hidden></p>
    <div class="btnrow alb-acc">
      <button type="button" class="btn" data-alb-guardar>Guardar albarán</button>
      <button type="button" class="btn ghost" data-alb-cerrar>Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-alb-cerrar]')) { cerrar(); return; }
    const q = e.target.closest('[data-alb-quitar]');
    if (q) { quitar(Number(q.dataset.albQuitar)); return; }
    if (e.target.closest('[data-alb-guardar]')) guardar();
  });
  el.addEventListener('change', e => {
    const inp = e.target.closest('input[type=file]'); if (!inp) return;
    añadir([...inp.files]); inp.value = '';
  });
  return el;
}

function abrir(g) {
  if (!ctx || !ctx.getFecha()) { ctx && ctx.toast('No hay día cargado'); return; }
  if (!ctx.puede(g)) { ctx.toast('Ese almacén no está asignado a ti'); return; }
  if (!abierto || abierto.g !== g) { limpiarFotos(); abierto = { g, fotos: [] }; }
  const el = caja(); el.hidden = false; document.body.classList.add('alb-abierto');
  pintar();
}
function cerrar() {
  if (enviando) return;
  const el = document.getElementById('alb-modal'); if (el) el.hidden = true;
  document.body.classList.remove('alb-abierto');
  // Las fotos sin guardar se mantienen por si se vuelve a abrir el mismo almacén.
}
function limpiarFotos() { if (abierto) abierto.fotos.forEach(f => URL.revokeObjectURL(f.url)); }

function pintar() {
  const el = caja(), g = abierto.g;
  el.querySelector('#alb-tit').textContent = `Albarán · Proveedor ${g}`;
  const hechos = delAlmacen(g);
  el.querySelector('.alb-hechos').innerHTML = hechos.length
    ? `<h3 class="alb-sub">Guardados hoy</h3><ul class="alb-lista">${hechos.map(([, a]) => `<li><span>${esc(hora(a.ts))} · ${esc(a.nombre)} · ${a.fotos.length} foto${a.fotos.length === 1 ? '' : 's'}</span><span class="alb-links">${a.fotos.map((f, i) => `<a href="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view" target="_blank" rel="noopener">Ver ${i + 1}</a>`).join(' ')}</span></li>`).join('')}</ul>`
    : '';
  const fs = abierto.fotos;
  el.querySelector('.alb-fotos').innerHTML = fs.length
    ? fs.map((f, i) => `<figure class="alb-foto"><img src="${f.url}" alt="Página ${i + 1}"><figcaption>Pág. ${i + 1}</figcaption><button type="button" data-alb-quitar="${i}" aria-label="Quitar página ${i + 1}">✕</button></figure>`).join('')
    : '<p class="small alb-vacio">Todavía no hay fotos.</p>';
  const gb = el.querySelector('[data-alb-guardar]');
  gb.disabled = !fs.length || enviando;
  gb.textContent = enviando ? 'Guardando…' : fs.length ? `Guardar albarán (${fs.length} foto${fs.length === 1 ? '' : 's'})` : 'Guardar albarán';
  el.querySelectorAll('.alb-add').forEach(l => l.classList.toggle('alb-off', enviando || fs.length >= MAX_FOTOS));
}
function error(t) { const p = caja().querySelector('.alb-err'); p.hidden = !t; p.textContent = t || ''; }

async function añadir(files) {
  error('');
  for (const f of files) {
    if (abierto.fotos.length >= MAX_FOTOS) { error(`Máximo ${MAX_FOTOS} fotos por albarán.`); break; }
    try { const blob = await comprimir(f); abierto.fotos.push({ blob, url: URL.createObjectURL(blob) }); }
    catch (e) { console.error(e); error('No se pudo leer una de las fotos.'); }
  }
  pintar();
}
function quitar(i) { const f = abierto.fotos.splice(i, 1)[0]; if (f) URL.revokeObjectURL(f.url); pintar(); }

// Reduce la foto (lado largo LADO_MAX, JPEG) para que suba rápido y ocupe poco en Drive.
async function comprimir(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); }); }
  const w = img.width, h = img.height, k = Math.min(1, LADO_MAX / Math.max(w, h));
  const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return await new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error('toBlob')), 'image/jpeg', CALIDAD));
}
const aBase64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });

async function guardar() {
  if (enviando || !abierto || !abierto.fotos.length) return;
  const fecha = ctx.getFecha(), g = abierto.g;
  if (!fecha) { error('No hay día cargado.'); return; }
  if (MODO !== 'real') { error('Guardar fotos solo funciona en la app real (no en modo prueba ni en local).'); return; }
  const user = auth.currentUser;
  if (!user) { error('Tienes que entrar con tu usuario.'); return; }
  enviando = true; error(''); pintar();
  try {
    const token = await user.getIdToken();
    const paginas = await Promise.all(abierto.fotos.map(f => aBase64(f.blob)));
    const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ token, fecha, g, paginas }) });
    const res = await r.json().catch(() => ({ ok: false, error: 'Respuesta no válida del script de Google.' }));
    if (!res.ok) throw new Error(res.error || 'No se pudo guardar en Drive.');
    const f = ctx.firma();
    const id = `${String(g).replace(/[^A-Za-z0-9_-]/g, '_')}__${Date.now()}`;
    await setDoc(doc(db, 'dias', fecha, 'albaranes', id), { g, fotos: res.archivos, estado: 'solo-fotos', nombre: f.nombre, uid: f.uid, ts: f.ts });
    limpiarFotos(); abierto.fotos = [];
    ctx.toast('Albarán guardado');
  } catch (e) {
    console.error(e);
    error(e && e.code === 'permission-denied'
      ? 'Las fotos están en Drive, pero falta publicar las reglas nuevas de Firebase para guardar el registro.'
      : (e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'No se pudo enviar. Revisa la conexión.'));
  } finally {
    enviando = false; pintar();
  }
}
