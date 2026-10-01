-- OTTO SOLAR • STORAGE SUPABASE
-- Execute no SQL Editor do projeto Supabase antes de ativar a gravação na Vercel.

create extension if not exists pgcrypto;

create table if not exists public.solar_usinas_producao (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  captured_at timestamptz not null,
  provider_checked_at timestamptz,
  provider text not null default '',
  provider_name text not null default '',
  slot integer,
  label text not null default '',
  company text not null default '',
  source text not null default '',
  station_id text not null,
  station_name text not null default '',
  status text not null default 'unknown',
  capacity_kw numeric,
  power_kw numeric,
  today_kwh numeric,
  month_kwh numeric,
  year_kwh numeric,
  total_kwh numeric,
  revenue_today_brl numeric,
  revenue_month_brl numeric,
  revenue_year_brl numeric,
  revenue_total_brl numeric,
  total_devices integer,
  online_devices integer,
  offline_devices integer,
  alarm_devices integer,
  updated_at timestamptz,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_solar_producao_captured_at
  on public.solar_usinas_producao (captured_at desc);
create index if not exists idx_solar_producao_station
  on public.solar_usinas_producao (provider, slot, station_id, captured_at desc);
create index if not exists idx_solar_producao_company
  on public.solar_usinas_producao (company, captured_at desc);

create table if not exists public.solar_usinas_atual (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  captured_at timestamptz not null,
  provider_checked_at timestamptz,
  provider text not null default '',
  provider_name text not null default '',
  slot integer,
  label text not null default '',
  company text not null default '',
  source text not null default '',
  station_id text not null,
  station_name text not null default '',
  status text not null default 'unknown',
  capacity_kw numeric,
  power_kw numeric,
  today_kwh numeric,
  month_kwh numeric,
  year_kwh numeric,
  total_kwh numeric,
  revenue_today_brl numeric,
  revenue_month_brl numeric,
  revenue_year_brl numeric,
  revenue_total_brl numeric,
  total_devices integer,
  online_devices integer,
  offline_devices integer,
  alarm_devices integer,
  updated_at timestamptz,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint solar_usinas_atual_provider_slot_station_key unique nulls not distinct (provider, slot, station_id)
);

create index if not exists idx_solar_atual_company
  on public.solar_usinas_atual (company);
create index if not exists idx_solar_atual_status
  on public.solar_usinas_atual (status);

create table if not exists public.solar_sync_log (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  captured_at timestamptz not null,
  saved_at timestamptz not null default now(),
  rows_received integer not null default 0,
  rows_saved_history integer not null default 0,
  rows_updated_current integer not null default 0,
  integrations_total integer not null default 0,
  integrations_ok integer not null default 0,
  integrations_failed integer not null default 0,
  plants_total integer not null default 0,
  plants_online integer not null default 0,
  plants_offline integer not null default 0,
  plants_alarm integer not null default 0,
  alerts_attempted integer not null default 0,
  alerts_sent integer not null default 0,
  alerts_failed integer not null default 0,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_solar_sync_log_captured_at
  on public.solar_sync_log (captured_at desc);

alter table public.solar_usinas_producao enable row level security;
alter table public.solar_usinas_atual enable row level security;
alter table public.solar_sync_log enable row level security;

-- Não são criadas policies públicas. A gravação é feita apenas no backend
-- usando SUPABASE_SERVICE_ROLE_KEY, que não deve ser exposta no navegador.
