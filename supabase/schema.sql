-- FuelMeter schema
-- Run this in your Supabase project's SQL editor

-- Tank configuration (single row)
create table if not exists tank_config (
  id                   uuid primary key default gen_random_uuid(),
  capacity_liters      numeric not null default 1000,
  low_threshold_liters numeric not null default 150,
  updated_at           timestamptz default now()
);

-- Insert a default config row if none exists
insert into tank_config (capacity_liters, low_threshold_liters)
select 1000, 150
where not exists (select 1 from tank_config);

-- Fuel readings
create table if not exists readings (
  id           uuid primary key default gen_random_uuid(),
  recorded_at  timestamptz not null default now(),
  level_liters numeric not null,
  notes        text,
  created_at   timestamptz default now()
);

-- Index for time-ordered queries
create index if not exists readings_recorded_at_idx on readings (recorded_at desc);
