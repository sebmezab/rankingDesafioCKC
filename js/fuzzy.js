// Comparación de nombres para evitar duplicados en Open / Preparadores.

/** Minúsculas, sin tildes, sin puntuación, espacios simples. */
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOrdenados(s) {
  return normalizar(s).split(' ').filter(Boolean).sort().join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * ¿Se parecen lo suficiente como para preguntar si es la misma persona?
 * Devuelve un motivo legible o null.
 */
export function motivoParecido(a, b) {
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return null;
  if (na === nb) return 'mismo nombre';
  const ta = tokensOrdenados(a), tb = tokensOrdenados(b);
  if (ta === tb) return 'mismas palabras en otro orden';
  if (levenshtein(na, nb) <= 2 || levenshtein(ta, tb) <= 2) return 'nombre muy parecido';
  return null;
}

/** Lista de { p, motivo } de los existentes parecidos a `nombre`. */
export function buscarParecidos(nombre, existentes) {
  const out = [];
  for (const p of existentes) {
    const motivo = motivoParecido(nombre, p.nombre);
    if (motivo) out.push({ p, motivo });
  }
  return out;
}

/** Coincidencia de búsqueda por texto (sin tildes/mayúsculas). */
export function coincideNombre(nombre, query) {
  const q = normalizar(query);
  if (!q) return true;
  const n = normalizar(nombre);
  return q.split(' ').every(w => n.includes(w));
}

/** Busca por número de kart: "21 / 51" se encuentra con 21 y con 51. */
export function coincideNumero(numero, query) {
  const q = String(query ?? '').trim();
  if (!q || !numero) return false;
  return String(numero).split(/[^0-9]+/).filter(Boolean).some(n => n === q || n.startsWith(q));
}
