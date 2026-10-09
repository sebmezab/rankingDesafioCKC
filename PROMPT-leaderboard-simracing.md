# Leaderboard Desafío Simracing CKC — instrucciones para Claude Code

Construye un sitio web estático para mostrar en vivo los rankings de un desafío de
vuelta rápida en Assetto Corsa. Se usa **mañana** en una fecha del Club de Karting
Concepción (CKC), así que la prioridad es que funcione de forma confiable; lo
"Imprescindible" va antes que lo "Deseable" (ver Prioridades al final).

No me hagas preguntas salvo que estés bloqueado: toma decisiones razonables y
anótalas en el README. Antes de programar, muéstrame un plan breve.

## Contexto

- Hay un simulador en la pista. Entre sesiones de karting, la gente pasa a marcar
  su mejor vuelta. Pista y auto aún por definir (se configuran desde la página de
  staff).
- Dos rankings independientes: **Pilotos** (36 pilotos inscritos, lista cerrada y
  precargada) y **Open** (público general, se inscriben en el momento).
- Un tercer ranking, **Preparadores**, queda construido pero apagado; se activa con
  un interruptor desde la página de staff.
- El staff lee el tiempo en la pantalla del simulador y lo ingresa a mano desde un
  teléfono.
- El ranking se proyecta en una pantalla 16:9 y el público lo mira desde sus
  teléfonos. Ambos deben actualizarse solos cuando se ingresa un tiempo.

## Stack (obligatorio)

- HTML/CSS/JS vanilla, sin build ni frameworks.
- Hosting en GitHub Pages desde la raíz de `main`. Todas las rutas relativas (se
  sirve bajo `/nombre-repo/`). Incluye `.nojekyll`.
- Backend: Supabase (Postgres + Auth + Realtime) con `supabase-js` por CDN (ESM),
  con versión fija.
- URL y key pública de Supabase en `js/config.js`. Es pública por diseño: la
  seguridad la dan las políticas RLS, no ocultar la key.
- El repo es público: no incluyas ningún dato personal fuera del número de kart y
  el nombre de la lista de abajo. Agrega `*.xlsx` y `*.csv` al `.gitignore`.

## Modelo de datos

Entrega `supabase/schema.sql` listo para pegar en el SQL Editor de Supabase.

- `evento` (fila única): `titulo`, `pista`, `auto`, `rental_nombre`,
  `preparadores_activo` (boolean, por defecto false).
- `participantes`: `id`, `ranking` ('pilotos' | 'open' | 'preparadores'),
  `numero` (texto, nullable; solo pilotos), `nombre` (nombre a mostrar),
  `created_at`. Índice único por (`ranking`, `lower(nombre)`).
- `intentos`: `id`, `participante_id` (FK con borrado en cascada), `tiempo_ms`
  (entero > 0), `created_at`.
- `staff`: `user_id` (FK a `auth.users`). Sin políticas públicas.
- Vista `leaderboard` (`security_invoker`): una fila por participante **con al
  menos un intento**, con su mejor tiempo y la fecha en que lo marcó. Orden: tiempo
  ascendente; en empate gana quien lo marcó primero.
- RLS: lectura pública (anon) de `evento`, `participantes` e `intentos`. Escritura
  solo si `auth.uid()` está en `staff` (no basta con estar autenticado).
- Agrega `evento`, `participantes` e `intentos` a la publicación
  `supabase_realtime`.

### Regla del mejor tiempo

Cada tiempo ingresado se guarda como un intento. El ranking muestra **una sola fila
por persona con su mejor intento**; nunca dos filas de la misma persona. Si el
tiempo nuevo es peor que su marca, el ranking no cambia. Guardar todos los intentos
sirve para que, si el staff borra un tiempo mal tipeado, vuelva a valer la marca
anterior.

### Pilotos precargados

Entrega `supabase/seed_pilotos.sql` con estos 36 pilotos (`numero;nombre`).
Respeta la escritura tal como está.

```text
7;Renata Melo
16;Pedro Sepulveda
21 / 51;Ignacio Olivera A.
42;Agustín Ignacio Mosso
71;Benjamin Mardones
77;Joaquin Sandoval
85;Antonia Klenner
88;Matteo Teucher
111;Sebastian Alegria
112;Martin He
118;Esteban Vilugron
119;Emilio Léon Pérez
120;Ingrid Jara
132;Vicente Cabezas
133;Agustín Cabezas
155;Maximiliano Rivas
177;Maximiliano Martinez
184;Adolfo Klenner
312;Francisco Borquez
381;Sebastián Sepúlveda
395;Martin Espinoza
521;Cesar Antonio Sandoval
523;Cristian Lagos
525;Sebastian Meza
549;Ignacio Olivera P.
555;Paolo Espinoza
556;Esteban Melo
561;Martin Hauri
563;Roberto Alegria
565;Sergio Sepulveda
571;Gino Mardones
577;Roberto Martinez
707;Agusto Yañez
720;Martina Sandoval
735;Diego Alegría
745;Martina Olivera
```

Notas: `numero` es texto porque un piloto corre con dos números ("21 / 51"); la
búsqueda por número debe encontrarlo con 21 y con 51. Hay dos pilotos llamados
Ignacio Olivera, distinguidos por la inicial del segundo apellido.

## Página pública (`index.html`)

Una sola página con dos presentaciones: teléfono/escritorio y modo pantalla
(`?tv=1`).

**Común a ambas**

- Encabezado: logo del club, título del evento, pista y auto, logo y nombre de la
  empresa de rental ("Simulador gentileza de …"), indicador de conexión.
- Columnas por ranking: posición, número de kart (solo Pilotos), nombre, mejor
  tiempo en formato `m:ss.mmm`, diferencia con el líder.
- Solo aparecen quienes ya marcaron tiempo. Junto al título de cada ranking, un
  contador: "12 de 36 pilotos" en Pilotos, "8 participantes" en los demás.
- Top 3 destacado. Cuando alguien entra o mejora, su fila se destaca unos segundos.
- Estado vacío decente cuando aún no hay tiempos ("Aún no hay tiempos. ¡Sé el
  primero!").
- Tiempo real: suscripción Realtime a las tres tablas **más** un sondeo de respaldo
  cada 15 s. Si se cae la conexión, mantener en pantalla los últimos datos (cache
  en `localStorage`, con try/catch) y reconectar solo. Nunca mostrar una pantalla
  en blanco ni exigir recargar.

**Modo pantalla (`?tv=1`), 16:9**

- Pilotos y Open **lado a lado**, cada uno ocupando la mitad. Si Preparadores está
  activo, tres columnas iguales.
- Sin scroll ni barras. Tamaños en unidades relativas al viewport para que se vea
  igual en 1080p y 4K. Debe leerse a unos 5 metros.
- Cuando un ranking tiene más filas de las que caben: **los 5 primeros quedan
  fijos** y el resto rota por páginas cada ~8 s, con indicador ("6–15 de 36"). La
  cantidad de filas por página se calcula según el alto disponible.
- Cuando entra un tiempo nuevo, la rotación salta a la página donde quedó esa
  persona y destaca su fila.
- Código QR con la URL pública para que el público la abra en su teléfono.
- Wake Lock para que la pantalla no se apague.

**Teléfono**

- Pestañas Pilotos | Open (| Preparadores si está activo), lista completa con
  scroll, encabezado compacto y fijo. Debe verse bien desde 360 px de ancho.

## Página de staff (`admin.html`)

No se enlaza desde la página pública. Diseñada primero para teléfono.

**Acceso**

- Pide **solo una contraseña**. Usa `signInWithPassword` con un correo fijo
  definido en `config.js`. Sesión persistente y botón de salir.

**Ingresar un tiempo (pantalla principal, pocos toques)**

1. Elegir ranking: Pilotos / Open (/ Preparadores si está activo).
2. Elegir a la persona:
   - **Pilotos**: buscar por número de kart o por nombre dentro de la lista
     precargada. No se crean pilotos desde aquí.
   - **Open y Preparadores**: al escribir el nombre aparecen las personas ya
     registradas en ese ranking, cada una con su mejor tiempo actual. Se elige una
     o se crea una nueva (nombre y apellido obligatorios). **Antes de crear**, si
     el nombre se parece a uno existente (sin distinguir mayúsculas ni tildes,
     mismas palabras en otro orden, o diferencia de 1–2 letras), mostrar un
     diálogo que obligue a elegir: "Es esta persona" o "Es alguien nuevo". El
     objetivo es que nadie quede dos veces en el ranking.
3. Ingresar el tiempo. Teclado numérico; acepta "1:23.456", "83.456" o solo
   dígitos "123456" (se interpreta como 1:23.456). Mostrar el valor normalizado.
   Rechazar segundos ≥ 60 y valores vacíos; pedir confirmación extra si el tiempo
   mejora al líder por más de 10 s.
4. Pantalla de confirmación antes de guardar: "#525 · Sebastian Meza · 1:23.456".
5. Tras guardar, informar el resultado:
   - primer tiempo: "Queda P4 de 12";
   - mejora: "Nueva mejor marca (antes 1:24.010). Sube a P3";
   - no mejora: "No mejora su marca de 1:23.044. El ranking no cambia".
   Incluir botón "Deshacer" para el último ingreso.

**Corregir**

- Lista de intentos recientes con editar y borrar (con confirmación).
- Participantes: editar nombre y número, borrar, agregar piloto manualmente, y
  **fusionar** dos participantes de Open/Preparadores (por si alguien quedó
  duplicado de todas formas): los intentos pasan a uno y el otro se elimina.

**Configuración**

- Título del evento, pista, auto, nombre de la empresa de rental.
- Interruptor "Activar Preparadores". Apagado, ese ranking no aparece en ninguna
  parte del sitio.
- Zona de reinicio, exigiendo escribir BORRAR:
  - "Borrar todos los tiempos" (mantiene a los participantes);
  - "Borrar tiempos y participantes de Open/Preparadores" (mantiene a los pilotos).

## Diseño

- Estética de automovilismo: oscura, agresiva, alto contraste. Números tabulares
  para los tiempos. Usa tu criterio de diseño; que no parezca una plantilla.
- Colores y tipografías como variables CSS al inicio de la hoja de estilos, para
  cambiarlos rápido por los del club.
- Logos como archivos reemplazables: `assets/logo-club.svg` y
  `assets/logo-rental.svg`. Crea placeholders visibles ("LOGO CLUB", "LOGO
  RENTAL"). El nombre de la rental viene de `evento.rental_nombre`, con valor
  inicial "[Empresa Rental]". Explica en el README cómo reemplazarlos (también por
  PNG).

## Requisitos transversales

- Todo texto ingresado por personas se renderiza con `textContent`, nunca
  `innerHTML`.
- Interfaz completa en español.
- Modo demo con `?demo=1` (funciona también con `?tv=1&demo=1`): datos falsos sin
  backend, incluyendo un tiempo nuevo simulado cada ciertos segundos, para revisar
  el diseño y la rotación.
- Errores de red al guardar: mensaje claro y el dato ingresado no se pierde; se
  puede reintentar.

## Entregables

1. Código del sitio.
2. `supabase/schema.sql` y `supabase/seed_pilotos.sql`.
3. `README.md` con pasos exactos y en orden:
   - crear el proyecto en Supabase y ejecutar los dos SQL;
   - crear el usuario staff (auto-confirmado) e insertarlo en la tabla `staff`
     (incluye el SQL, buscando por correo);
   - desactivar el registro de nuevos usuarios;
   - completar `js/config.js`;
   - publicar en GitHub Pages;
   - reemplazar logos y colores;
   - checklist de prueba previo al evento.
4. Si `gh` está autenticado, crea el repo público y activa Pages; si no, deja las
   instrucciones en el README.

## Prioridades

**Imprescindible**: modelo de datos y RLS; ingreso de tiempos con la regla del
mejor tiempo; control de duplicados en Open; modo pantalla con dos rankings lado a
lado y actualización automática; vista de teléfono; login de staff; README.

**Deseable, solo si lo anterior ya funciona**: fusionar participantes; franja
"Último tiempo ingresado" en el modo pantalla; exportar cada ranking a CSV desde
la página de staff.

## Verificación antes de terminar

Levanta un servidor estático local y revisa en modo demo, con capturas:

- modo pantalla a 1920×1080 con 36 pilotos (rotación, top 5 fijo, sin scroll);
- modo pantalla con Preparadores activo (tres columnas);
- teléfono a 390×844 (pestañas y página de staff);
- los tres resultados del ingreso de tiempos (primer tiempo, mejora, no mejora) y
  el diálogo de nombre parecido en Open.

Dime qué quedó verificado y qué no pudiste probar sin el backend real.
