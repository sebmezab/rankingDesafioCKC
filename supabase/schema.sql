-- =====================================================================
-- Leaderboard Desafío Simracing CKC — esquema completo
-- Pegar entero en Supabase > SQL Editor > Run. Es idempotente en lo
-- posible (se puede volver a ejecutar sin romper datos existentes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.evento (
  id                  int primary key default 1 check (id = 1),  -- fila única
  titulo              text not null default 'Desafío Simracing CKC',
  pista               text not null default 'Pista por definir',
  auto                text not null default 'Auto por definir',
  rental_nombre       text not null default '[Empresa Rental]',
  preparadores_activo boolean not null default false
);
insert into public.evento (id) values (1) on conflict (id) do nothing;

create table if not exists public.participantes (
  id         bigint generated always as identity primary key,
  ranking    text not null check (ranking in ('pilotos', 'open', 'preparadores')),
  numero     text,                     -- solo pilotos; texto porque existe "21 / 51"
  nombre     text not null check (length(btrim(nombre)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists participantes_ranking_nombre_uq
  on public.participantes (ranking, lower(nombre));

create table if not exists public.intentos (
  id              bigint generated always as identity primary key,
  participante_id bigint not null references public.participantes (id) on delete cascade,
  tiempo_ms       integer not null check (tiempo_ms > 0),
  created_at      timestamptz not null default now()
);
create index if not exists intentos_participante_idx
  on public.intentos (participante_id, tiempo_ms, created_at);

create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ---------------------------------------------------------------------
-- ¿El usuario actual es staff?
-- SECURITY DEFINER: la tabla staff no tiene políticas, así que una
-- subconsulta normal desde una política no vería ninguna fila.
-- ---------------------------------------------------------------------
create or replace function public.es_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;
revoke all on function public.es_staff() from public;
grant execute on function public.es_staff() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vista leaderboard: una fila por participante con al menos un intento,
-- con su mejor tiempo y cuándo lo marcó. Empate: gana quien lo marcó antes.
-- ---------------------------------------------------------------------
create or replace view public.leaderboard
with (security_invoker = true) as
select participante_id, ranking, numero, nombre, tiempo_ms, marcado_en, intentos
from (
  select
    p.id          as participante_id,
    p.ranking,
    p.numero,
    p.nombre,
    i.tiempo_ms,
    i.created_at  as marcado_en,
    count(*) over (partition by p.id) as intentos,
    row_number() over (partition by p.id order by i.tiempo_ms asc, i.created_at asc, i.id asc) as rn
  from public.participantes p
  join public.intentos i on i.participante_id = p.id
) t
where rn = 1
order by ranking, tiempo_ms asc, marcado_en asc;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.evento        enable row level security;
alter table public.participantes enable row level security;
alter table public.intentos      enable row level security;
alter table public.staff         enable row level security;  -- sin políticas: nadie la lee vía API

do $$
declare t text;
begin
  foreach t in array array['evento', 'participantes', 'intentos'] loop
    execute format('drop policy if exists "lectura publica" on public.%I', t);
    execute format('drop policy if exists "staff inserta" on public.%I', t);
    execute format('drop policy if exists "staff actualiza" on public.%I', t);
    execute format('drop policy if exists "staff borra" on public.%I', t);

    execute format('create policy "lectura publica" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "staff inserta" on public.%I for insert to authenticated with check (public.es_staff())', t);
    execute format('create policy "staff actualiza" on public.%I for update to authenticated using (public.es_staff()) with check (public.es_staff())', t);
    execute format('create policy "staff borra" on public.%I for delete to authenticated using (public.es_staff())', t);
  end loop;
end $$;

grant select on public.evento, public.participantes, public.intentos, public.leaderboard to anon, authenticated;
grant insert, update, delete on public.evento, public.participantes, public.intentos to authenticated;
revoke all on public.staff from anon, authenticated;

-- ---------------------------------------------------------------------
-- Operaciones atómicas (SECURITY INVOKER: las políticas RLS siguen
-- aplicando, así que solo el staff logra modificar algo).
-- ---------------------------------------------------------------------
create or replace function public.fusionar_participantes(conservar bigint, eliminar bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare r1 text; r2 text;
begin
  if not public.es_staff() then raise exception 'No autorizado'; end if;
  if conservar = eliminar then raise exception 'Elige dos participantes distintos'; end if;
  select ranking into r1 from participantes where id = conservar;
  select ranking into r2 from participantes where id = eliminar;
  if r1 is null or r2 is null then raise exception 'Participante no encontrado'; end if;
  if r1 <> r2 then raise exception 'Ambos deben ser del mismo ranking'; end if;
  if r1 = 'pilotos' then raise exception 'No se fusionan pilotos'; end if;
  update intentos set participante_id = conservar where participante_id = eliminar;
  delete from participantes where id = eliminar;
end $$;

create or replace function public.reiniciar_tiempos()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.es_staff() then raise exception 'No autorizado'; end if;
  delete from intentos where true;
end $$;

create or replace function public.reiniciar_open_preparadores()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.es_staff() then raise exception 'No autorizado'; end if;
  delete from participantes where ranking in ('open', 'preparadores');  -- intentos caen en cascada
end $$;

revoke all on function public.fusionar_participantes(bigint, bigint) from public, anon;
revoke all on function public.reiniciar_tiempos() from public, anon;
revoke all on function public.reiniciar_open_preparadores() from public, anon;
grant execute on function public.fusionar_participantes(bigint, bigint) to authenticated;
grant execute on function public.reiniciar_tiempos() to authenticated;
grant execute on function public.reiniciar_open_preparadores() to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter table public.participantes replica identity full;
alter table public.intentos      replica identity full;

do $$
declare t text;
begin
  foreach t in array array['evento', 'participantes', 'intentos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
