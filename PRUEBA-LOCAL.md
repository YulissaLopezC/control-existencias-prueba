# Probar la app en tu computador (modo local)

En el computador (`localhost` o `127.0.0.1`) la app entra sola en **MODO PRUEBA**:
no toca la base de datos real y todo queda guardado solo en tu navegador.

> ¿Quieres probar en el celular sin tocar los datos reales? Usa el enlace oficial terminado en `?prueba`:
> https://yulissalopezc.github.io/control-existencias-prueba/?prueba
> (usa Firebase, pero en colecciones aparte que empiezan por `prueba_`).

## 1. Descargar el repo

- **Con Git:** `git clone https://github.com/YulissaLopezC/control-existencias-prueba.git`
  (o, si ya lo tienes clonado: `git checkout main` y `git pull`).
  Para probar un cambio que aún no está en `main`, cambia a su rama: `git fetch` y `git checkout <nombre-de-la-rama>`.
- **Sin Git:** en GitHub, elige la rama (normalmente **main**) → botón verde **Code** → **Download ZIP** y descomprímelo.

> El repo antiguo `control-existencias` y la rama `fase-1` ya no se usan.

## 2. Abrirla con un servidor local

Elige una (todas sirven):

- **VS Code + Live Server:** abre la carpeta, clic derecho en `index.html` → **Open with Live Server**.
- **Python:** en la carpeta, `python -m http.server 8000` y abre http://localhost:8000
- **Node:** en la carpeta, `npx serve` y abre la dirección que muestra.

> Abrir `index.html` con doble clic no funciona: hace falta el servidor local.

## 3. Usuarios de prueba

Los chóferes entran **sin PIN**: solo eligen su nombre. Oficina sí pide PIN.

| Usuario | Rol | PIN |
|---|---|---|
| Juan Lara | Chófer | — |
| Juan Luna | Chófer | — |
| David García | Chófer | — |
| Alexis | Chófer | — |
| Extra (reserva) | Chófer | — |
| Don Antonio | Oficina | 555555 |
| Yulissa | Oficina | 666666 |

Los PIN de oficina de esta tabla **solo valen en modo prueba/local**. Los PIN reales están en los secretos de GitHub (`PIN_ANTONIO` y `PIN_YULISSA`).

Cada **pestaña** del navegador puede tener un usuario distinto, y se ven entre sí en vivo.

## 4. Recorrido sugerido

1. Pestaña 1 → entra como **Yulissa** → **Oficina** → sube los 2 PDF del día → **Publicar**.
   (En modo prueba no hay carga automática por correo: se usa la carga manual.)
2. En **Oficina → Almacenes del día**, asigna un chófer a cada almacén (CA, CEN, TGT…).
3. Pestaña 2 → entra como **Juan Lara** → elige el día en el selector de arriba si no es hoy →
   **1 Recogida** muestra solo sus almacenes → **2 Clientes** → «Lo llevo yo».
4. Pestaña 3 → **Juan Luna** → intenta tomar un cliente de Juan Lara: no lo deja.
5. **3 Reparto** muestra solo los clientes de cada uno; **4 Traspasos** muestra qué pasarse en el punto de encuentro.
6. **Resumen** muestra el avance por chófer, faltantes y pesos EK.
7. Como oficina, en **Oficina → Pedidos a proveedores** puedes revisar el correo de cada almacén antes de enviarlo.

Para empezar de cero: botón **Borrar datos de prueba** en la franja amarilla.
