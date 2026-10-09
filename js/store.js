// Capa de datos. Dos implementaciones con la misma API:
//   - Supabase (producción)
//   - Demo en memoria (?demo=1), sin red.
import { CONFIG } from './config.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const RANKINGS = ['pilotos', 'open', 'preparadores'];
export const NOMBRE_RANKING = { pilotos: 'Pilotos', open: 'Open', preparadores: 'Preparadores' };

export const params = new URLSearchParams(location.search);
export const esDemo = params.get('demo') === '1';

/** Rankings visibles según la configuración del evento. */
export function rankingsActivos(evento) {
  return evento?.preparadores_activo ? RANKINGS : RANKINGS.slice(0, 2);
}

/** Orden oficial: tiempo ascendente; en empate, quien lo marcó primero. */
export function ordenar(filas) {
  return filas.slice().sort((a, b) =>
    a.tiempo_ms - b.tiempo_ms ||
    new Date(a.marcado_en) - new Date(b.marcado_en) ||
    a.participante_id - b.participante_id);
}

/** Mismo cálculo que la vista SQL `leaderboard` (usado en demo). */
export function calcularLeaderboard(participantes, intentos) {
  const mejor = new Map();
  const cuenta = new Map();
  for (const i of intentos) {
    cuenta.set(i.participante_id, (cuenta.get(i.participante_id) || 0) + 1);
    const m = mejor.get(i.participante_id);
    if (!m || i.tiempo_ms < m.tiempo_ms ||
        (i.tiempo_ms === m.tiempo_ms && new Date(i.created_at) < new Date(m.created_at))) {
      mejor.set(i.participante_id, i);
    }
  }
  const filas = [];
  for (const p of participantes) {
    const m = mejor.get(p.id);
    if (!m) continue;
    filas.push({
      participante_id: p.id, ranking: p.ranking, numero: p.numero, nombre: p.nombre,
      tiempo_ms: m.tiempo_ms, marcado_en: m.created_at, intentos: cuenta.get(p.id),
    });
  }
  return ordenar(filas);
}

/** Mensaje de error legible para el staff. */
export function traducirError(e) {
  const msg = String(e?.message || e || '');
  if (e?.code === '23505' || /duplicate key/i.test(msg)) return 'Ya existe alguien con ese nombre en este ranking.';
  if (e?.code === '42501' || /row-level security|permission denied|No autorizado/i.test(msg)) return 'Sin permiso: la sesión no corresponde a staff.';
  if (/Invalid login credentials/i.test(msg)) return 'Contraseña incorrecta.';
  if (/Failed to fetch|NetworkError|AbortError|aborted|timeout|Load failed/i.test(msg)) return 'Sin conexión con el servidor. Revisa internet y reintenta.';
  return msg || 'Error desconocido.';
}

export async function crearStore(opciones = {}) {
  return esDemo ? crearStoreDemo(opciones) : crearStoreSupabase();
}

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------
function fetchConTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function crearStoreSupabase() {
  const { createClient } = await import(SUPABASE_CDN);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ckc-staff-auth' },
    global: { fetch: fetchConTimeout },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  const ok = ({ data, error }) => { if (error) throw error; return data; };
  // update/delete bloqueados por RLS no dan error: devuelven 0 filas.
  const alMenosUna = (data) => {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error('No autorizado o registro inexistente');
    }
    return Array.isArray(data) ? data[0] : data;
  };

  return {
    modo: 'supabase',

    async cargar() {
      const [evento, participantes, leaderboard, ultimos] = await Promise.all([
        sb.from('evento').select('*').eq('id', 1).single().then(ok),
        sb.from('participantes').select('id, ranking, numero, nombre, created_at').order('id').then(ok),
        sb.from('leaderboard').select('*').then(ok),
        sb.from('intentos').select('id, participante_id, tiempo_ms, created_at')
          .order('created_at', { ascending: false }).limit(10).then(ok),
      ]);
      return { evento, participantes, leaderboard: ordenar(leaderboard), ultimos };
    },

    suscribir(onCambio, onEstado) {
      let canal = null, cerrado = false, reintento = null;
      const conectar = () => {
        if (cerrado) return;
        const ch = sb.channel('ckc-leaderboard-' + Date.now());
        canal = ch;
        for (const table of ['evento', 'participantes', 'intentos']) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => onCambio());
        }
        ch.subscribe((status) => {
          if (ch !== canal) return;  // canal antiguo ya descartado
          onEstado?.(status === 'SUBSCRIBED');
          if (status === 'SUBSCRIBED') onCambio();  // ponerse al día tras reconectar
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            canal = null;
            sb.removeChannel(ch);
            clearTimeout(reintento);
            reintento = setTimeout(conectar, 5000);
          }
        });
      };
      conectar();
      return () => { cerrado = true; clearTimeout(reintento); if (canal) sb.removeChannel(canal); };
    },

    async sesion() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
    },
    async login(password) {
      ok(await sb.auth.signInWithPassword({ email: CONFIG.STAFF_EMAIL, password }));
      const esStaff = ok(await sb.rpc('es_staff'));
      if (!esStaff) {
        await sb.auth.signOut();
        throw new Error('Este usuario no está en la tabla staff.');
      }
    },
    async logout() { await sb.auth.signOut(); },

    async intentosRecientes(limite = 60) {
      return ok(await sb.from('intentos').select('id, participante_id, tiempo_ms, created_at')
        .order('created_at', { ascending: false }).limit(limite));
    },
    async agregarIntento(participante_id, tiempo_ms) {
      return ok(await sb.from('intentos').insert({ participante_id, tiempo_ms }).select().single());
    },
    async editarIntento(id, tiempo_ms) {
      return alMenosUna(ok(await sb.from('intentos').update({ tiempo_ms }).eq('id', id).select()));
    },
    async borrarIntento(id) {
      return alMenosUna(ok(await sb.from('intentos').delete().eq('id', id).select()));
    },
    async crearParticipante({ ranking, nombre, numero = null }) {
      return ok(await sb.from('participantes').insert({ ranking, nombre, numero }).select().single());
    },
    async editarParticipante(id, campos) {
      return alMenosUna(ok(await sb.from('participantes').update(campos).eq('id', id).select()));
    },
    async borrarParticipante(id) {
      return alMenosUna(ok(await sb.from('participantes').delete().eq('id', id).select()));
    },
    async fusionar(conservar, eliminar) {
      ok(await sb.rpc('fusionar_participantes', { conservar, eliminar }));
    },
    async guardarEvento(campos) {
      return alMenosUna(ok(await sb.from('evento').update(campos).eq('id', 1).select()));
    },
    async reiniciarTiempos() { ok(await sb.rpc('reiniciar_tiempos')); },
    async reiniciarOpen() { ok(await sb.rpc('reiniciar_open_preparadores')); },
  };
}

// ---------------------------------------------------------------------
// Demo (en memoria, persistido en localStorage para compartir entre
// pestañas: admin.html?demo=1 y index.html?demo=1 ven los mismos datos).
// ---------------------------------------------------------------------
async function crearStoreDemo({ simular = false } = {}) {
  const { crearDbDemo, simularIntento } = await import('./demo.js');
  const KEY = 'ckc-demo-db-v1';
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin storage */ }
  if (!db || params.get('reset') === '1') db = crearDbDemo();
  if (params.has('prep')) db.evento.preparadores_activo = params.get('prep') === '1';

  const oyentes = new Set();
  const guardar = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignora */ }
    oyentes.forEach(f => f());
  };
  guardar();
  addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try { db = JSON.parse(e.newValue); oyentes.forEach(f => f()); } catch { /* ignora */ }
  });

  const sigId = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const ahora = () => new Date().toISOString();
  const espera = () => new Promise(r => setTimeout(r, 120));
  const buscar = (lista, id) => {
    const x = lista.find(e => e.id === id);
    if (!x) throw new Error('Registro inexistente');
    return x;
  };
  const nombreLibre = (ranking, nombre, salvoId) => {
    if (db.participantes.some(p => p.ranking === ranking && p.id !== salvoId &&
        p.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
  };

  if (simular) {
    setInterval(() => { simularIntento(db); guardar(); }, 6000);
  }

  return {
    modo: 'demo',
    async cargar() {
      const c = structuredClone(db);
      const ultimos = c.intentos.slice().sort((a, b) => b.id - a.id).slice(0, 10);
      return {
        evento: c.evento, participantes: c.participantes,
        leaderboard: calcularLeaderboard(c.participantes, c.intentos), ultimos,
      };
    },
    suscribir(onCambio, onEstado) {
      oyentes.add(onCambio);
      setTimeout(() => onEstado?.(true), 0);
      return () => oyentes.delete(onCambio);
    },
    async sesion() { return { email: 'demo@demo' }; },
    async login() {},
    async logout() {},
    async intentosRecientes(limite = 60) {
      return structuredClone(db.intentos.slice().sort((a, b) => b.id - a.id).slice(0, limite));
    },
    async agregarIntento(participante_id, tiempo_ms) {
      await espera();
      if (params.get('fallar') === '1') throw new Error('Failed to fetch');
      buscar(db.participantes, participante_id);
      const i = { id: sigId(db.intentos), participante_id, tiempo_ms, created_at: ahora() };
      db.intentos.push(i); guardar(); return { ...i };
    },
    async editarIntento(id, tiempo_ms) {
      await espera(); buscar(db.intentos, id).tiempo_ms = tiempo_ms; guardar();
    },
    async borrarIntento(id) {
      await espera(); buscar(db.intentos, id);
      db.intentos = db.intentos.filter(i => i.id !== id); guardar();
    },
    async crearParticipante({ ranking, nombre, numero = null }) {
      await espera(); nombreLibre(ranking, nombre);
      const p = { id: sigId(db.participantes), ranking, numero, nombre, created_at: ahora() };
      db.participantes.push(p); guardar(); return { ...p };
    },
    async editarParticipante(id, campos) {
      await espera();
      const p = buscar(db.participantes, id);
      if (campos.nombre) nombreLibre(p.ranking, campos.nombre, id);
      Object.assign(p, campos); guardar();
    },
    async borrarParticipante(id) {
      await espera(); buscar(db.participantes, id);
      db.participantes = db.participantes.filter(p => p.id !== id);
      db.intentos = db.intentos.filter(i => i.participante_id !== id); guardar();
    },
    async fusionar(conservar, eliminar) {
      await espera();
      const a = buscar(db.participantes, conservar), b = buscar(db.participantes, eliminar);
      if (a.ranking !== b.ranking || a.ranking === 'pilotos' || a.id === b.id) throw new Error('Fusión no válida');
      db.intentos.forEach(i => { if (i.participante_id === eliminar) i.participante_id = conservar; });
      db.participantes = db.participantes.filter(p => p.id !== eliminar); guardar();
    },
    async guardarEvento(campos) { await espera(); Object.assign(db.evento, campos); guardar(); },
    async reiniciarTiempos() { await espera(); db.intentos = []; guardar(); },
    async reiniciarOpen() {
      await espera();
      const fuera = new Set(db.participantes.filter(p => p.ranking !== 'pilotos').map(p => p.id));
      db.participantes = db.participantes.filter(p => !fuera.has(p.id));
      db.intentos = db.intentos.filter(i => !fuera.has(i.participante_id)); guardar();
    },
  };
}

// ---------------------------------------------------------------------
// En vivo: Realtime + sondeo de respaldo + cache local. Nunca deja la
// pantalla vacía: si hay cache se pinta de inmediato; si falla la red se
// mantienen los últimos datos y se reintenta solo.
// ---------------------------------------------------------------------
export function iniciarEnVivo(store, { onDatos, onEstado }) {
  const CACHE = 'ckc-cache-' + store.modo;
  let canalOk = false, redOk = true, enCurso = false, pendiente = false, debounce = null, reintento = null;

  const estado = () => onEstado(!redOk ? 'offline' : canalOk ? 'live' : 'polling');

  try {
    const c = JSON.parse(localStorage.getItem(CACHE));
    if (c && c.evento) onDatos(c, { desdeCache: true });
  } catch { /* sin cache */ }

  async function refrescar() {
    if (enCurso) { pendiente = true; return; }
    enCurso = true;
    try {
      const snap = await store.cargar();
      redOk = true;
      try { localStorage.setItem(CACHE, JSON.stringify(snap)); } catch { /* lleno o bloqueado */ }
      onDatos(snap, { desdeCache: false });
    } catch (e) {
      console.warn('Error al cargar datos', e);
      redOk = false;
      clearTimeout(reintento);
      reintento = setTimeout(refrescar, 5000);
    } finally {
      enCurso = false;
      estado();
      if (pendiente) { pendiente = false; refrescar(); }
    }
  }
  const pronto = () => { clearTimeout(debounce); debounce = setTimeout(refrescar, 250); };

  store.suscribir(pronto, (ok) => { canalOk = ok; estado(); });
  setInterval(refrescar, CONFIG.SONDEO_MS);
  addEventListener('online', refrescar);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
  refrescar();
  return { refrescar };
}
