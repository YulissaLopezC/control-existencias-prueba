// Fotos de albaranes: oficina y el chófer de cada almacén. «Leer y comprobar» (IA), EN PRUEBAS: solo «dev».
// Paso C: hacer las fotos del albarán (una por página), guardarlas en Drive con el
// script de Google (automatico/lector-albaranes.gs) y dejar el registro en
// dias/{fecha}/albaranes/{id}. No toca la recogida ni nada más del día.
// «Leer y comprobar»: el script lee las fotos con IA y relaciona cada línea con la lista del
// almacén; la cuenta final (✓ / ⚠ / ✗ / ?) la hace comparar() aquí, no la IA.
import { db, auth, doc, collection, setDoc, onSnapshot, MODO } from './fb.js?v=29';
import './visor.js?v=1'; // «Ver 1, Ver 2…» se abren dentro de la app

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVvZly3YpUWv5W-vFE8PZT1y0Pf2zZhLpNcDmPLLlMcg0gnNpzDDE_ln-dB0tuGQA/exec';
const LADO_MAX = 1600;   // píxeles del lado largo de cada foto
const CALIDAD = 0.72;    // calidad JPEG (≈ 200–400 KB por foto)
const MAX_FOTOS = 10;

let ctx = null;               // lo que pasa app.js: getFecha, firma, toast, puede(g), listaDe(g)
let albs = {}, subFecha = null, unsub = null;
let abierto = null;           // { g, fotos: [{ blob, url }] }
let enviando = false;
let leyendo = null;           // id del albarán que se está leyendo
const abiertos = new Set();   // albaranes con el detalle desplegado

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
// Sesión caducada: pasa, por ejemplo, después de lanzar «Crear usuarios» (cambia las contraseñas).
const SESION = /auth\/(user-token-expired|invalid-user-token|user-disabled|requires-recent-login)/;
const msgSesion = 'Tu sesión ha caducado. Sal de la app («Salir») y vuelve a entrar.';
const delAlmacen = g => Object.entries(albs).filter(([, a]) => a.g === g).sort((a, b) => String(a[1].ts).localeCompare(String(b[1].ts)));

export function initAlbaran(c) {
  ctx = c;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-alb]');
    if (b) { e.preventDefault(); abrir(b.dataset.alb); }
  });
}

// Botón para el pie de cada almacén de Recogida (app.js lo pone para oficina, el chófer del almacén y «dev»).
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
    completarPendientes(fecha);
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
    if (e.target.closest('[data-alb-guardar]')) { guardar(); return; }
    const l = e.target.closest('[data-alb-leer]');
    if (l) { leer(l.dataset.albLeer); return; }
    const v = e.target.closest('[data-alb-ver]');
    if (v) { const id = v.dataset.albVer; abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); pintar(); }
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
  if (enviando || leyendo) return;
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
    ? `<h3 class="alb-sub">Guardados hoy</h3><ul class="alb-lista">${hechos.map(([id, a]) => fichaAlbaran(id, a, hechos)).join('')}</ul>`
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
const ESTADOS = { correcto: ['✓', 'Correcto en códigos y cantidades', 'alb-ok'], diferencias: ['⚠', 'Con diferencias', 'alb-dif'], pendiente: ['?', 'Pendiente de revisar', 'alb-rev'] };
const ICONO = { ok: ['✓', 'alb-ok'], diferencia: ['⚠', 'alb-dif'], falta: ['✗', 'alb-dif'], sobra: ['＋', 'alb-dif'], revisar: ['?', 'alb-rev'] };
const nf = n => n == null || n === '' || isNaN(n) ? '—' : String(+Number(n).toFixed(3)).replace('.', ',');
const eur = n => n == null ? 'no figura' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

function fichaAlbaran(id, a, hechos) {
  const fotos = `<span class="alb-links">${a.fotos.map((f, i) => `<button type="button" class="alb-ver-foto" data-foto="${esc(f.id)}" data-foto-tit="Albarán ${esc(a.g)} · pág. ${i + 1}">Ver ${i + 1}</button>`).join(' ')}</span>`;
  const cab = `<div class="alb-fila"><span>${esc(hora(a.ts))} · ${esc(a.nombre)} · ${a.fotos.length} foto${a.fotos.length === 1 ? '' : 's'}</span>${fotos}</div>`;
  if (!a.comparacion) {
    if (leyendo === id || enCurso(a)) return `<li>${cab}<p class="alb-leyendo">⏳ Leyendo con IA… Puedes cerrar esta ventana: el resultado aparecerá aquí solo.</p></li>`;
    if (!ctx.puedeLeer || !ctx.puedeLeer()) return `<li>${cab}</li>`;
    return `<li>${cab}<button type="button" class="btn sm alb-leer" data-alb-leer="${esc(id)}" ${leyendo ? 'disabled' : ''}>🔎 Leer y comprobar</button></li>`;
  }
  const L = a.lectura || {}, C = a.comparacion, [ic, tx, cl] = ESTADOS[C.estado] || ESTADOS.pendiente;
  const dup = L.numero && hechos.find(([id2, b]) => id2 !== id && b.lectura && b.lectura.numero && String(b.lectura.numero).trim() === String(L.numero).trim());
  const abierto = abiertos.has(id);
  return `<li>${cab}
    <div class="alb-res ${cl}"><b>${ic} ${tx}</b> <small>${C.ok} bien · ${C.dif} con diferencias · ${C.rev} por revisar</small></div>
    <div class="alb-datos">Nº <b>${esc(L.numero || '—')}</b> · ${esc(L.fecha_doc || 'sin fecha')} · Importe ${esc(eur(L.importe_total))}${L.emisor ? ` · ${esc(L.emisor)}` : ''}${L.facturado_a_nombre_de ? ` (factura ${esc(L.facturado_a_nombre_de)})` : ''}</div>
    ${dup ? `<p class="alb-aviso">⚠ Este número de albarán ya se escaneó a las ${esc(hora(dup[1].ts))}.</p>` : ''}
    ${C.avisos && C.avisos.length ? C.avisos.map(t => `<p class="alb-aviso">⚠ ${esc(t)}</p>`).join('') : ''}
    <button type="button" class="alb-ver" data-alb-ver="${esc(id)}">${abierto ? 'Ocultar comparación ▲' : 'Ver comparación ▼'}</button>
    ${abierto ? tablaComparacion(C) : ''}
    <p class="small alb-ia">Leído con ${esc(a.modelo || 'IA')}. Las faltas pueden venir en otro albarán del mismo almacén.</p></li>`;
}
function tablaComparacion(C) {
  return `<table class="alb-tabla"><thead><tr><th></th><th>Artículo</th><th>Pedido</th><th>Albarán</th></tr></thead><tbody>${C.lineas.map(x => {
    const [ic, cl] = ICONO[x.estado] || ICONO.revisar;
    return `<tr class="${cl}"><td>${ic}</td><td><span class="alb-c">${esc(x.c || x.codigoAlb || '—')}</span> ${esc(x.d || '')}${x.nota ? `<small>${esc(x.nota)}</small>` : ''}</td><td>${nf(x.pedido)}</td><td>${nf(x.albaran)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// «Leyendo» dura como mucho 7 minutos (lo máximo que puede trabajar el script); después se puede reintentar.
const enCurso = a => a.estado === 'leyendo' && !a.lectura && a.leido && Date.now() - Date.parse(a.leido.ts) < 7 * 60 * 1000;

// Cuando la lectura llega (la guarda el script), la app hace la comparación y la guarda.
const completando = new Set();
function completarPendientes(fecha) {
  for (const [id, a] of Object.entries(albs)) {
    if (!a.lectura || a.comparacion || completando.has(id)) continue;
    if (!ctx || !ctx.puede(a.g)) continue;
    completando.add(id);
    const comparacion = comparar(a.lectura, ctx.listaDe(a.g));
    setDoc(doc(db, 'dias', fecha, 'albaranes', id), { comparacion, estado: comparacion.estado }, { merge: true })
      .then(() => { abiertos.add(id); if (abierto) pintar(); })
      .catch(e => { console.error(e); completando.delete(id); });
  }
}

// Cuenta final: lista del almacén frente a lo que leyó la IA. Solo códigos y cantidades.
export function comparar(lectura, lista) {
  const items = new Map(lista.map(p => [String(p.c), { c: String(p.c), d: p.d, pedido: Number(p.q) || 0, albaran: 0, n: 0, dudosa: false, sinCant: false, notas: [] }]));
  const sobran = [], avisos = [];
  for (const l of lectura.lineas || []) {
    const it = l.codigo_lista != null ? items.get(String(l.codigo_lista)) : null;
    if (!it) { sobran.push({ estado: l.confianza === 'baja' ? 'revisar' : 'sobra', codigoAlb: l.codigo, d: l.descripcion, pedido: null, albaran: l.cantidad_lista ?? l.unidades ?? l.piezas, nota: 'No está en la lista de este almacén' + (l.nota ? ' · ' + l.nota : '') }); continue; }
    it.n++;
    if (l.cantidad_lista == null || isNaN(l.cantidad_lista)) it.dudosa = it.sinCant = true; else it.albaran += Number(l.cantidad_lista);
    if (l.confianza === 'baja') it.dudosa = true;
    if (l.relacion === 'descripcion') it.notas.push(`relacionado por descripción («${l.descripcion}»)`);
    if (l.nota) it.notas.push(l.nota);
  }
  const lineas = [...items.values()].map(it => ({
    c: it.c, d: it.d, pedido: it.pedido, albaran: it.n && !it.sinCant ? it.albaran : null,
    estado: !it.n ? 'falta' : it.dudosa ? 'revisar' : Math.abs(it.albaran - it.pedido) < 0.001 ? 'ok' : 'diferencia',
    nota: it.notas.join(' · ') || null,
  })).concat(sobran);
  // Control con los totales del pie (si figuran y todo va en unidades).
  const tp = lectura.totales_pie || {}, uds = (lectura.lineas || []).map(l => l.unidades);
  if (tp.unidades != null && uds.length && uds.every(u => u != null)) {
    const suma = uds.reduce((s, u) => s + Number(u), 0);
    if (Math.abs(suma - tp.unidades) > 0.001) avisos.push(`La suma de las líneas (${nf(suma)} uds) no cuadra con el total del pie (${nf(tp.unidades)} uds): revisa la lectura.`);
  }
  const cuenta = e => lineas.filter(x => x.estado === e).length;
  const ok = cuenta('ok'), rev = cuenta('revisar'), dif = lineas.length - ok - rev;
  return { lineas, avisos, ok, dif, rev, estado: rev || avisos.length ? 'pendiente' : dif ? 'diferencias' : 'correcto' };
}

async function leer(id) {
  if (leyendo || enviando || !ctx.puedeLeer || !ctx.puedeLeer()) return;
  const a = albs[id], fecha = ctx.getFecha();
  if (!a || !fecha) return;
  if (MODO !== 'real') { error('Leer con IA solo funciona en la app real (no en modo prueba ni en local).'); return; }
  const user = auth.currentUser; if (!user) { error('Tienes que entrar con tu usuario.'); return; }
  const lista = ctx.listaDe(a.g);
  leyendo = id; error(''); pintar();
  let enviado = false;
  try {
    const token = await user.getIdToken(true);
    await setDoc(doc(db, 'dias', fecha, 'albaranes', id), { estado: 'leyendo', leido: ctx.firma() }, { merge: true });
    enviado = true;
    const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ token, accion: 'leer', id, fecha, g: a.g, fotos: a.fotos.map(f => f.id), lista }) });
    const res = await r.json().catch(() => ({ ok: false, error: 'Respuesta no válida del script de Google.' }));
    if (!res.ok) throw new Error(res.error || 'No se pudo leer el albarán.');
    // Normalmente el script ya la guardó; si no pudo, se guarda desde aquí.
    if (!(albs[id] && albs[id].lectura)) await setDoc(doc(db, 'dias', fecha, 'albaranes', id), { lectura: res.lectura, modelo: res.modelo || null }, { merge: true });
    ctx.toast('Albarán leído');
  } catch (e) {
    console.error(e);
    if (e && SESION.test(e.code || '')) { error(msgSesion); return; }
    const red = !e || !e.message || /Failed to fetch|NetworkError|Load failed|network/i.test(e.message);
    if (enviado && red) ctx.toast('Sigue leyendo; el resultado aparecerá solo');
    else {
      if (enviado) setDoc(doc(db, 'dias', fecha, 'albaranes', id), { estado: 'error-lectura' }, { merge: true }).catch(() => {});
      error(e && e.code === 'permission-denied'
        ? 'Falta publicar las reglas nuevas de Firebase.'
        : (e && e.message && !red ? e.message : 'No se pudo enviar. Revisa la conexión.'));
    }
  } finally { leyendo = null; pintar(); }
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
    error(e && SESION.test(e.code || '') ? msgSesion : e && e.code === 'permission-denied'
      ? 'Las fotos están en Drive, pero falta publicar las reglas nuevas de Firebase para guardar el registro.'
      : (e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'No se pudo enviar. Revisa la conexión.'));
  } finally {
    enviando = false; pintar();
  }
}
