import { CONFIG } from './config.js';
import {
  crearStore, iniciarEnVivo, rankingsActivos, NOMBRE_RANKING, esDemo, traducirError, ordenar,
} from './store.js';
import { formatTiempo, parseTiempo, enmascararTiempo } from './format.js';
import { buscarParecidos, coincideNombre, coincideNumero, normalizar } from './fuzzy.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, texto) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto != null) e.textContent = texto;
  return e;
};
const boton = (texto, cls, onClick) => {
  const b = el('button', cls, texto);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
};

let store = null;
let snap = null;
let vista = 'ingresar';
let sub = 'intentos';
let rankingPart = 'pilotos';
let eventoSucio = false;

// Estado del ingreso en curso
const ing = {
  ranking: 'pilotos',
  persona: null,   // { id|null, ranking, nombre, numero }
  ms: null,
  guardando: false,
  ultimo: null,    // { intentoId, persona, ms } para "Deshacer"
};

// ---------------------------------------------------------------------
// Utilidades de datos
// ---------------------------------------------------------------------
const filas = (s, r) => (s ? s.leaderboard.filter(f => f.ranking === r) : []);
const filaDe = (s, pid) => s?.leaderboard.find(f => f.participante_id === pid) || null;
function posDe(s, r, pid) {
  const lista = filas(s, r);
  const i = lista.findIndex(f => f.participante_id === pid);
  return i < 0 ? null : { pos: i + 1, total: lista.length, fila: lista[i] };
}
const etiqueta = (p) => (p.numero ? `#${p.numero} · ` : '') + p.nombre;
const participante = (id) => snap?.participantes.find(p => p.id === id) || null;
const limpiarNombre = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const primerNumero = (n) => parseInt(String(n || '').match(/\d+/)?.[0] ?? '99999', 10);

function infoMarca(pid) {
  if (!pid) return 'Nuevo · sin tiempo';
  const p = participante(pid);
  const pd = p && posDe(snap, p.ranking, pid);
  return pd ? `Mejor ${formatTiempo(pd.fila.tiempo_ms)} · P${pd.pos} de ${pd.total}` : 'Sin tiempo aún';
}

// ---------------------------------------------------------------------
// Avisos y diálogos
// ---------------------------------------------------------------------
let toastT = null;
function aviso(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, error ? 5000 : 2600);
}

/**
 * Diálogo modal. `contenido` puede ser un nodo o una función (cerrar) => nodo.
 * Cada botón: { texto, clase, valor, accion?: async () => any, habilitar?: () => bool }.
 * Si `accion` falla, se muestra el error y el diálogo sigue abierto (reintentable).
 */
function dialogo({ titulo, texto, contenido, botones = [] }) {
  return new Promise((resolve) => {
    const d = el('dialog', 'hoja');
    let cerrado = false;
    const cerrar = (v) => {
      if (cerrado) return;
      cerrado = true;
      d.close(); d.remove();
      resolve(v);
    };
    d.append(el('h3', null, titulo));
    if (texto) d.append(el('p', 'h-txt', texto));
    if (contenido) d.append(typeof contenido === 'function' ? contenido(cerrar) : contenido);
    const err = el('p', 'err');
    d.append(err);
    const fila = el('div', 'botones');
    const refrescar = () => botones.forEach(b => { if (b.habilitar) b._btn.disabled = !b.habilitar(); });
    for (const b of botones) {
      const btn = boton(b.texto, b.clase || 'btn-sec');
      b._btn = btn;
      btn.addEventListener('click', async () => {
        if (!b.accion) return cerrar(b.valor);
        err.textContent = '';
        const t = btn.textContent;
        btn.disabled = true; btn.textContent = 'Guardando…';
        try {
          const r = await b.accion();
          if (r === false) { btn.disabled = false; btn.textContent = t; return; }
          cerrar(b.valor ?? true);
        } catch (e) {
          err.textContent = traducirError(e);
          btn.disabled = false; btn.textContent = t;
          refrescar();
        }
      });
      fila.append(btn);
    }
    if (botones.length) d.append(fila);
    d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
    d.addEventListener('input', refrescar);
    document.body.append(d);
    refrescar();
    d.showModal();
    d.querySelector('input:not([type=checkbox])')?.focus();
  });
}

/**
 * Autocompleta ":" y "." mientras se escribe un tiempo. Registrar antes que
 * los demás listeners de input para que ellos lean el valor ya formateado.
 */
function mascaraTiempo(input) {
  input.addEventListener('input', (e) => {
    const v = input.value;
    const tipo = e.inputType || '';
    if (tipo === 'insertFromPaste' || tipo === 'insertFromDrop' || (e.data && e.data.length > 1)) {
      // Lo pegado o dictado con separadores ("83.456", "1:23.456") se interpreta tal cual.
      const r = parseTiempo(v);
      if (r.ok && /[:.,]/.test(v)) { input.value = formatTiempo(r.ms); return; }
    }
    const caret = input.selectionStart ?? v.length;
    const alFinal = caret === v.length;
    const nuevo = enmascararTiempo(v, tipo.startsWith('insert') && alFinal);
    if (nuevo === v) return;
    input.value = nuevo;
    let pos = nuevo.length;
    if (!alFinal) {
      // Mantiene el cursor detrás del mismo dígito al editar en medio.
      const digitos = v.slice(0, caret).replace(/\D/g, '').length;
      pos = 0;
      for (let n = 0; pos < nuevo.length && n < digitos; pos++) if (/\d/.test(nuevo[pos])) n++;
    }
    input.setSelectionRange(pos, pos);
  });
}

function campo(label, input) {
  const l = el('label', 'campo');
  l.append(el('span', null, label), input);
  return l;
}
function inputTexto(valor = '', extra = {}) {
  const i = el('input', 'input');
  i.value = valor;
  Object.assign(i, extra);
  return i;
}

// ---------------------------------------------------------------------
// Arranque, login, navegación
// ---------------------------------------------------------------------
async function arrancar() {
  $('#arranque').hidden = false;
  $('#arranque-txt').textContent = 'Cargando…';
  $('#arranque-reintentar').hidden = true;
  try {
    store = await crearStore({ simular: false });
    const ses = await store.sesion();
    $('#arranque').hidden = true;
    if (ses) iniciarApp();
    else mostrarLogin();
  } catch (e) {
    console.error(e);
    $('#arranque-txt').textContent = 'No se pudo conectar. Revisa internet. ' + traducirError(e);
    $('#arranque-reintentar').hidden = false;
  }
}
$('#arranque-reintentar').addEventListener('click', arrancar);

function mostrarLogin() {
  document.querySelector('#f-login input[name=username]').value = CONFIG.STAFF_EMAIL;
  $('#login').hidden = false;
  $('#pw').focus();
}
$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-login');
  $('#login-err').textContent = '';
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await store.login($('#pw').value);
    $('#login').hidden = true;
    iniciarApp();
  } catch (err) {
    $('#login-err').textContent = traducirError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('#btn-salir').addEventListener('click', async () => {
  const ok = await dialogo({
    titulo: 'Salir', texto: '¿Cerrar la sesión de staff en este teléfono?',
    botones: [{ texto: 'Cancelar' }, { texto: 'Salir', clase: 'btn-pri', valor: true }],
  });
  if (!ok) return;
  await store.logout().catch(() => {});
  location.reload();
});

let appIniciada = false;
function iniciarApp() {
  if (appIniciada) return;
  appIniciada = true;
  $('#app').hidden = false;
  if (esDemo) {
    $('#lnk-publico').href = 'index.html?demo=1';
    $('#lnk-tv').href = 'index.html?tv=1&demo=1';
    $('#modo-txt').textContent = 'Modo demo: los datos son de prueba y se guardan solo en este navegador.';
  }
  iniciarEnVivo(store, { onDatos: alRecibir, onEstado: renderConexion });
  irA('ingresar');
  renderIngreso();
}

const TEXTO_CONN = { live: 'En vivo', polling: 'Sondeo', offline: 'Sin conexión', demo: 'Demo' };
function renderConexion(estado) {
  const e = esDemo ? 'demo' : estado;
  $('#conn').dataset.estado = e;
  $('#conn span').textContent = TEXTO_CONN[e];
}

for (const b of document.querySelectorAll('#bnav button')) {
  b.addEventListener('click', () => irA(b.dataset.vista));
}
function irA(v) {
  vista = v;
  for (const b of document.querySelectorAll('#bnav button')) {
    if (b.dataset.vista === v) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  $('#v-ingresar').hidden = v !== 'ingresar';
  $('#v-corregir').hidden = v !== 'corregir';
  $('#v-config').hidden = v !== 'config';
  scrollTo({ top: 0 });
  if (v === 'corregir') renderCorregir(true);
  if (v === 'config') renderConfig();
}

function alRecibir(s) {
  snap = s;
  $('#a-ev').textContent = [s.evento.titulo, s.evento.pista].filter(Boolean).join(' · ');
  const activos = rankingsActivos(s.evento);
  if (!activos.includes(ing.ranking) && !ing.persona) ing.ranking = 'pilotos';
  if (!activos.includes(rankingPart)) rankingPart = 'pilotos';
  renderIngreso(true);
  if (vista === 'corregir') renderCorregir(false);
  if (vista === 'config') renderConfig();
}

// ---------------------------------------------------------------------
// INGRESAR
// ---------------------------------------------------------------------
function renderSegmentado(cont, activo, alElegir) {
  const activos = rankingsActivos(snap?.evento);
  cont.replaceChildren(...activos.map(r => {
    const b = boton(NOMBRE_RANKING[r], null, () => alElegir(r));
    b.setAttribute('aria-pressed', String(r === activo));
    return b;
  }));
}

function renderIngreso(desdeDatos = false) {
  renderSegmentado($('#seg-ranking'), ing.ranking, (r) => {
    if (r === ing.ranking) return;
    ing.ranking = r; ing.persona = null;
    $('#q').value = '';
    renderIngreso();
    $('#q').focus();
  });
  const esPil = ing.ranking === 'pilotos';
  $('#persona-tit').textContent = esPil ? 'Piloto' : 'Participante';
  $('#q').placeholder = esPil ? 'Número de kart o nombre' : 'Nombre y apellido';
  $('#q').inputMode = 'text';
  $('#q-ayuda').textContent = esPil
    ? 'Busca en la lista de pilotos inscritos.'
    : 'Escribe nombre y apellido: si ya corrió, elígelo de la lista; si no, se crea al guardar.';

  const p = ing.persona;
  $('#elegida').hidden = !p;
  $('#buscador').hidden = !!p;
  if (p) {
    $('#e-nom').textContent = etiqueta(p);
    $('#e-info').textContent = infoMarca(p.id);
  } else {
    renderResultados();
  }
  if (!desdeDatos) actualizarPrevTiempo();
}

function renderResultados() {
  const q = $('#q').value.trim();
  const r = ing.ranking;
  let lista = (snap?.participantes || []).filter(p => p.ranking === r);
  if (r === 'pilotos') {
    const soloNum = /^\d+$/.test(q);
    if (q) lista = lista.filter(p => soloNum ? coincideNumero(p.numero, q) : (coincideNombre(p.nombre, q) || coincideNumero(p.numero, q)));
    lista.sort((a, b) => primerNumero(a.numero) - primerNumero(b.numero));
  } else {
    // Autocompletar: solo sugiere mientras se escribe, primero los que empiezan igual.
    const nq = normalizar(q);
    lista = q ? lista.filter(p => coincideNombre(p.nombre, q)) : [];
    const empieza = (p) => (normalizar(p.nombre).startsWith(nq) ? 0 : 1);
    lista.sort((a, b) => empieza(a) - empieza(b) || a.nombre.localeCompare(b.nombre, 'es'));
    lista = lista.slice(0, 8);
  }

  const ul = $('#resultados');
  const items = lista.slice(0, 60).map(p => {
    const li = el('li');
    const b = boton(null, 'item', () => elegirPersona(p));
    if (r === 'pilotos') b.append(el('span', 'i-num', p.numero ? '#' + p.numero : '—'));
    b.append(el('span', 'i-nom', p.nombre));
    const pd = posDe(snap, r, p.id);
    b.append(el('span', 'i-t', pd ? `${formatTiempo(pd.fila.tiempo_ms)} · P${pd.pos}` : 'sin tiempo'));
    li.append(b);
    return li;
  });
  if (r !== 'pilotos' && q && !exactoDe(q)) {
    const li = el('li');
    const b = boton(null, 'item crear', () => crearNuevo(q));
    b.append(el('span', 'i-nom', `Nuevo: «${limpiarNombre(q)}»`), el('span', 'i-t', 'se crea al guardar'));
    li.append(b);
    items.push(li);
  }
  if (!items.length && r === 'pilotos') {
    items.push(el('li', 'lista-vacia', 'Ningún piloto coincide. Los pilotos se agregan desde Corregir > Participantes.'));
  }
  ul.replaceChildren(...items);
}

$('#q').addEventListener('input', renderResultados);
$('#q').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (ing.ranking !== 'pilotos') {
    if ($('#q').value.trim() && await resolverTexto()) $('#tiempo').focus();
    return;
  }
  const primero = $('#resultados .item');
  if (primero) primero.click();
});

/** Participante del ranking actual con exactamente ese nombre (sin tildes/mayúsculas). */
function exactoDe(texto) {
  const n = normalizar(texto);
  return (snap?.participantes || []).find(p => p.ranking === ing.ranking && normalizar(p.nombre) === n) || null;
}

/**
 * Open/Preparadores: convierte lo escrito en el buscador en la persona del
 * ingreso. Usa al existente si el nombre coincide; si no, la deja como nueva
 * (se crea al guardar), preguntando antes si se parece a alguien.
 */
async function resolverTexto() {
  const q = $('#q').value;
  const exacto = exactoDe(q);
  if (exacto) { elegirPersona(exacto); return true; }
  return crearNuevo(q);
}
$('#e-cambiar').addEventListener('click', () => {
  ing.persona = null;
  renderIngreso();
  $('#q').focus();
  $('#q').select();
});

function elegirPersona(p) {
  ing.persona = { id: p.id, ranking: p.ranking, nombre: p.nombre, numero: p.numero };
  renderIngreso();
  $('#tiempo').focus();
}

async function crearNuevo(texto) {
  const nombre = limpiarNombre(texto);
  if (nombre.split(' ').filter(w => w.length >= 2).length < 2) {
    aviso('Escribe nombre y apellido.', true);
    $('#q').focus();
    return false;
  }
  const existentes = snap.participantes.filter(p => p.ranking === ing.ranking);
  const parecidos = buscarParecidos(nombre, existentes);
  if (parecidos.length) {
    const exacto = existentes.some(p => p.nombre.toLowerCase() === nombre.toLowerCase());
    const elegido = await dialogo({
      titulo: '¿Ya está registrado?',
      texto: `«${nombre}» se parece a alguien que ya está en ${NOMBRE_RANKING[ing.ranking]}. Elige una opción para no duplicar a nadie.`,
      contenido: (cerrar) => {
        const ops = el('div', 'opciones');
        for (const { p, motivo } of parecidos) {
          const b = boton(null, 'opcion misma', () => cerrar({ existente: p }));
          b.append(el('b', null, `Es esta persona: ${p.nombre}`), el('small', null, `${infoMarca(p.id)} · ${motivo}`));
          ops.append(b);
        }
        const n = boton(null, 'opcion nueva', () => cerrar({ nueva: true }));
        n.append(el('b', null, `Es alguien nuevo: ${nombre}`),
          el('small', null, exacto ? 'No disponible: ya existe ese nombre exacto. Agrega una inicial para distinguirlo.' : 'Se creará un participante nuevo'));
        n.disabled = exacto;
        ops.append(n);
        return ops;
      },
      botones: [{ texto: 'Volver' }],
    });
    if (!elegido) return false;
    if (elegido.existente) { elegirPersona(elegido.existente); return true; }
  }
  ing.persona = { id: null, ranking: ing.ranking, nombre, numero: null };
  renderIngreso();
  $('#tiempo').focus();
  return true;
}

function actualizarPrevTiempo() {
  const v = $('#tiempo').value;
  const prev = $('#tiempo-prev');
  prev.className = 'prev';
  prev.replaceChildren();
  ing.ms = null;
  if (!v.trim()) return;
  const r = parseTiempo(v);
  if (r.ok) {
    ing.ms = r.ms;
    prev.classList.add('ok');
    prev.append('= ', el('b', null, formatTiempo(r.ms)));
  } else {
    prev.classList.add('mal');
    prev.textContent = r.error;
  }
}
mascaraTiempo($('#tiempo'));
$('#tiempo').addEventListener('input', actualizarPrevTiempo);
$('#tiempo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); revisar(); } });
$('#btn-revisar').addEventListener('click', revisar);

async function revisar() {
  // En Open/Preparadores basta con escribir el nombre: se resuelve aquí.
  if (!ing.persona && ing.ranking !== 'pilotos' && $('#q').value.trim()) {
    if (!await resolverTexto()) return;
  }
  if (!ing.persona) {
    aviso(ing.ranking === 'pilotos' ? 'Elige un piloto.' : 'Elige o crea un participante.', true);
    $('#q').focus();
    return;
  }
  const r = parseTiempo($('#tiempo').value);
  if (!r.ok) {
    actualizarPrevTiempo();
    aviso(r.error, true);
    $('#tiempo').focus();
    return;
  }
  ing.ms = r.ms;
  const p = ing.persona;
  $('#c-linea').textContent = `${etiqueta(p)} · ${formatTiempo(r.ms)}`;
  $('#c-ctx').textContent = `${NOMBRE_RANKING[p.ranking]} · ${p.id ? infoMarca(p.id) : 'Participante nuevo (se crea al guardar)'}`;
  $('#c-err').textContent = '';

  const lider = filas(snap, p.ranking)[0];
  const sospechoso = lider && r.ms < lider.tiempo_ms - 10000;
  $('#c-alerta').hidden = !sospechoso;
  $('#c-alerta-ok').checked = false;
  if (sospechoso) {
    $('#c-alerta-txt').textContent =
      `Este tiempo es ${((lider.tiempo_ms - r.ms) / 1000).toFixed(3)} s mejor que el líder (${formatTiempo(lider.tiempo_ms)}). Confirmo que está bien leído.`;
  }
  actualizarBotonGuardar();
  mostrarPanel('confirmar');
}
$('#c-alerta-ok').addEventListener('change', actualizarBotonGuardar);
function actualizarBotonGuardar() {
  $('#c-guardar').disabled = ing.guardando || (!$('#c-alerta').hidden && !$('#c-alerta-ok').checked);
}

function mostrarPanel(cual) {
  $('#form-ingreso').hidden = cual !== 'form';
  $('#confirmar').hidden = cual !== 'confirmar';
  $('#resultado').hidden = cual !== 'resultado';
  scrollTo({ top: 0 });
}
$('#c-volver').addEventListener('click', () => { mostrarPanel('form'); $('#tiempo').focus(); });
$('#c-guardar').addEventListener('click', guardar);

async function guardar() {
  if (ing.guardando) return;
  ing.guardando = true;
  const btn = $('#c-guardar');
  btn.textContent = 'Guardando…';
  actualizarBotonGuardar();
  $('#c-err').textContent = '';
  const p = ing.persona;
  const ms = ing.ms;
  const antes = snap;
  try {
    if (!p.id) {
      // Si esto funciona pero falla el intento, el id queda guardado y el
      // reintento no vuelve a crear a la persona.
      const nuevo = await store.crearParticipante({ ranking: p.ranking, nombre: p.nombre, numero: null });
      p.id = nuevo.id;
    }
    const prev = posDe(antes, p.ranking, p.id);
    const intento = await store.agregarIntento(p.id, ms);
    let despues = null;
    try { despues = await store.cargar(); alRecibir(despues); } catch { /* se estima localmente */ }
    const nuevo = despues ? posDe(despues, p.ranking, p.id) : estimarPos(antes, p, ms);
    mostrarResultado(p, ms, prev, nuevo);
    ing.ultimo = { intentoId: intento.id, persona: { ...p }, ms };
  } catch (e) {
    console.error(e);
    $('#c-err').textContent = `${traducirError(e)} Los datos siguen aquí: toca Guardar para reintentar.`;
  } finally {
    ing.guardando = false;
    btn.textContent = 'Guardar';
    actualizarBotonGuardar();
  }
}

/** Posición estimada sin red (si no se pudo recargar tras guardar). */
function estimarPos(s, p, ms) {
  const lista = filas(s, p.ranking).map(f => ({ ...f }));
  const f = lista.find(x => x.participante_id === p.id);
  if (!f) lista.push({ participante_id: p.id, tiempo_ms: ms, marcado_en: new Date().toISOString() });
  else if (ms < f.tiempo_ms) { f.tiempo_ms = ms; f.marcado_en = new Date().toISOString(); }
  const ord = ordenar(lista);
  const i = ord.findIndex(x => x.participante_id === p.id);
  return { pos: i + 1, total: ord.length, fila: ord[i] };
}

function mostrarResultado(p, ms, prev, nuevo) {
  $('#r-quien').textContent = `${etiqueta(p)} · ${formatTiempo(ms)}`;
  const m = $('#r-msg');
  m.className = 'r-msg';
  if (!prev) {
    m.textContent = `Queda P${nuevo.pos} de ${nuevo.total}`;
    m.classList.add('primero');
  } else if (ms < prev.fila.tiempo_ms) {
    const mov = nuevo.pos < prev.pos ? `Sube a P${nuevo.pos}` : `Se mantiene en P${nuevo.pos}`;
    m.textContent = `Nueva mejor marca (antes ${formatTiempo(prev.fila.tiempo_ms)}). ${mov}`;
    m.classList.add('mejora');
  } else {
    m.textContent = `No mejora su marca de ${formatTiempo(prev.fila.tiempo_ms)}. El ranking no cambia`;
    m.classList.add('igual');
  }
  $('#r-err').textContent = '';
  $('#r-deshacer').disabled = false;
  mostrarPanel('resultado');
}

$('#r-siguiente').addEventListener('click', () => {
  ing.persona = null;
  ing.ultimo = null;
  $('#q').value = '';
  $('#tiempo').value = '';
  mostrarPanel('form');
  renderIngreso();
  $('#q').focus();
});

$('#r-deshacer').addEventListener('click', async () => {
  const u = ing.ultimo;
  if (!u) return;
  const btn = $('#r-deshacer');
  btn.disabled = true; btn.textContent = 'Deshaciendo…';
  $('#r-err').textContent = '';
  try {
    await store.borrarIntento(u.intentoId);
    ing.ultimo = null;
    // Se deja todo listo para corregir y volver a guardar.
    ing.persona = u.persona;
    $('#tiempo').value = formatTiempo(u.ms);
    mostrarPanel('form');
    renderIngreso();
    aviso('Ingreso deshecho');
    $('#tiempo').focus();
  } catch (e) {
    $('#r-err').textContent = traducirError(e) + ' Toca Deshacer para reintentar.';
    btn.disabled = false;
  } finally {
    btn.textContent = 'Deshacer';
  }
});

// ---------------------------------------------------------------------
// CORREGIR
// ---------------------------------------------------------------------
for (const b of document.querySelectorAll('#sub-tabs button')) {
  b.addEventListener('click', () => {
    sub = b.dataset.sub;
    for (const x of document.querySelectorAll('#sub-tabs button')) x.setAttribute('aria-pressed', String(x === b));
    renderCorregir(true);
  });
}
$('#q-part').addEventListener('input', () => renderParticipantes());
$('#btn-add-piloto').addEventListener('click', agregarPiloto);

let intentosCache = [];
let intentosPidiendo = false;
async function renderCorregir(recargarIntentos) {
  $('#sub-intentos').hidden = sub !== 'intentos';
  $('#sub-participantes').hidden = sub !== 'participantes';
  if (sub === 'participantes') return renderParticipantes();
  renderIntentos();
  if (intentosPidiendo) return;
  intentosPidiendo = true;
  try {
    intentosCache = await store.intentosRecientes(80);
    renderIntentos();
  } catch (e) {
    if (recargarIntentos) aviso('No se pudieron cargar los intentos: ' + traducirError(e), true);
  } finally {
    intentosPidiendo = false;
  }
}

function hora(iso) {
  try { return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function renderIntentos() {
  const ul = $('#l-intentos');
  const items = intentosCache.map(i => {
    const p = participante(i.participante_id);
    const li = el('li', 'fila-ed');
    const f1 = el('div', 'f1');
    f1.append(el('b', null, p ? etiqueta(p) : '(participante borrado)'), el('span', 'tnum', formatTiempo(i.tiempo_ms)));
    const f2 = el('div', 'f2');
    f2.append(el('span', 'badge', p ? NOMBRE_RANKING[p.ranking] : '—'), el('span', null, hora(i.created_at)));
    const mejor = p && filaDe(snap, p.id);
    if (mejor && mejor.tiempo_ms === i.tiempo_ms) f2.append(el('span', 'badge mejor', 'Mejor marca'));
    const acc = el('div', 'acc');
    acc.append(
      boton('Editar', 'btn-sec', () => editarIntento(i, p)),
      boton('Borrar', 'btn-peligro', () => borrarIntento(i, p)),
    );
    f2.append(acc);
    li.append(f1, f2);
    return li;
  });
  if (!items.length) items.push(el('li', 'lista-vacia', 'Aún no hay intentos.'));
  ul.replaceChildren(...items);
}

async function editarIntento(i, p) {
  const input = inputTexto(formatTiempo(i.tiempo_ms), { inputMode: 'decimal', autocomplete: 'off' });
  input.classList.add('grande', 'tnum');
  const prev = el('p', 'prev');
  const actualizar = () => {
    const r = parseTiempo(input.value);
    prev.className = 'prev ' + (r.ok ? 'ok' : 'mal');
    prev.textContent = r.ok ? '= ' + formatTiempo(r.ms) : r.error;
  };
  mascaraTiempo(input);
  input.addEventListener('input', actualizar);
  actualizar();
  const cont = el('div');
  cont.append(campo('Tiempo', input), prev);
  const ok = await dialogo({
    titulo: 'Editar tiempo',
    texto: p ? etiqueta(p) : '',
    contenido: cont,
    botones: [
      { texto: 'Cancelar' },
      {
        texto: 'Guardar', clase: 'btn-pri',
        habilitar: () => parseTiempo(input.value).ok,
        accion: () => store.editarIntento(i.id, parseTiempo(input.value).ms),
      },
    ],
  });
  if (ok) { aviso('Tiempo corregido'); renderCorregir(false); }
}

async function borrarIntento(i, p) {
  const ok = await dialogo({
    titulo: 'Borrar tiempo',
    texto: `¿Borrar ${formatTiempo(i.tiempo_ms)} de ${p ? etiqueta(p) : 'este participante'}? Si era su mejor marca, vuelve a valer la anterior.`,
    botones: [{ texto: 'Cancelar' }, { texto: 'Borrar', clase: 'btn-peligro', accion: () => store.borrarIntento(i.id) }],
  });
  if (ok) {
    if (ing.ultimo?.intentoId === i.id) ing.ultimo = null;
    aviso('Tiempo borrado');
    renderCorregir(false);
  }
}

function renderParticipantes() {
  renderSegmentado($('#seg-part'), rankingPart, (r) => { rankingPart = r; renderParticipantes(); });
  $('#btn-add-piloto').hidden = rankingPart !== 'pilotos';
  const q = $('#q-part').value.trim();
  let lista = (snap?.participantes || []).filter(p => p.ranking === rankingPart);
  if (q) lista = lista.filter(p => coincideNombre(p.nombre, q) || coincideNumero(p.numero, q));
  if (rankingPart === 'pilotos') lista.sort((a, b) => primerNumero(a.numero) - primerNumero(b.numero));
  else lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const items = lista.map(p => {
    const li = el('li', 'fila-ed');
    const f1 = el('div', 'f1');
    f1.append(el('b', null, etiqueta(p)));
    const pd = posDe(snap, p.ranking, p.id);
    f1.append(el('span', 'tnum', pd ? formatTiempo(pd.fila.tiempo_ms) : '—'));
    const f2 = el('div', 'f2');
    f2.append(el('span', null, pd ? `P${pd.pos} · ${pd.fila.intentos} intento${pd.fila.intentos === 1 ? '' : 's'}` : 'Sin tiempo'));
    const acc = el('div', 'acc');
    acc.append(boton('Editar', 'btn-sec', () => editarParticipante(p)));
    if (p.ranking !== 'pilotos') acc.append(boton('Fusionar', 'btn-sec', () => fusionarParticipante(p)));
    acc.append(boton('Borrar', 'btn-peligro', () => borrarParticipante(p)));
    f2.append(acc);
    li.append(f1, f2);
    return li;
  });
  if (!items.length) items.push(el('li', 'lista-vacia', q ? 'Nadie coincide con la búsqueda.' : 'No hay participantes en este ranking.'));
  $('#l-part').replaceChildren(...items);
}

async function editarParticipante(p) {
  const nom = inputTexto(p.nombre, { autocapitalize: 'words', maxLength: 60 });
  const num = inputTexto(p.numero || '', { inputMode: 'text', maxLength: 20 });
  const cont = el('div');
  cont.append(campo('Nombre', nom));
  if (p.ranking === 'pilotos') cont.append(campo('Número de kart', num));
  const ok = await dialogo({
    titulo: 'Editar participante',
    contenido: cont,
    botones: [
      { texto: 'Cancelar' },
      {
        texto: 'Guardar', clase: 'btn-pri',
        habilitar: () => limpiarNombre(nom.value).length > 0,
        accion: () => {
          const campos = { nombre: limpiarNombre(nom.value) };
          if (p.ranking === 'pilotos') campos.numero = num.value.trim() || null;
          return store.editarParticipante(p.id, campos);
        },
      },
    ],
  });
  if (ok) aviso('Participante actualizado');
}

async function borrarParticipante(p) {
  const pd = filaDe(snap, p.id);
  const n = pd?.intentos || 0;
  const ok = await dialogo({
    titulo: 'Borrar participante',
    texto: `¿Borrar a ${etiqueta(p)}${n ? ` y sus ${n} intento${n === 1 ? '' : 's'}` : ''}? Desaparece del ranking.`,
    botones: [{ texto: 'Cancelar' }, { texto: 'Borrar', clase: 'btn-peligro', accion: () => store.borrarParticipante(p.id) }],
  });
  if (ok) aviso('Participante borrado');
}

async function agregarPiloto() {
  const num = inputTexto('', { inputMode: 'text', maxLength: 20, placeholder: 'Ej.: 525' });
  const nom = inputTexto('', { autocapitalize: 'words', maxLength: 60, placeholder: 'Nombre a mostrar' });
  const cont = el('div');
  cont.append(campo('Número de kart', num), campo('Nombre', nom));
  const ok = await dialogo({
    titulo: 'Agregar piloto',
    contenido: cont,
    botones: [
      { texto: 'Cancelar' },
      {
        texto: 'Agregar', clase: 'btn-pri',
        habilitar: () => limpiarNombre(nom.value).length > 0,
        accion: () => store.crearParticipante({ ranking: 'pilotos', nombre: limpiarNombre(nom.value), numero: num.value.trim() || null }),
      },
    ],
  });
  if (ok) aviso('Piloto agregado');
}

async function fusionarParticipante(a) {
  const otros = snap.participantes
    .filter(p => p.ranking === a.ranking && p.id !== a.id)
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
  if (!otros.length) { aviso('No hay otro participante con quien fusionar.', true); return; }
  const b = await dialogo({
    titulo: 'Fusionar',
    texto: `¿Con quién está duplicado «${a.nombre}»? Los intentos de ambos quedarán en una sola persona.`,
    contenido: (cerrar) => {
      const wrap = el('div');
      const q = inputTexto('', { type: 'search', placeholder: 'Buscar', autocomplete: 'off' });
      const ops = el('div', 'opciones');
      const pintar = () => ops.replaceChildren(...otros.filter(p => coincideNombre(p.nombre, q.value)).map(p => {
        const op = boton(null, 'opcion', () => cerrar(p));
        op.append(el('b', null, p.nombre), el('small', null, infoMarca(p.id)));
        return op;
      }));
      q.addEventListener('input', pintar);
      pintar();
      wrap.append(q, ops);
      return wrap;
    },
    botones: [{ texto: 'Cancelar' }],
  });
  if (!b) return;
  const conservar = await dialogo({
    titulo: '¿Qué nombre queda?',
    texto: 'Se conservan todos los intentos. El otro registro se elimina.',
    contenido: (cerrar) => {
      const ops = el('div', 'opciones');
      for (const p of [a, b]) {
        const op = boton(null, 'opcion', () => cerrar(p));
        op.append(el('b', null, `Conservar «${p.nombre}»`), el('small', null, infoMarca(p.id)));
        ops.append(op);
      }
      return ops;
    },
    botones: [{ texto: 'Cancelar' }],
  });
  if (!conservar) return;
  const eliminar = conservar.id === a.id ? b : a;
  try {
    await store.fusionar(conservar.id, eliminar.id);
    aviso(`Fusionados en «${conservar.nombre}»`);
  } catch (e) {
    aviso(traducirError(e), true);
  }
}

// ---------------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------------
const CAMPOS_EV = { titulo: '#ev-titulo', pista: '#ev-pista', auto: '#ev-auto', rental_nombre: '#ev-rental' };

function renderConfig() {
  if (!snap) return;
  const ev = snap.evento;
  if (!eventoSucio) for (const [k, s] of Object.entries(CAMPOS_EV)) $(s).value = ev[k] || '';
  $('#sw-prep').checked = !!ev.preparadores_activo;
  $('#export').replaceChildren(...rankingsActivos(ev).map(r =>
    boton(`Descargar CSV ${NOMBRE_RANKING[r]} (${filas(snap, r).length})`, 'btn-sec', () => exportarCSV(r))));
}

$('#f-evento').addEventListener('input', () => { eventoSucio = true; });
$('#f-evento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-ev');
  $('#ev-err').textContent = '';
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const campos = {};
    for (const [k, s] of Object.entries(CAMPOS_EV)) campos[k] = $(s).value.trim();
    await store.guardarEvento(campos);
    eventoSucio = false;
    aviso('Evento actualizado');
  } catch (err) {
    $('#ev-err').textContent = traducirError(err) + ' Los cambios siguen en el formulario.';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
});

$('#sw-prep').addEventListener('change', async (e) => {
  const v = e.target.checked;
  e.target.disabled = true;
  try {
    await store.guardarEvento({ preparadores_activo: v });
    aviso(v ? 'Preparadores activado' : 'Preparadores desactivado');
  } catch (err) {
    e.target.checked = !v;
    aviso(traducirError(err), true);
  } finally {
    e.target.disabled = false;
  }
});

function exportarCSV(r) {
  const cel = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [['Posición', 'Número', 'Nombre', 'Mejor tiempo', 'Tiempo (ms)', 'Intentos', 'Marcado a las']];
  filas(snap, r).forEach((f, i) => lineas.push([i + 1, f.numero || '', f.nombre, formatTiempo(f.tiempo_ms), f.tiempo_ms, f.intentos ?? '', hora(f.marcado_en)]));
  // Separador ";" y BOM para que Excel en español lo abra bien.
  const csv = '﻿' + lineas.map(l => l.map(cel).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = `ranking-${r}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function confirmarBorrar(titulo, texto, accion) {
  const input = inputTexto('', { placeholder: 'BORRAR', autocomplete: 'off', autocapitalize: 'characters' });
  const cont = el('div');
  cont.append(campo('Escribe BORRAR para confirmar', input));
  return dialogo({
    titulo, texto, contenido: cont,
    botones: [
      { texto: 'Cancelar' },
      { texto: 'Borrar', clase: 'btn-peligro', habilitar: () => input.value.trim() === 'BORRAR', accion },
    ],
  });
}

$('#btn-reset-tiempos').addEventListener('click', async () => {
  const ok = await confirmarBorrar('Borrar todos los tiempos',
    'Se borran todos los intentos de todos los rankings. Los participantes se mantienen.',
    () => store.reiniciarTiempos());
  if (ok) { ing.ultimo = null; aviso('Tiempos borrados'); }
});
$('#btn-reset-open').addEventListener('click', async () => {
  const ok = await confirmarBorrar('Borrar Open y Preparadores',
    'Se borran los participantes de Open y Preparadores con sus tiempos. Los pilotos y sus tiempos se mantienen.',
    () => store.reiniciarOpen());
  if (ok) { ing.ultimo = null; aviso('Open y Preparadores borrados'); }
});

arrancar();
