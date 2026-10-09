// Datos falsos para ?demo=1. Los pilotos son la lista real (ya pública en
// seed_pilotos.sql); Open y Preparadores son nombres inventados.

const PILOTOS = `7;Renata Melo
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
745;Martina Olivera`.split('\n').map(l => l.split(';'));

const OPEN = ['Camila Rojas', 'Tomás Fuentes', 'Valentina Soto', 'Diego Muñoz', 'Fernanda Castro',
  'Javier Pino', 'Constanza Vera', 'Matías Contreras', 'Isidora Reyes', 'Felipe Araya',
  'Josefa Tapia', 'Nicolás Bravo', 'Antonella Ríos', 'Bastián Lagos', 'Florencia Paz',
  'Cristóbal Núñez', 'Catalina Sáez', 'Benjamín Ortiz', 'Martina Gallardo', 'Lucas Herrera'];
const PREP = ['Raúl Henríquez', 'Patricio Vidal', 'Luis Carrasco', 'Andrés Molina', 'Hugo Salinas', 'Jorge Riquelme'];

const BASE_MS = 68000;  // vuelta de referencia ~1:08

// RNG con semilla para que las capturas sean reproducibles.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let azar = rng(20261010);

export function crearDbDemo() {
  azar = rng(20261010);
  const db = {
    evento: {
      id: 1, titulo: 'Desafío Simracing CKC', pista: 'Autódromo de demostración',
      auto: 'Fórmula demo', rental_nombre: '[Empresa Rental]', preparadores_activo: false,
    },
    participantes: [],
    intentos: [],
  };
  let pid = 1, iid = 1;
  const t0 = Date.now() - 3 * 3600_000;
  const agregar = (ranking, nombre, numero, nIntentos, base) => {
    const p = { id: pid++, ranking, numero, nombre, created_at: new Date(t0).toISOString() };
    db.participantes.push(p);
    for (let k = 0; k < nIntentos; k++) {
      db.intentos.push({
        id: iid++, participante_id: p.id,
        tiempo_ms: Math.round(base + azar() * 2500 - k * 300),
        created_at: new Date(t0 + iid * 90_000).toISOString(),
      });
    }
  };
  PILOTOS.forEach(([numero, nombre]) => agregar('pilotos', nombre, numero, 1 + Math.floor(azar() * 3), BASE_MS + azar() * 4000));
  OPEN.slice(0, 14).forEach(n => agregar('open', n, null, 1 + Math.floor(azar() * 2), BASE_MS + 2500 + azar() * 7000));
  PREP.slice(0, 4).forEach(n => agregar('preparadores', n, null, 1, BASE_MS + 1000 + azar() * 5000));
  // ordenar intentos por fecha para que el "último" sea coherente
  db.intentos.sort((a, b) => a.id - b.id);
  return db;
}

/** Agrega un intento simulado: mejora, no mejora, o alguien nuevo en Open. */
export function simularIntento(db) {
  const r = Math.random();
  const sigP = db.participantes.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const sigI = db.intentos.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const ahora = new Date().toISOString();

  if (r < 0.2) {
    const usados = new Set(db.participantes.filter(p => p.ranking === 'open').map(p => p.nombre));
    const libre = OPEN.find(n => !usados.has(n)) || `Visitante ${sigP}`;
    db.participantes.push({ id: sigP, ranking: 'open', numero: null, nombre: libre, created_at: ahora });
    db.intentos.push({ id: sigI, participante_id: sigP, tiempo_ms: Math.round(BASE_MS + 2000 + Math.random() * 8000), created_at: ahora });
    return;
  }
  const pool = db.participantes.filter(p => p.ranking !== 'preparadores' || db.evento.preparadores_activo);
  const p = pool[Math.floor(Math.random() * pool.length)];
  if (!p) return;
  const suyos = db.intentos.filter(i => i.participante_id === p.id).map(i => i.tiempo_ms);
  const mejor = suyos.length ? Math.min(...suyos) : BASE_MS + 3000;
  const delta = r < 0.6 ? -(200 + Math.random() * 2500) : 100 + Math.random() * 1500;
  db.intentos.push({ id: sigI, participante_id: p.id, tiempo_ms: Math.max(55000, Math.round(mejor + delta)), created_at: ahora });
}
