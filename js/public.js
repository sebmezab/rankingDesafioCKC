import { CONFIG } from './config.js';
import { crearStore, iniciarEnVivo, rankingsActivos, NOMBRE_RANKING, params, esDemo } from './store.js';
import { formatTiempo, formatGap } from './format.js';

const TV = params.get('tv') === '1';
const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const FLASH_MS = 6000;

const $ = (s) => document.querySelector(s);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};

const st = {
  snap: null,
  mejorPrevio: null,            // Map participante_id -> ms del snapshot anterior
  flash: new Map(),             // participante_id -> { desde, tag }
  tab: leerTab(),
  boards: new Map(),            // ranking -> refs DOM
  pagina: {},                   // ranking -> página actual (modo pantalla)
  paginas: {},                  // ranking -> total de páginas
  porPagina: {},
  retener: {},                  // ranking -> timestamp hasta el que no rota
  ultimoId: null,
};

function leerTab() { try { return localStorage.getItem('ckc-tab') || 'pilotos'; } catch { return 'pilotos'; } }
function guardarTab(t) { try { localStorage.setItem('ckc-tab', t); } catch { /* ignora */ } }

// ---------------------------------------------------------------------
// Encabezado
// ---------------------------------------------------------------------
function renderEvento(ev) {
  $('#ev-titulo').textContent = ev.titulo || 'Desafío Simracing';
  $('#ev-pista').textContent = ev.pista || '';
  $('#ev-auto').textContent = ev.auto || '';
  $('#ev-rental').textContent = ev.rental_nombre || '';
  document.title = `${ev.titulo || 'Desafío Simracing'} · Ranking en vivo`;
}

const TEXTO_CONN = { live: 'En vivo', polling: 'Actualizando cada 15 s', offline: 'Sin conexión · últimos datos', demo: 'Modo demo' };
function renderConexion(estado) {
  const e = esDemo ? 'demo' : estado;
  const c = $('#conn');
  c.dataset.estado = e;
  c.querySelector('span').textContent = TEXTO_CONN[e];
}

// ---------------------------------------------------------------------
// Datos derivados
// ---------------------------------------------------------------------
function filasDe(ranking) {
  return st.snap ? st.snap.leaderboard.filter(f => f.ranking === ranking) : [];
}
function totalPilotos() {
  if (CONFIG.TOTAL_PILOTOS) return CONFIG.TOTAL_PILOTOS;
  return st.snap ? st.snap.participantes.filter(p => p.ranking === 'pilotos').length : 0;
}
function textoContador(ranking, n) {
  const frag = document.createDocumentFragment();
  frag.append(el('b', null, String(n)));
  if (ranking === 'pilotos') frag.append(` de ${totalPilotos()} pilotos`);
  else frag.append(n === 1 ? ' participante' : ' participantes');
  return frag;
}

// ---------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------
function filaEl(f, pos, liderMs) {
  const li = el('li', 'row');
  if (pos <= 3) li.classList.add('p' + pos);
  li.dataset.id = f.participante_id;
  li.append(
    el('span', 'pos', String(pos)),
    el('span', 'num', f.numero ? f.numero : ''),
    el('span', 'nom', f.nombre),
    el('span', 't', formatTiempo(f.tiempo_ms)),
    el('span', 'gap', pos === 1 ? '' : formatGap(f.tiempo_ms - liderMs)),
  );
  li.querySelector('.nom').title = f.nombre;
  const fl = st.flash.get(f.participante_id);
  if (fl) {
    const pasado = Date.now() - fl.desde;
    if (pasado < FLASH_MS) {
      li.classList.add('flash');
      li.dataset.tag = fl.tag;
      li.style.animationDelay = `-${pasado}ms`;
    }
  }
  return li;
}

// ---------------------------------------------------------------------
// Tableros
// ---------------------------------------------------------------------
function crearBoard(ranking) {
  const sec = el('section', 'board');
  sec.dataset.ranking = ranking;
  sec.id = 'board-' + ranking;
  sec.setAttribute('role', 'tabpanel');
  if (ranking !== 'pilotos') sec.classList.add('sin-num');

  const head = el('div', 'board-head');
  const h2 = el('h2');
  const sesgo = el('span', 'sesgo');
  sesgo.append(el('span', null, NOMBRE_RANKING[ranking]));
  h2.append(sesgo);
  const contador = el('span', 'contador');
  head.append(h2, contador);

  const cols = el('div', 'cols');
  cols.append(el('span', 'c-pos', 'P'), el('span', 'num c-num', '#'),
    el('span', 'c-nom', ranking === 'pilotos' ? 'Piloto' : 'Nombre'),
    el('span', 'c-t', 'Tiempo'), el('span', 'c-gap', 'Dif.'));

  const fijas = el('ol', 'rows fijas');
  const sep = el('div', 'sep-fijo');
  const rotWrap = el('div', 'rot-wrap');
  const rot = el('ol', 'rows rot');
  rotWrap.append(rot);
  const pager = el('div', 'pager');
  const pagerTxt = el('span', 'tnum');
  const bar = el('div', 'bar');
  const barI = el('i');
  bar.append(barI);
  pager.append(pagerTxt, bar);

  sec.append(head, cols, fijas, sep, rotWrap, pager);
  return { sec, contador, cols, fijas, sep, rotWrap, rot, pager, pagerTxt, barI };
}

function asegurarBoards(activos) {
  const actuales = [...st.boards.keys()];
  if (actuales.join() === activos.join()) return;
  const main = $('#boards');
  main.replaceChildren();
  st.boards.clear();
  for (const r of activos) {
    const b = crearBoard(r);
    st.boards.set(r, b);
    main.append(b.sec);
  }
  document.documentElement.style.setProperty('--n-boards', activos.length);
  document.documentElement.classList.toggle('tres', activos.length === 3);
  if (!activos.includes(st.tab)) st.tab = 'pilotos';
}

function renderTabs(activos) {
  if (TV) return;
  const nav = $('#tabs');
  nav.replaceChildren();
  for (const r of activos) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'board-' + r);
    b.setAttribute('aria-selected', String(r === st.tab));
    const span = el('span', null, NOMBRE_RANKING[r]);
    span.append(el('small', null, String(filasDe(r).length)));
    b.append(span);
    b.addEventListener('click', () => {
      st.tab = r; guardarTab(r);
      render();
      scrollTo({ top: 0 });
    });
    nav.append(b);
  }
}

function render() {
  const ev = st.snap?.evento;
  const activos = rankingsActivos(ev);
  asegurarBoards(activos);
  renderTabs(activos);
  for (const r of activos) {
    const b = st.boards.get(r);
    b.sec.classList.toggle('activo', TV || r === st.tab);
    const filas = filasDe(r);
    b.contador.replaceChildren(textoContador(r, filas.length));
    if (TV) renderBoardTV(r, b, filas, false);
    else renderBoardMovil(b, filas);
  }
  if (TV) renderUltimo();
}

function estadoVacio() {
  const d = el('div', 'vacio');
  if (!st.snap) { d.textContent = 'Cargando…'; return d; }
  d.append('Aún no hay tiempos.', el('strong', null, '¡Sé el primero!'));
  return d;
}

function renderBoardMovil(b, filas) {
  b.fijas.replaceChildren();
  b.rot.replaceChildren();
  b.rotWrap.querySelector('.vacio')?.remove();
  b.cols.hidden = filas.length === 0;
  if (!filas.length) { b.rotWrap.append(estadoVacio()); return; }
  const lider = filas[0].tiempo_ms;
  const frag = document.createDocumentFragment();
  filas.forEach((f, i) => frag.append(filaEl(f, i + 1, lider)));
  b.rot.append(frag);
}

// ---------------------------------------------------------------------
// Modo pantalla: top fijo + rotación por páginas
// ---------------------------------------------------------------------
function medirPorPagina(b) {
  const H = b.rotWrap.clientHeight;
  const muestra = el('li', 'row');
  muestra.append(el('span', 'pos', '00'));
  b.rot.replaceChildren(muestra);
  const h = muestra.getBoundingClientRect().height;
  const gap = parseFloat(getComputedStyle(b.rot).rowGap) || 0;
  b.rot.replaceChildren();
  if (!h) return 8;
  return Math.max(1, Math.floor((H + gap) / (h + gap)));
}

function renderBoardTV(ranking, b, filas, animar) {
  const TOP = CONFIG.TV_TOP_FIJO;
  b.rotWrap.querySelector('.vacio')?.remove();
  b.cols.hidden = filas.length === 0;
  if (!filas.length) {
    b.fijas.replaceChildren(); b.rot.replaceChildren();
    b.sep.hidden = true; b.pagerTxt.textContent = ''; b.barI.classList.remove('corre');
    b.pager.classList.add('quieto');
    b.rotWrap.append(estadoVacio());
    st.paginas[ranking] = 1;
    return;
  }
  const lider = filas[0].tiempo_ms;

  const fijas = document.createDocumentFragment();
  filas.slice(0, TOP).forEach((f, i) => fijas.append(filaEl(f, i + 1, lider)));
  b.fijas.replaceChildren(fijas);

  const resto = filas.slice(TOP);
  b.sep.hidden = resto.length === 0;
  if (!resto.length) {
    b.rot.replaceChildren(); b.pagerTxt.textContent = ''; b.barI.classList.remove('corre');
    b.pager.classList.add('quieto');
    st.paginas[ranking] = 1; st.pagina[ranking] = 0;
    return;
  }

  const por = medirPorPagina(b);
  const paginas = Math.ceil(resto.length / por);
  st.porPagina[ranking] = por;
  st.paginas[ranking] = paginas;
  const pag = Math.min(st.pagina[ranking] || 0, paginas - 1);
  st.pagina[ranking] = pag;

  const desde = pag * por;
  const frag = document.createDocumentFragment();
  resto.slice(desde, desde + por).forEach((f, i) => frag.append(filaEl(f, TOP + desde + i + 1, lider)));
  b.rot.replaceChildren(frag);
  if (animar) { b.rot.classList.remove('entra'); void b.rot.offsetWidth; b.rot.classList.add('entra'); }

  const a = TOP + desde + 1, z = Math.min(TOP + desde + por, filas.length);
  b.pagerTxt.textContent = paginas > 1 ? `${a}–${z} de ${filas.length}` : '';
  b.pager.classList.toggle('quieto', paginas <= 1);
  if (paginas <= 1) b.barI.classList.remove('corre');
  else if (!b.barI.classList.contains('corre')) reiniciarBarra(b);
}

function reiniciarBarra(b) {
  b.barI.classList.remove('corre'); void b.barI.offsetWidth; b.barI.classList.add('corre');
}

function rotar() {
  const ahora = Date.now();
  for (const [r, b] of st.boards) {
    const paginas = st.paginas[r] || 1;
    if (paginas <= 1) continue;
    if ((st.retener[r] || 0) > ahora) continue;
    st.pagina[r] = ((st.pagina[r] || 0) + 1) % paginas;
    renderBoardTV(r, b, filasDe(r), true);
    reiniciarBarra(b);
  }
}

/** Salta a la página donde quedó la persona que acaba de marcar. */
function saltarA(ranking, participanteId) {
  const b = st.boards.get(ranking);
  if (!b) return;
  const filas = filasDe(ranking);
  const idx = filas.findIndex(f => f.participante_id === participanteId);
  const TOP = CONFIG.TV_TOP_FIJO;
  if (idx >= TOP) {
    const por = st.porPagina[ranking] || medirPorPagina(b);
    st.pagina[ranking] = Math.floor((idx - TOP) / por);
  }
  st.retener[ranking] = Date.now() + CONFIG.TV_ROTACION_MS * 1.5;
  renderBoardTV(ranking, b, filas, idx >= TOP);
  if ((st.paginas[ranking] || 1) > 1) reiniciarBarra(b);
}

function renderUltimo() {
  const foot = $('#ultimo');
  // El intento más reciente de un ranking visible (Preparadores puede estar apagado).
  const activos = rankingsActivos(st.snap?.evento);
  let u = null, p = null;
  for (const i of st.snap?.ultimos || []) {
    const x = st.snap.participantes.find(q => q.id === i.participante_id);
    if (x && activos.includes(x.ranking)) { u = i; p = x; break; }
  }
  if (!u) { foot.hidden = true; return; }
  const filas = filasDe(p.ranking);
  const idx = filas.findIndex(f => f.participante_id === p.id);
  const fila = filas[idx];
  $('#u-num').textContent = p.numero ? '#' + p.numero : NOMBRE_RANKING[p.ranking];
  $('#u-nom').textContent = p.nombre;
  $('#u-t').textContent = formatTiempo(u.tiempo_ms);
  const res = $('#u-res');
  res.classList.remove('mejora');
  if (fila && fila.tiempo_ms === u.tiempo_ms) {
    res.textContent = `${fila.intentos > 1 ? 'Nueva mejor marca' : 'Entra'} · P${idx + 1} ${NOMBRE_RANKING[p.ranking]}`;
    res.classList.add('mejora');
  } else if (fila) {
    res.textContent = `No mejora su marca (${formatTiempo(fila.tiempo_ms)}) · P${idx + 1}`;
  } else {
    res.textContent = '';
  }
  foot.hidden = false;
  if (st.ultimoId !== null && st.ultimoId !== u.id) {
    foot.classList.remove('nuevo'); void foot.offsetWidth; foot.classList.add('nuevo');
  }
  st.ultimoId = u.id;
}

// ---------------------------------------------------------------------
// Llegada de datos
// ---------------------------------------------------------------------
function alRecibir(snap) {
  const cambios = [];
  if (st.mejorPrevio) {
    for (const f of snap.leaderboard) {
      const antes = st.mejorPrevio.get(f.participante_id);
      if (antes === undefined) cambios.push({ f, tag: 'NUEVO' });
      else if (f.tiempo_ms < antes) cambios.push({ f, tag: 'MEJORA' });
    }
  }
  st.mejorPrevio = new Map(snap.leaderboard.map(f => [f.participante_id, f.tiempo_ms]));
  const ahora = Date.now();
  for (const [id, fl] of st.flash) if (ahora - fl.desde > FLASH_MS) st.flash.delete(id);
  for (const c of cambios) st.flash.set(c.f.participante_id, { desde: ahora, tag: c.tag });

  st.snap = snap;
  renderEvento(snap.evento);
  render();

  if (TV) {
    // Si varios rankings cambian a la vez, se salta en cada uno al más reciente.
    const porRanking = new Map();
    for (const c of cambios) porRanking.set(c.f.ranking, c.f);
    for (const [r, f] of porRanking) saltarA(r, f.participante_id);
  }
  // En el teléfono no se cambia de pestaña; solo se ve el destacado.
}

// ---------------------------------------------------------------------
// Modo pantalla: QR, Wake Lock, pantalla completa
// ---------------------------------------------------------------------
function urlPublica() {
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL;
  const u = new URL(location.href);
  ['tv', 'prep', 'reset'].forEach(k => u.searchParams.delete(k));
  u.hash = '';
  return u.toString();
}

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = ok; s.onerror = mal;
    document.head.append(s);
  });
}

async function pintarQR() {
  const url = urlPublica();
  $('#qr-url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    if (!window.qrcode) await cargarScript(QR_CDN);
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount(), m = 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n + 2 * m} ${n + 2 * m}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('aria-label', 'Código QR: ' + url);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.append(path);
    $('#qr-img').replaceChildren(svg);
  } catch {
    $('#qr-img').hidden = true;  // sin QR: queda la URL en texto
  }
}

let wakeLock = null;
async function pedirWakeLock() {
  try {
    if ('wakeLock' in navigator && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* no soportado o denegado: se reintenta al volver a la pestaña */ }
}

function iniciarTV() {
  document.documentElement.style.setProperty('--rot-ms', CONFIG.TV_ROTACION_MS + 'ms');
  pintarQR();
  pedirWakeLock();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !wakeLock) pedirWakeLock(); });
  // El primer clic también sirve para pedir el wake lock (algunos navegadores lo exigen).
  addEventListener('click', () => { if (!wakeLock) pedirWakeLock(); });
  addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  setInterval(rotar, CONFIG.TV_ROTACION_MS);
  let t = null;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 200); });
}

function ajustarStickyMovil() {
  const fijar = () => document.documentElement.style.setProperty('--alto-top', $('#top').offsetHeight + 'px');
  fijar();
  addEventListener('resize', fijar);
  document.fonts?.ready.then(fijar);
}

// ---------------------------------------------------------------------
async function main() {
  render();  // estructura vacía ("Cargando…") de inmediato
  if (TV) iniciarTV(); else ajustarStickyMovil();
  let store;
  for (;;) {
    try { store = await crearStore({ simular: esDemo }); break; }
    catch (e) {
      // Sin acceso al CDN: mostrar lo que haya en cache y reintentar.
      console.warn('No se pudo iniciar el cliente', e);
      try {
        const c = JSON.parse(localStorage.getItem('ckc-cache-supabase'));
        if (c && c.evento && !st.snap) alRecibir(c);
      } catch { /* sin cache */ }
      renderConexion('offline');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  iniciarEnVivo(store, { onDatos: alRecibir, onEstado: renderConexion });
  document.fonts?.ready.then(() => render());
}

main();
