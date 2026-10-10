// Formato y parseo de tiempos de vuelta.

/** 83456 -> "1:23.456" */
export function formatTiempo(ms) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const total = Math.round(ms);
  const min = Math.floor(total / 60000);
  const seg = Math.floor((total % 60000) / 1000);
  const mil = total % 1000;
  return `${min}:${String(seg).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

/** Diferencia con el líder: "+0.512", "+1:02.003". */
export function formatGap(ms) {
  if (ms == null || ms <= 0) return '';
  if (ms < 60000) {
    const s = Math.floor(ms / 1000);
    return `+${s}.${String(ms % 1000).padStart(3, '0')}`;
  }
  return '+' + formatTiempo(ms);
}

/**
 * Máscara de ingreso: pone ":" y "." a medida que se escriben dígitos.
 * "1" -> "1:", "123" -> "1:23.", "123456" -> "1:23.456" (minutos de 1 dígito;
 * bajo el minuto se empieza con 0). Con `cerrar` falso no deja un separador
 * al final, para que borrar con retroceso no quede trabado.
 */
export function enmascararTiempo(texto, cerrar = true) {
  const d = String(texto ?? '').replace(/\D/g, '').slice(0, 6);
  if (!d) return '';
  if (d.length === 1) return d + (cerrar ? ':' : '');
  if (d.length <= 3) return `${d[0]}:${d.slice(1)}` + (d.length === 3 && cerrar ? '.' : '');
  return `${d[0]}:${d.slice(1, 3)}.${d.slice(3)}`;
}

/**
 * Interpreta lo que escribe el staff. Acepta:
 *   "1:23.456"  -> 1 min 23.456 s
 *   "83.456"    -> 83.456 s
 *   "123456"    -> solo dígitos: últimos 3 = ms, 2 anteriores = s, resto = min
 * Coma o punto como separador decimal. Devuelve { ok, ms } o { ok:false, error }.
 */
export function parseTiempo(texto) {
  const t = String(texto ?? '').trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!t) return { ok: false, error: 'Ingresa un tiempo.' };

  let min = 0, seg = 0, mil = 0;

  if (/^\d+$/.test(t)) {
    if (t.length < 4) return { ok: false, error: 'Faltan dígitos. Ej.: 123456 = 1:23.456' };
    mil = parseInt(t.slice(-3), 10);
    seg = parseInt(t.slice(-5, -3) || '0', 10);
    min = parseInt(t.slice(0, -5) || '0', 10);
    if (seg >= 60) return { ok: false, error: 'Los segundos deben ser menores a 60.' };
  } else {
    let m = t.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (m) {
      min = parseInt(m[1], 10);
      seg = parseInt(m[2], 10);
      mil = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      if (seg >= 60) return { ok: false, error: 'Los segundos deben ser menores a 60.' };
    } else {
      m = t.match(/^(\d+)(?:\.(\d{1,3}))?$/);
      if (!m) return { ok: false, error: 'Formato no reconocido. Usa 1:23.456, 83.456 o 123456.' };
      seg = parseInt(m[1], 10);
      mil = m[2] ? parseInt(m[2].padEnd(3, '0'), 10) : 0;
    }
  }

  const ms = min * 60000 + seg * 1000 + mil;
  if (ms <= 0) return { ok: false, error: 'El tiempo debe ser mayor a cero.' };
  if (ms >= 60 * 60000) return { ok: false, error: 'Tiempo demasiado largo.' };
  return { ok: true, ms };
}
