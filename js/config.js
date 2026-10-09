// Configuración del sitio. Completar con los datos del proyecto Supabase
// (Project Settings > API). La "anon key" es pública por diseño: la
// seguridad la dan las políticas RLS de supabase/schema.sql.
export const CONFIG = {
  SUPABASE_URL: 'https://ekyfksufvzsupkxoyvmo.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVreWZrc3VmdnpzdXBreG95dm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NTExOTQsImV4cCI6MjEwNzEyNzE5NH0.9hCb2XjxElbJ7IeL6N0a4KCRi7r8FfDWF8a2P0LKMuA',

  // Correo del usuario staff. En admin.html solo se pide la contraseña.
  STAFF_EMAIL: 'staff@ckc.cl',

  // URL pública para el código QR del modo pantalla. Si se deja vacía se usa
  // la URL actual (sin ?tv=1).
  PUBLIC_URL: 'https://sebmezab.github.io/rankingDesafioCKC/',

  // Total de pilotos inscritos para el contador "12 de 36 pilotos".
  // null = se calcula con la cantidad de pilotos cargados en la base.
  TOTAL_PILOTOS: null,

  // Modo pantalla
  TV_ROTACION_MS: 8000,   // cada cuánto rota la página
  TV_TOP_FIJO: 5,          // filas que quedan fijas arriba

  // Respaldo del tiempo real
  SONDEO_MS: 15000,
};
