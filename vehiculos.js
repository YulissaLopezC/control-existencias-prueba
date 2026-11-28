// Vehículos (MAQUETA, fase 1: solo oficina).
// - Pestaña «Vehículos»: buscar y elegir vehículo → Repostaje (foto del ticket + km + nota),
//   Mantenimiento (km, documentación, foto de limpieza, incidencias con fotos) → historial.
//   Taller se ve pero aún no está hecho (fase 3).
// - Oficina → «Vehículos»: carga masiva pegando la lista y alta manual; los que no se usan se
//   desactivan (no se borran) para conservar su historial.
// Datos: vehiculos/{MATRICULA} y vehiculos/{MATRICULA}/registros/{id}.
// Fotos: se guardan en Drive con el mismo script de Google de los albaranes, en
// Vehículos / {matrícula} · {modelo} / Repostaje (acción «vehiculo» del script).
// Se manda también g por si el script aún no está actualizado (entonces va a la carpeta de albaranes).
import { db, auth, doc, collection, setDoc, onSnapshot, MODO } from './fb.js?v=29';
import './visor.js?v=1'; // «Ver foto» se abre dentro de la app

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVvZly3YpUWv5W-vFE8PZT1y0Pf2zZhLpNcDmPLLlMcg0gnNpzDDE_ln-dB0tuGQA/exec';
const LADO_MAX = 1600, CALIDAD = 0.72;

let ctx = null;                 // de app.js: firma(), toast(t), hoy()
let vehs = {}, unsubV = null, errV = false;
let regs = [], unsubR = null, regDe = null;
let pant = 'lista', sel = null, q = '';
let rep = { foto: null, km: '', nota: '', error: '', enviando: false };
const MAX_INC = 6;
const manVacio = () => ({ km: '', doc: '', lim: null, inc: '', fotos: [], desc: '', error: '', enviando: false });
let man = manVacio();
let pegado = null;              // vista previa de la carga masiva
let editando = null;            // matrícula que se está editando en Oficina
let elVista = null, elAdmin = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();
const idDe = mat => String(mat).toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtMat = mat => { const m = String(mat).toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^(\d{4})([A-Z]{3})$/); return m ? `${m[1]} ${m[2]}` : String(mat).toUpperCase().trim().replace(/\s+/g, ' '); };
const fmtKm = n => Number(n).toLocaleString('es-ES');
const cuando = ts => { const d = new Date(ts); return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };
const activos = () => Object.values(vehs).filter(v => v.activo !== false).sort((a, b) => (a.modelo + a.matricula).localeCompare(b.modelo + b.matricula, 'es'));
const SESION = /auth\/(user-token-expired|invalid-user-token|user-disabled|requires-recent-login)/;

export function initVehiculos(c) {
  ctx = c;
  document.addEventListener('click', clic);
  document.addEventListener('input', escribir);
  document.addEventListener('change', cambiar);
  suscribir();
}
function suscribir() {
  if (unsubV) return;
  unsubV = onSnapshot(collection(db, 'vehiculos'), s => { vehs = {}; s.forEach(x => vehs[x.id] = { ...x.data(), id: x.id }); errV = false; pintarTodo(); },
    e => { console.error('vehiculos', e); errV = true; pintarTodo(); });
}
function suscribirRegistros(id) {
  if (regDe === id) return;
  if (unsubR) { unsubR(); unsubR = null; }
  regs = []; regDe = id;
  if (!id) return;
  unsubR = onSnapshot(collection(db, 'vehiculos', id, 'registros'), s => {
    regs = []; s.forEach(x => regs.push({ ...x.data(), id: x.id }));
    regs.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    if (elVista && (pant === 'veh' || pant === 'hist')) pintar();
  }, e => console.error('registros', e));
}
function pintarTodo() { if (elVista) pintar(); if (elAdmin) pintarAdmin(); }

/* ================= pestaña Vehículos ================= */
export function renderVista(el) { elVista = el; pintar(); }
function pintar() {
  const el = elVista; if (!el) return;
  if (errV) { el.innerHTML = '<div class="empty"><p>No se pudo leer la lista de vehículos. Revisa que estén publicadas las reglas de Firebase.</p></div>'; return; }
  const v = sel && vehs[sel];
  if (pant !== 'lista' && !v) pant = 'lista';
  el.innerHTML = `<p class="veh-maq">Maqueta · solo la ve oficina</p>` + (pant === 'lista' ? pLista() : pant === 'veh' ? pVeh(v) : pant === 'rep' ? pRep(v) : pant === 'man' ? pMan(v) : pHist(v));
  if (pant === 'lista') pintarLista();
}
const atras = (a, t) => `<button type="button" class="veh-atras" data-veh-ir="${a}">‹ ${esc(t)}</button>`;
const cab = v => `<h2 class="veh-tit">${esc(v.modelo)}</h2><p class="veh-sub">${esc(v.matricula)}</p>`;

function pLista() {
  return `<div class="veh-cab"><h2 class="veh-tit">Vehículos</h2><span class="small" id="veh-n"></span></div>
    <div class="veh-q"><input class="field" id="veh-q" type="text" enterkeyhint="search" placeholder="Buscar por modelo o matrícula" autocomplete="off" value="${esc(q)}" aria-label="Buscar vehículo">
    <button type="button" class="veh-q-x" data-veh-borrar aria-label="Borrar búsqueda" ${q ? '' : 'hidden'}>✕</button></div>
    <div id="veh-lista" class="veh-lista"></div>`;
}
function pintarLista() {
  const box = document.getElementById('veh-lista'); if (!box) return;
  const t = norm(q), todos = activos(), r = todos.filter(v => !t || norm(v.modelo + v.matricula).includes(t));
  const n = document.getElementById('veh-n'); if (n) n.textContent = t ? `${r.length} de ${todos.length}` : `${todos.length} vehículo${todos.length === 1 ? '' : 's'}`;
  const x = document.querySelector('[data-veh-borrar]'); if (x) x.hidden = !q;
  if (!todos.length) { box.innerHTML = '<div class="empty"><p>Todavía no hay vehículos. Añádelos en Oficina → Vehículos.</p></div>'; return; }
  box.innerHTML = r.length ? r.map(v => `<button type="button" class="veh-fila" data-veh-sel="${esc(v.id)}"><span><b>${esc(v.modelo)} · ${esc(v.matricula)}</b></span><span class="car">›</span></button>`).join('')
    : `<div class="empty"><p>No hay ningún vehículo con «${esc(q)}».</p></div>`;
}
function pVeh(v) {
  const n = regs.length;
  return `${atras('lista', 'Vehículos')}${cab(v)}
    <div class="veh-acc">
      <button type="button" class="veh-big rep" data-veh-ir="rep"><span class="veh-ico">⛽</span>Repostaje</button>
      <button type="button" class="veh-big tal" data-veh-pronto="Taller"><span class="veh-ico">🔧</span>Taller<small>Próximamente</small></button>
      <button type="button" class="veh-big man" data-veh-ir="man"><span class="veh-ico">⚙️</span>Mantenimiento</button>
    </div>
    <button type="button" class="veh-atras" data-veh-ir="hist">🕘 Ver historial${n ? ` (${n} registro${n === 1 ? '' : 's'})` : ''}</button>`;
}
function pRep(v) {
  const ult = ultimoKm();
  const f = rep.foto;
  return `${atras('veh', v.modelo)}<h2 class="veh-tit">Repostaje</h2><p class="veh-sub">${esc(v.modelo)} · ${esc(v.matricula)}</p>
    <div class="card veh-form">
      ${f ? `<figure class="veh-foto"><img src="${f.url}" alt="Foto del ticket"><button type="button" data-veh-quitar aria-label="Quitar foto">✕</button></figure>`
          : `<label class="veh-camara">📷 Foto del ticket<input type="file" accept="image/*" capture="environment" id="veh-foto" hidden></label>`}
      <label>Kilometraje<input class="field" id="veh-km" type="number" inputmode="numeric" min="0" step="1" value="${esc(rep.km)}" placeholder="Ej. 184320"></label>
      ${ult ? `<p class="hint" style="margin:0">Último registrado: ${fmtKm(ult.km)} km (${esc(cuando(ult.ts))}).</p>` : ''}
      <label>Nota (opcional)<textarea class="field veh-nota" id="veh-nota" rows="2" maxlength="300">${esc(rep.nota)}</textarea></label>
      ${MODO !== 'real' ? '<p class="hint" style="margin:0">Modo prueba: la foto no se sube a Drive; solo se guarda el registro.</p>' : ''}
      <p class="veh-err" ${rep.error ? '' : 'hidden'}>${esc(rep.error)}</p>
      <button type="button" class="btn" data-veh-guardar ${rep.enviando ? 'disabled' : ''}>${rep.enviando ? 'Guardando…' : 'Guardar repostaje'}</button>
    </div>`;
}
const ultimoKm = () => regs.find(r => r.km);
const hintKm = () => { const u = ultimoKm(); return u ? `<p class="hint" style="margin:0">Último registrado: ${fmtKm(u.km)} km (${esc(cuando(u.ts))}).</p>` : ''; };
const req = t => `<span class="veh-req">${t}</span>`;
function pMan(v) {
  const M = man, si = M.inc === 'Sí';
  return `${atras('veh', v.modelo)}<h2 class="veh-tit">Mantenimiento</h2><p class="veh-sub">${esc(v.modelo)} · ${esc(v.matricula)}</p>
    <div class="card veh-form">
      <label><span class="veh-lb">Kilometraje ${req('Obligatorio')}</span><input class="field" id="veh-man-km" type="number" inputmode="numeric" min="0" step="1" value="${esc(M.km)}" placeholder="Ej. 184950"></label>
      ${hintKm()}
      <div class="veh-sep"></div>
      <span class="veh-lb">Documentación del vehículo ${req('Obligatorio')}</span>
      <div class="veh-seg"><button type="button" class="${M.doc === 'OK' ? 'on' : ''}" data-veh-man="doc" data-v="OK">OK</button><button type="button" class="${M.doc === 'Falta' ? 'on mal' : ''}" data-veh-man="doc" data-v="Falta">Falta</button></div>
      <div class="veh-sep"></div>
      <span class="veh-lb">Limpieza ${req('Foto obligatoria')}</span>
      ${M.lim ? `<figure class="veh-foto"><img src="${M.lim.url}" alt="Foto de limpieza"><button type="button" data-veh-man-quitar="lim" aria-label="Quitar foto">✕</button></figure>`
        : `<label class="veh-camara">📷 Foto de limpieza<input type="file" accept="image/*" capture="environment" id="veh-man-lim" hidden></label>`}
      <div class="veh-sep"></div>
      <span class="veh-lb">¿Hay incidencias?</span>
      <div class="veh-seg"><button type="button" class="${M.inc === 'No' ? 'on' : ''}" data-veh-man="inc" data-v="No">No</button><button type="button" class="${si ? 'on mal' : ''}" data-veh-man="inc" data-v="Sí">Sí</button></div>
      ${si ? `<span class="veh-lb">Fotos de las incidencias ${req('Al menos 1')}</span>
        <div class="veh-miniaturas">${M.fotos.map((f, i) => `<figure><img src="${f.url}" alt="Incidencia ${i + 1}"><button type="button" data-veh-man-quitar="${i}" aria-label="Quitar foto ${i + 1}">✕</button></figure>`).join('')}
        ${M.fotos.length < MAX_INC ? `<label class="veh-mas" aria-label="Añadir foto">＋<input type="file" accept="image/*" capture="environment" id="veh-man-inc" hidden></label>` : ''}</div>
        <p class="hint" style="margin:0">Hasta ${MAX_INC} fotos, una por cada daño (golpe, luz rota…).</p>
        <label><span class="veh-lb">Descripción de la incidencia ${req('Obligatorio')}</span><textarea class="field veh-nota" id="veh-man-desc" rows="3" maxlength="500">${esc(M.desc)}</textarea></label>` : ''}
      ${MODO !== 'real' ? '<p class="hint" style="margin:0">Modo prueba: las fotos no se suben a Drive; solo se guarda el registro.</p>' : ''}
      <p class="veh-err" ${M.error ? '' : 'hidden'}>${esc(M.error)}</p>
      <button type="button" class="btn" data-veh-man-guardar ${M.enviando ? 'disabled' : ''}>${M.enviando ? 'Guardando…' : 'Guardar revisión'}</button>
    </div>`;
}
const chip = (t, mal) => `<span class="veh-chip ${mal ? 'mal' : 'ok'}">${esc(t)}</span>`;
const verFotoBtn = (f, txt, tit) => `<button type="button" class="veh-ver" data-foto="${esc(f.id)}" data-foto-tit="${esc(tit)}">${esc(txt)}</button>`;
function filaHist(r, v) {
  if (r.tipo === 'mantenimiento') {
    const fs = r.fotos || [], lim = fs.filter(f => f.rol === 'limpieza'), inc = fs.filter(f => f.rol === 'incidencia');
    const n = inc.length;
    const links = [...lim.map(f => verFotoBtn(f, 'Limpieza', `Limpieza · ${v.matricula}`)), ...inc.map((f, i) => verFotoBtn(f, `Incidencia ${i + 1}`, `Incidencia ${i + 1} · ${v.matricula}`))].join(' · ');
    return `<li class="veh-reg"><span class="veh-ico man">⚙️</span><div><b>Mantenimiento · ${r.km ? fmtKm(r.km) + ' km' : 'sin km'}</b>
      <div class="veh-chips">${chip('Documentación ' + (r.doc || '—'), r.doc !== 'OK')}${r.incidencias ? chip(n ? `${n} incidencia${n === 1 ? '' : 's'}` : 'Con incidencias', true) : chip('Sin incidencias', false)}</div>
      <small>${esc(cuando(r.ts))} · ${esc(r.nombre || '')}${links ? ' · ' + links : ' · sin fotos'}</small>${r.desc ? `<small class="veh-n">${esc(r.desc)}</small>` : ''}</div></li>`;
  }
  const fotos = (r.fotos || []).map((f, i) => verFotoBtn(f, `Ver foto${r.fotos.length > 1 ? ' ' + (i + 1) : ''}`, `Ticket · ${v.matricula}`)).join(' ');
  return `<li class="veh-reg"><span class="veh-ico rep">⛽</span><div><b>Repostaje · ${r.km ? fmtKm(r.km) + ' km' : 'sin km'}</b>
      <small>${esc(cuando(r.ts))} · ${esc(r.nombre || '')}${fotos ? ' · ' + fotos : ' · sin foto'}</small>${r.nota ? `<small class="veh-n">${esc(r.nota)}</small>` : ''}</div></li>`;
}
function pHist(v) {
  const filas = regs.map(r => filaHist(r, v)).join('');
  return `${atras('veh', v.modelo)}<h2 class="veh-tit">Historial</h2><p class="veh-sub">${esc(v.modelo)} · ${esc(v.matricula)}</p>
    ${filas ? `<ul class="card veh-hist">${filas}</ul>` : '<div class="empty"><p>Todavía no hay registros de este vehículo.</p></div>'}`;
}

/* ================= Oficina → Vehículos ================= */
export function renderAdmin(el) { elAdmin = el; pintarAdmin(); }
function pintarAdmin() {
  const el = elAdmin; if (!el) return;
  const n = document.getElementById('n-veh');
  const todos = Object.values(vehs).sort((a, b) => (a.activo === false) - (b.activo === false) || (a.modelo + a.matricula).localeCompare(b.modelo + b.matricula, 'es'));
  if (n) n.textContent = todos.length ? `${activos().length} activos` : '';
  if (errV) { el.innerHTML = '<p class="small">No se pudo leer la lista de vehículos. Revisa que estén publicadas las reglas de Firebase.</p>'; return; }
  const P = pegado;
  el.innerHTML = `
    <div class="veh-adm-b">
      <span class="lbl">Pegar lista (carga masiva)</span>
      <textarea class="field" id="veh-pegar" rows="4" placeholder="Iveco; 7863 MJR&#10;VW Caddy; 6542 DVG&#10;Berlingo	0657 DVS"></textarea>
      <p class="hint" style="margin:0">Un vehículo por línea: modelo y matrícula. Puedes copiar dos columnas de Excel o separar con «;».</p>
      ${P ? `<div class="veh-prev"><p><b>${P.nuevos.length}</b> nuevo${P.nuevos.length === 1 ? '' : 's'} · <b>${P.existen.length}</b> ya existía${P.existen.length === 1 ? '' : 'n'}${P.malas.length ? ` · <b>${P.malas.length}</b> línea${P.malas.length === 1 ? '' : 's'} sin entender` : ''}</p>
        ${P.nuevos.length ? `<ul>${P.nuevos.map(v => `<li>${esc(v.modelo)} · ${esc(v.matricula)}</li>`).join('')}</ul>` : ''}
        ${P.malas.length ? `<p class="veh-err">Revisa: ${P.malas.map(esc).join(' | ')}</p>` : ''}
        <div class="btnrow"><button type="button" class="btn" data-veh-cargar ${P.nuevos.length ? '' : 'disabled'}>Guardar ${P.nuevos.length} nuevo${P.nuevos.length === 1 ? '' : 's'}</button><button type="button" class="btn ghost" data-veh-cancelar>Cancelar</button></div></div>`
        : `<div class="btnrow"><button type="button" class="btn ghost" data-veh-revisar>Revisar lista</button></div>`}
    </div>
    <div class="veh-adm-b">
      <span class="lbl">Añadir uno</span>
      <div class="veh-dos"><input class="field" id="veh-mod" placeholder="Modelo" autocomplete="off"><input class="field" id="veh-mat" placeholder="Matrícula" autocomplete="off" autocapitalize="characters"></div>
      <p class="veh-err" id="veh-adm-err" hidden></p>
      <div class="btnrow"><button type="button" class="btn" data-veh-anadir>＋ Añadir vehículo</button></div>
    </div>
    ${todos.length ? `<ul class="veh-adm-lista">${todos.map(v => editando === v.id
      ? `<li><div class="veh-dos"><input class="field" id="veh-ed-mod" value="${esc(v.modelo)}"><input class="field" value="${esc(v.matricula)}" disabled></div><div class="btnrow"><button type="button" class="btn" data-veh-ed-ok="${esc(v.id)}">Guardar</button><button type="button" class="btn ghost" data-veh-ed-no>Cancelar</button></div></li>`
      : `<li class="${v.activo === false ? 'off' : ''}"><span><b>${esc(v.modelo)} · ${esc(v.matricula)}</b>${v.activo === false ? '<small>Desactivado · conserva su historial</small>' : ''}</span>
        <span class="veh-adm-acc">${v.activo === false ? '' : `<button type="button" class="veh-mini" data-veh-editar="${esc(v.id)}">Editar</button>`}<button type="button" class="veh-mini" data-veh-activo="${esc(v.id)}">${v.activo === false ? 'Activar' : 'Desactivar'}</button></span></li>`).join('')}</ul>` : ''}`;
}
// «Iveco; 7863 MJR», «Iveco, 7863 MJR», «Iveco<TAB>7863 MJR», «Iveco · 7863 MJR», «Iveco 7863 MJR» (matrícula al final).
function leerLinea(l) {
  const t = l.trim(); if (!t) return null;
  let m = t.split(/\t|;|\||·|,/).map(s => s.trim()).filter(Boolean);
  if (m.length >= 2) return { modelo: m.slice(0, -1).join(' '), matricula: fmtMat(m[m.length - 1]) };
  m = t.match(/^(.*?)[\s,\-]+(\d{4}[\s-]?[A-Za-z]{3})$/);
  if (m && m[1]) return { modelo: m[1].trim(), matricula: fmtMat(m[2]) };
  return { mala: t };
}
function revisarPegado() {
  const txt = (document.getElementById('veh-pegar') || {}).value || '';
  const nuevos = [], existen = [], malas = [], vistos = new Set();
  txt.split(/\r?\n/).forEach(l => {
    const r = leerLinea(l); if (!r) return;
    if (r.mala || !r.modelo || idDe(r.matricula).length < 4) { malas.push(r.mala || l.trim()); return; }
    const id = idDe(r.matricula); if (vistos.has(id)) return; vistos.add(id);
    (vehs[id] ? existen : nuevos).push({ ...r, id });
  });
  pegado = { nuevos, existen, malas, txt };
  pintarAdmin();
  const ta = document.getElementById('veh-pegar'); if (ta) ta.value = txt;
}
async function guardarVeh(v) {
  const f = ctx.firma();
  await setDoc(doc(db, 'vehiculos', v.id), { modelo: v.modelo, matricula: v.matricula, activo: true, alta: f });
}
const errGuardar = e => { console.error(e); ctx.toast(e && e.code === 'permission-denied' ? 'Sin permiso: falta publicar las reglas de Firebase' : 'No se guardó. Revisa la conexión'); };

/* ================= repostaje ================= */
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
function limpiarRep() { if (rep.foto) URL.revokeObjectURL(rep.foto.url); rep = { foto: null, km: '', nota: '', error: '', enviando: false }; }

// Sube las fotos a Drive (Vehículos / matrícula · modelo / tipo) y devuelve [{ id, nombre }] en el mismo orden.
async function subirFotos(v, tipo, blobs) {
  const user = auth.currentUser; if (!user) throw new Error('Tienes que entrar con tu usuario.');
  const token = await user.getIdToken();
  const paginas = await Promise.all(blobs.map(aBase64));
  const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ token, accion: 'vehiculo', fecha: ctx.hoy(), matricula: v.matricula, modelo: v.modelo, tipo, g: 'VEH ' + v.matricula, paginas }) });
  const res = await r.json().catch(() => ({ ok: false, error: 'Respuesta no válida del script de Google.' }));
  if (!res.ok) throw new Error(res.error || 'No se pudieron guardar las fotos en Drive.');
  return res.archivos;
}
const msgError = e => e && SESION.test(e.code || '') ? 'Tu sesión ha caducado. Sal de la app («Salir») y vuelve a entrar.'
  : e && e.code === 'permission-denied' ? 'Sin permiso para guardar: falta publicar las reglas de Firebase.'
  : e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'No se pudo enviar. Revisa la conexión.';
function limpiarMan() { if (man.lim) URL.revokeObjectURL(man.lim.url); man.fotos.forEach(f => URL.revokeObjectURL(f.url)); man = manVacio(); }

async function guardarMan() {
  const v = vehs[sel], M = man; if (!v || M.enviando) return;
  const km = Number(M.km), real = MODO === 'real';
  M.error = !M.km || !Number.isFinite(km) || km <= 0 ? 'Escribe el kilometraje.'
    : !M.doc ? 'Marca si la documentación está OK o falta.'
    : real && !M.lim ? 'Falta la foto de limpieza.'
    : !M.inc ? 'Indica si hay incidencias.'
    : M.inc === 'Sí' && real && !M.fotos.length ? 'Añade al menos una foto de la incidencia.'
    : M.inc === 'Sí' && !M.desc.trim() ? 'Describe la incidencia.' : '';
  if (M.error) { pintar(); return; }
  M.enviando = true; pintar();
  try {
    const si = M.inc === 'Sí', incs = si ? M.fotos : [];
    let fotos = [];
    if (real) {
      const subidas = await subirFotos(v, 'Mantenimiento', [M.lim.blob, ...incs.map(f => f.blob)]);
      fotos = subidas.map((f, i) => ({ ...f, rol: i === 0 ? 'limpieza' : 'incidencia' }));
    }
    const f = ctx.firma();
    await setDoc(doc(db, 'vehiculos', v.id, 'registros', `man__${Date.now()}`), { tipo: 'mantenimiento', km, doc: M.doc, incidencias: si, desc: si ? M.desc.trim() : '', fotos, fecha: ctx.hoy(), nombre: f.nombre, uid: f.uid, ts: f.ts });
    limpiarMan(); pant = 'hist'; pintar(); ctx.toast('Revisión guardada');
  } catch (e) { console.error(e); man.error = msgError(e); }
  finally { man.enviando = false; pintar(); }
}

async function guardarRep() {
  const v = vehs[sel]; if (!v || rep.enviando) return;
  const km = Number(rep.km);
  if (!rep.km || !Number.isFinite(km) || km <= 0) { rep.error = 'Escribe el kilometraje.'; pintar(); return; }
  if (MODO === 'real' && !rep.foto) { rep.error = 'Falta la foto del ticket.'; pintar(); return; }
  rep.enviando = true; rep.error = ''; pintar();
  try {
    let fotos = [];
    if (rep.foto && MODO === 'real') fotos = await subirFotos(v, 'Repostaje', [rep.foto.blob]);
    const f = ctx.firma();
    await setDoc(doc(db, 'vehiculos', v.id, 'registros', `rep__${Date.now()}`), { tipo: 'repostaje', km, nota: rep.nota.trim(), fotos, fecha: ctx.hoy(), nombre: f.nombre, uid: f.uid, ts: f.ts });
    limpiarRep(); pant = 'hist'; pintar(); ctx.toast('Repostaje guardado');
  } catch (e) { console.error(e); rep.error = msgError(e); }
  finally { rep.enviando = false; pintar(); }
}

/* ================= eventos ================= */
function clic(e) {
  const t = e.target.closest('[data-veh-sel],[data-veh-ir],[data-veh-pronto],[data-veh-borrar],[data-veh-quitar],[data-veh-guardar],[data-veh-revisar],[data-veh-cargar],[data-veh-cancelar],[data-veh-anadir],[data-veh-editar],[data-veh-ed-ok],[data-veh-ed-no],[data-veh-activo],[data-veh-man],[data-veh-man-quitar],[data-veh-man-guardar]');
  if (!t) return;
  const d = t.dataset;
  if (d.vehSel) { sel = d.vehSel; suscribirRegistros(sel); pant = 'veh'; pintar(); scrollTo(0, 0); return; }
  if (d.vehIr) { if (d.vehIr === 'lista') { sel = null; suscribirRegistros(null); } if (pant === 'rep' && d.vehIr !== 'rep') limpiarRep(); if (pant === 'man' && d.vehIr !== 'man') limpiarMan(); pant = d.vehIr; pintar(); scrollTo(0, 0); return; }
  if (d.vehPronto) { ctx.toast(`${d.vehPronto}: próximamente`); return; }
  if ('vehBorrar' in d) { q = ''; const i = document.getElementById('veh-q'); if (i) { i.value = ''; i.focus(); } pintarLista(); return; }
  if ('vehQuitar' in d) { if (rep.foto) URL.revokeObjectURL(rep.foto.url); rep.foto = null; pintar(); return; }
  if ('vehGuardar' in d) { guardarRep(); return; }
  if (d.vehMan) { man[d.vehMan] = d.v; man.error = ''; pintar(); return; }
  if (d.vehManQuitar) { if (d.vehManQuitar === 'lim') { if (man.lim) URL.revokeObjectURL(man.lim.url); man.lim = null; } else { const f = man.fotos.splice(Number(d.vehManQuitar), 1)[0]; if (f) URL.revokeObjectURL(f.url); } pintar(); return; }
  if ('vehManGuardar' in d) { guardarMan(); return; }
  if ('vehRevisar' in d) { revisarPegado(); return; }
  if ('vehCancelar' in d) { pegado = null; pintarAdmin(); return; }
  if ('vehCargar' in d) {
    const lista = pegado ? pegado.nuevos : []; if (!lista.length) return;
    t.disabled = true;
    Promise.all(lista.map(guardarVeh)).then(() => { ctx.toast(`${lista.length} vehículo${lista.length === 1 ? '' : 's'} añadido${lista.length === 1 ? '' : 's'}`); pegado = null; pintarAdmin(); }).catch(e => { t.disabled = false; errGuardar(e); });
    return;
  }
  if ('vehAnadir' in d) {
    const mod = document.getElementById('veh-mod').value.trim(), mat = fmtMat(document.getElementById('veh-mat').value), id = idDe(mat), err = document.getElementById('veh-adm-err');
    const fallo = !mod ? 'Escribe el modelo.' : id.length < 4 ? 'Escribe la matrícula.' : vehs[id] ? `La matrícula ${mat} ya existe${vehs[id].activo === false ? ' (está desactivada: actívala abajo)' : ''}.` : '';
    if (fallo) { err.textContent = fallo; err.hidden = false; return; }
    guardarVeh({ id, modelo: mod, matricula: mat }).then(() => ctx.toast('Vehículo añadido')).catch(errGuardar);
    return;
  }
  if (d.vehEditar) { editando = d.vehEditar; pintarAdmin(); return; }
  if ('vehEdNo' in d) { editando = null; pintarAdmin(); return; }
  if (d.vehEdOk) {
    const mod = document.getElementById('veh-ed-mod').value.trim(); if (!mod) return;
    setDoc(doc(db, 'vehiculos', d.vehEdOk), { modelo: mod }, { merge: true }).then(() => { editando = null; pintarAdmin(); }).catch(errGuardar);
    return;
  }
  if (d.vehActivo) { const v = vehs[d.vehActivo]; if (v) setDoc(doc(db, 'vehiculos', v.id), { activo: v.activo === false }, { merge: true }).catch(errGuardar); }
}
function escribir(e) {
  const id = e.target.id;
  if (id === 'veh-q') { q = e.target.value; pintarLista(); }
  else if (id === 'veh-km') rep.km = e.target.value;
  else if (id === 'veh-nota') rep.nota = e.target.value;
  else if (id === 'veh-man-km') man.km = e.target.value;
  else if (id === 'veh-man-desc') man.desc = e.target.value;
}
async function cambiar(e) {
  const id = e.target.id;
  if (id === 'veh-man-lim' || id === 'veh-man-inc') {
    const files = [...(e.target.files || [])]; if (!files.length) return;
    try {
      for (const file of files) {
        if (id === 'veh-man-inc' && man.fotos.length >= MAX_INC) break;
        const blob = await comprimir(file), foto = { blob, url: URL.createObjectURL(blob) };
        if (id === 'veh-man-lim') man.lim = foto; else man.fotos.push(foto);
      }
      man.error = '';
    } catch (err) { console.error(err); man.error = 'No se pudo leer la foto. Prueba otra vez.'; }
    pintar(); return;
  }
  if (id !== 'veh-foto') return;
  const file = e.target.files && e.target.files[0]; if (!file) return;
  try { const blob = await comprimir(file); rep.foto = { blob, url: URL.createObjectURL(blob) }; rep.error = ''; }
  catch (err) { console.error(err); rep.error = 'No se pudo leer la foto. Prueba otra vez.'; }
  pintar();
}
