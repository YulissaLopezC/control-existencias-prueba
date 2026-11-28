// Visor de fotos dentro de la app (tickets de vehículos y albaranes).
// La foto se pide al script de Google, que comprueba la sesión y solo devuelve fotos de las
// carpetas de la app: así no hace falta compartir las carpetas de Drive.
// Uso: cualquier botón con data-foto="<id de Drive>" (y opcional data-foto-tit="título").
import { auth, MODO } from './fb.js?v=29';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVvZly3YpUWv5W-vFE8PZT1y0Pf2zZhLpNcDmPLLlMcg0gnNpzDDE_ln-dB0tuGQA/exec';
const cache = new Map();   // id → URL de la imagen ya descargada
let pidiendo = 0;          // para ignorar respuestas de una foto que ya se cerró

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function caja() {
  let el = document.getElementById('visor');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'visor'; el.className = 'visor'; el.hidden = true;
  el.innerHTML = `<div class="visor-h"><span class="visor-t"></span><button type="button" class="visor-x" data-visor-cerrar aria-label="Cerrar">✕</button></div>
    <div class="visor-b"></div><p class="visor-pie">Toca la foto para ampliarla.</p>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => {
    if (e.target.closest('[data-visor-cerrar]')) { cerrar(); return; }
    const img = e.target.closest('.visor-b img');
    if (img) img.classList.toggle('zoom');
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) cerrar(); });
  return el;
}
function cerrar() {
  const el = document.getElementById('visor'); if (!el) return;
  el.hidden = true; pidiendo++; document.body.classList.remove('visor-abierto');
}
const cuerpo = html => { document.querySelector('#visor .visor-b').innerHTML = html; };

export async function verFoto(id, titulo) {
  const el = caja(), yo = ++pidiendo;
  el.querySelector('.visor-t').textContent = titulo || 'Foto';
  el.hidden = false; document.body.classList.add('visor-abierto');
  if (cache.has(id)) { cuerpo(`<img src="${cache.get(id)}" alt="${esc(titulo || 'Foto')}">`); return; }
  if (MODO !== 'real') { cuerpo('<p class="visor-msg">Las fotos solo se pueden ver en la app real.</p>'); return; }
  cuerpo('<p class="visor-msg">Cargando la foto…</p>');
  try {
    const user = auth.currentUser; if (!user) throw new Error('Tienes que entrar con tu usuario.');
    const token = await user.getIdToken();
    const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ token, accion: 'foto', id }) });
    const res = await r.json().catch(() => ({ ok: false, error: 'Respuesta no válida del script de Google.' }));
    if (!res.ok) throw new Error(res.error && !/Almacén no válido|Fecha no válida/.test(res.error) ? res.error : 'Falta actualizar el script de Google para ver fotos.');
    const bin = atob(res.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mime || 'image/jpeg' }));
    cache.set(id, url);
    if (yo === pidiendo) cuerpo(`<img src="${url}" alt="${esc(titulo || 'Foto')}">`);
  } catch (e) {
    console.error(e);
    if (yo === pidiendo) cuerpo(`<p class="visor-msg">${esc(e && e.message && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : 'No se pudo cargar la foto. Revisa la conexión.')}</p>`);
  }
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-foto]');
  if (!b) return;
  e.preventDefault();
  verFoto(b.dataset.foto, b.dataset.fotoTit);
});
