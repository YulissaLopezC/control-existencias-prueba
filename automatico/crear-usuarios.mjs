// Crea (o actualiza) los usuarios reales de la app: cuenta en Firebase Authentication
// (PIN = contraseña) y su ficha en la colección «usuarios».
// Se ejecuta a mano desde GitHub: Actions → «Crear usuarios» → Run workflow.
// Se puede repetir sin problema: si el usuario ya existe, actualiza su nombre, color y PIN.
//
// Lista de personas: demo/usuarios.js (la misma que usa la versión de prueba).
// PIN reales: chóferes → el de demo/usuarios.js (entran sin escribirlo).
//             oficina  → secretos de GitHub PIN_ANTONIO, PIN_YULISSA… (PIN_ + uid sin «u-», en mayúsculas).
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { USUARIOS_DEMO } from '../demo/usuarios.js';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error('Falta la variable FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(sa)) });
const auth = getAuth(), db = getFirestore();

// El PIN de oficina nunca sale del código público: se lee de los secretos. Si falta alguno, no se toca nada.
const pinDe = u => u.rol === 'oficina' ? process.env['PIN_' + u.uid.slice(2).toUpperCase()] : u.pin;
const malos = USUARIOS_DEMO.filter(u => !u.sinLogin && !/^\d{6}$/.test(pinDe(u) || ''));
if (malos.length) {
  console.error('Falta el PIN (6 números) en los secretos de GitHub para: ' + malos.map(u => `${u.nombre} → PIN_${u.uid.slice(2).toUpperCase()}`).join(', '));
  console.error('No se cambió nada. Añade esos secretos y vuelve a lanzar «Crear usuarios».');
  process.exit(1);
}

// En la app real los usuarios entran con un correo interno (nadie lo escribe: se elige el nombre y se pone el PIN).
const correo = u => u.uid.slice(2) + '@control-existencias.app';

for (const u of USUARIOS_DEMO) {
  const email = correo(u);
  if (!u.sinLogin) {
    try {
      await auth.getUser(u.uid);
      await auth.updateUser(u.uid, { email, password: pinDe(u), displayName: u.nombre, disabled: false });
      console.log(`Actualizado: ${u.nombre}`);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      await auth.createUser({ uid: u.uid, email, password: pinDe(u), displayName: u.nombre });
      console.log(`Creado:      ${u.nombre}`);
    }
  } else console.log(`Buzón (sin cuenta): ${u.nombre}`);
  await db.doc(`usuarios/${u.uid}`).set({
    nombre: u.nombre, rol: u.rol, color: u.color, email, orden: u.orden, sinLogin: !!u.sinLogin,
  });
}
console.log(`Listo: ${USUARIOS_DEMO.length} usuarios en la colección «usuarios».`);
