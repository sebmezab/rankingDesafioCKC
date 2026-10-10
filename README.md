# Leaderboard Desafío Simracing CKC

Ranking en vivo de vuelta rápida (Assetto Corsa) para el Club de Karting Concepción.
Sitio estático (HTML/CSS/JS sin build) en GitHub Pages + Supabase (Postgres, Auth, Realtime).

| Página | Para qué |
|---|---|
| `index.html` | Ranking público para teléfonos (pestañas Pilotos / Open / Preparadores) |
| `index.html?tv=1` | Modo pantalla 16:9 para el proyector/TV (rankings lado a lado, rotación, QR) |
| `admin.html` | Staff: ingresar tiempos, corregir y configurar. **No está enlazada desde el sitio público.** |
| `?demo=1` | Modo demo sin backend, en cualquiera de las anteriores (`index.html?tv=1&demo=1`, `admin.html?demo=1`) |

---

## Puesta en marcha (en este orden)

### 1. Crear el proyecto en Supabase y ejecutar los SQL

1. Entra a <https://supabase.com>, **New project**. Elige la región más cercana (São Paulo) y guarda la contraseña de la base.
2. Ve a **SQL Editor → New query**, pega el contenido completo de [`supabase/schema.sql`](supabase/schema.sql) y presiona **Run**.
3. Nueva query, pega [`supabase/seed_pilotos.sql`](supabase/seed_pilotos.sql) y **Run**. Quedan cargados los 36 pilotos.
4. Comprueba en **Table Editor** que existen `evento` (1 fila), `participantes` (36 filas), `intentos` y `staff`.

Los dos scripts se pueden volver a ejecutar sin duplicar datos.

### 2. Crear el usuario staff

1. **Authentication → Users → Add user → Create new user**.
2. Correo: el que vayas a poner en `STAFF_EMAIL` de `js/config.js` (por defecto `staff@ckc.cl`; no tiene que existir de verdad).
   Contraseña: la que usará el staff. Marca **Auto Confirm User**.
3. En el **SQL Editor**, autorízalo como staff (cambia el correo si usaste otro):

```sql
insert into public.staff (user_id)
select id from auth.users where email = 'staff@ckc.cl'
on conflict do nothing;

-- comprobar (debe devolver una fila)
select u.email from public.staff s join auth.users u on u.id = s.user_id;
```

Estar autenticado **no basta** para escribir: las políticas RLS exigen que el usuario esté en la tabla `staff`.

### 3. Desactivar el registro de nuevos usuarios

**Authentication → Sign In / Providers** (en algunas versiones: *Authentication → Settings*) → desactiva **Allow new users to sign up** → **Save**.

### 4. Completar `js/config.js`

En Supabase: **Project Settings → API** (o *Data API*). Copia:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',      // Project URL
SUPABASE_ANON_KEY: 'eyJhbGciOi...',                // anon / public key
STAFF_EMAIL: 'staff@ckc.cl',                       // el correo del paso 2
PUBLIC_URL: 'https://USUARIO.github.io/REPO/',     // para el QR (después del paso 5)
```

La *anon key* es pública por diseño (va en el navegador). **Nunca** pongas la `service_role` key.

### 5. Publicar en GitHub Pages

`git` y `gh` no estaban instalados en el equipo donde se generó el proyecto, así que el repo no se creó automáticamente. Opciones:

**A. Desde la web (sin instalar nada)**
1. En GitHub: **New repository** → nombre p. ej. `ranking-simracing-ckc` → **Public** → *Create*.
2. **Add file → Upload files** y arrastra *todo el contenido* de esta carpeta (incluido `.nojekyll`; si el explorador lo oculta, súbelo aparte o créalo con **Add file → Create new file** vacío llamado `.nojekyll`). No subas `PROMPT-leaderboard-simracing.md` si no quieres.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos queda en `https://USUARIO.github.io/ranking-simracing-ckc/`. Pon esa URL en `PUBLIC_URL` y vuelve a subir `js/config.js`.

**B. Con git** (instala [Git for Windows](https://git-scm.com/download/win) y opcionalmente [GitHub CLI](https://cli.github.com/)):

```powershell
git init -b main
git add .
git commit -m "Leaderboard simracing CKC"
gh repo create ranking-simracing-ckc --public --source . --push
gh api -X POST repos/{owner}/ranking-simracing-ckc/pages -f "source[branch]=main" -f "source[path]=/"
```

Todas las rutas del sitio son relativas, así que funciona bajo `/nombre-repo/`.

### 6. Reemplazar logos y colores

- **Logos**: `assets/logo-club.png` (Club de Karting Concepción) y `assets/logo-rental.png` (Formula Kart), copiados al repositorio para no depender de enlaces externos. Para cambiarlos, reemplaza esos archivos manteniendo el nombre (ideal: PNG con fondo transparente, pensado para fondo oscuro, al menos 400 px de ancho).
- **Nombre de la rental**: desde `admin.html → Configuración → Empresa de rental` (opcional: el logo ya dice Formula Kart; si se escribe algo, aparece junto al logo).
- **Colores y tipografías**: variables al inicio de [`css/base.css`](css/base.css) (`--accent` rojo principal, `--flag` amarillo de destacados, `--bg`…). Las fuentes vienen de Google Fonts (`Saira Condensed` y `Barlow Semi Condensed`), cargadas en el `<head>` de cada HTML.

### 7. Checklist de prueba previo al evento

Hazlo con la URL real de GitHub Pages, no con archivos locales.

- [ ] `index.html` carga y el indicador dice **En vivo** (punto verde).
- [ ] `admin.html`: entra con la contraseña. Con una contraseña incorrecta dice "Contraseña incorrecta".
- [ ] Ingresa un tiempo de prueba a un piloto → el resultado dice "Queda P1 de 1" y aparece **solo** (sin recargar) en el teléfono y en la TV.
- [ ] Ingresa un tiempo peor al mismo piloto → "No mejora su marca…"; el ranking no cambia.
- [ ] Ingresa uno mejor → "Nueva mejor marca (antes …)"; la fila se destaca en la TV.
- [ ] **Deshacer** quita el último ingreso.
- [ ] Open: crea "Juan Pérez" y luego intenta crear "juan perez" → aparece el diálogo "¿Ya está registrado?".
- [ ] Corregir → borra un intento → vuelve a valer la marca anterior.
- [ ] Configuración: título, pista, auto y rental se reflejan en la TV. Activa y desactiva Preparadores (2 ↔ 3 columnas).
- [ ] Modo pantalla en el PC de la TV: `index.html?tv=1` en Chrome, **F11** (o doble clic) para pantalla completa. Sin barras de scroll; el QR abre la página en un teléfono.
- [ ] Corta el wifi del PC de la TV 30 s y reconéctalo: los datos siguen en pantalla y vuelve a **En vivo** solo.
- [ ] Desactiva la suspensión/protector de pantalla del PC (el Wake Lock ayuda, pero no reemplaza esa configuración).
- [ ] Antes de abrir al público: **Configuración → Zona de reinicio → Borrar todos los tiempos** (escribir BORRAR).
- [ ] Proyecto Supabase gratuito: se pausa tras ~1 semana sin uso. Ábrelo en el dashboard el día anterior para confirmar que está activo.

---

## Uso durante el evento

**Staff (teléfono)**: Ranking → persona → tiempo → Revisar → Guardar.

- Pilotos: busca por número de kart (`21` o `51` encuentran a "21 / 51") o por nombre. Desde *Ingresar* no se crean pilotos; si falta alguno: *Corregir → Participantes → + Piloto*.
- Open / Preparadores: escribe el nombre; aparecen los ya registrados con su mejor tiempo. Si no está, *Crear «…»* (exige nombre y apellido). Si se parece a alguien existente (mayúsculas, tildes, orden de palabras o 1–2 letras de diferencia) hay que elegir "Es esta persona" o "Es alguien nuevo".
- Tiempo: `1:23.456`, `83.456` o solo dígitos `123456` (= 1:23.456). Se muestra el valor interpretado antes de guardar. Si es más de 10 s mejor que el líder, pide una confirmación extra.
- Si falla la red al guardar, el dato queda en pantalla: toca **Guardar** de nuevo.
- Si alguien quedó duplicado igual: *Corregir → Participantes → Fusionar*.
- *Configuración → Exportar*: CSV por ranking (separador `;`, se abre directo en Excel).

**Regla del mejor tiempo**: cada ingreso se guarda como un intento; el ranking muestra una fila por persona con su mejor intento (en empate gana quien lo marcó primero). Borrar un intento mal tipeado devuelve la marca anterior.

---

## Decisiones tomadas

- **Sin frameworks ni build**. Módulos ES nativos. `supabase-js` fijo en `2.45.4` vía jsDelivr (`+esm`), cargado **solo** fuera del modo demo. QR con `qrcode-generator@1.4.4` (jsDelivr); si no carga, se muestra la URL en texto.
- **`es_staff()` es `SECURITY DEFINER`**: la tabla `staff` no tiene políticas, así que una subconsulta normal desde una política RLS no vería filas. Las funciones de fusión y reinicio son `SECURITY INVOKER` (RLS sigue aplicando) y además verifican `es_staff()`.
- **Fila única de `evento`** forzada con `id = 1` + `check`.
- **Tiempo real**: un canal Realtime para las 3 tablas; ante cualquier cambio se recarga todo (con debounce de 250 ms) en vez de aplicar parches. Más simple y siempre consistente. Respaldo: sondeo cada 15 s, recarga al volver la conexión o la pestaña, y reconexión automática del canal. `replica identity full` en `participantes` e `intentos` para que lleguen los borrados.
- **Cache**: el último estado se guarda en `localStorage` y se pinta al abrir, así nunca hay pantalla en blanco aunque no haya red.
- **Destacado**: se compara el estado nuevo con el anterior; quien entra o mejora se destaca 6 s con etiqueta NUEVO / MEJORA. En la TV, la rotación salta a su página y se retiene ~12 s.
- **Modo pantalla**: todo se mide en `rem` y el `rem` depende del viewport (`min(1.85vh, 1.04vw)`), por eso 1080p y 4K se ven idénticos. Las filas por página se calculan midiendo el alto disponible. Top 5 fijo, resto rota cada 8 s (`TV_ROTACION_MS`, `TV_TOP_FIJO` en `config.js`). Franja inferior "Último tiempo" incluida.
- **Contador de pilotos**: "12 de 36" usa la cantidad de pilotos en la base (o `TOTAL_PILOTOS` en `config.js` si lo fijas).
- **Login**: solo contraseña; el correo fijo está en `config.js`. Tras iniciar sesión se verifica `es_staff()`; si no lo es, se cierra la sesión.
- **Similitud de nombres**: comparación sin mayúsculas/tildes/puntuación, mismas palabras en cualquier orden, o distancia de Levenshtein ≤ 2. Si el nombre es exactamente igual (sin distinguir mayúsculas) no se permite "alguien nuevo", porque el índice único lo rechazaría: hay que agregar una inicial.
- **Ingreso con red inestable**: si la persona nueva se creó pero falló el intento, el reintento reutiliza a esa persona (no la duplica). Si un intento llegó a guardarse pero la respuesta se perdió, el reintento crea un intento repetido con el mismo tiempo, lo que no altera el ranking.
- **Tiempo en dígitos**: últimos 3 = milésimas, 2 anteriores = segundos, el resto = minutos (`123456` = 1:23.456, `59999` = 0:59.999). Se rechazan vacío, cero y segundos ≥ 60 (en `83.456` los segundos pueden pasar de 60, ese es el formato).
- **Datos personales**: el repo solo contiene número de kart y nombre de los pilotos. Los nombres de Open/Preparadores del modo demo son inventados. `.gitignore` excluye `*.xlsx` y `*.csv`.
- **Modo demo**: datos en `localStorage` del navegador, compartidos entre pestañas (puedes abrir `admin.html?demo=1` y `index.html?tv=1&demo=1` lado a lado). La página pública simula un tiempo nuevo cada 6 s. Parámetros extra: `&prep=1` / `&prep=0` (Preparadores), `&reset=1` (datos iniciales), `&fallar=1` en admin (simula error de red al guardar).

## Estructura

```
index.html  admin.html  .nojekyll  .gitignore
css/base.css      variables (colores, fuentes) y estilos comunes
css/public.css    teléfono + modo pantalla
css/admin.css     staff
js/config.js      URL/key de Supabase, correo staff, ajustes
js/store.js       acceso a datos (Supabase o demo), tiempo real, cache
js/public.js      página pública
js/admin.js       página de staff
js/format.js      formato y parseo de tiempos
js/fuzzy.js       comparación de nombres
js/demo.js        datos del modo demo
assets/           logos reemplazables
supabase/         schema.sql, seed_pilotos.sql
```
