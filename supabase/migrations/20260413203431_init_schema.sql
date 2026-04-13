-- Tank configuration (single row)
create table if not exists tank_config (
  id                   uuid primary key default gen_random_uuid(),
  capacity_liters      numeric not null default 1564,
  low_threshold_liters numeric not null default 150,
  updated_at           timestamptz default now()
);

insert into tank_config (capacity_liters, low_threshold_liters)
select 1564, 150
where not exists (select 1 from tank_config);

-- Fuel readings
create table if not exists readings (
  id           uuid primary key default gen_random_uuid(),
  recorded_at  timestamptz not null default now(),
  level_cm     numeric,                -- primary measurement (dip-stick / gauge in cm)
  level_liters numeric,                -- calculated from level_cm via tank schema (nullable until schema is known)
  is_refill    boolean not null default false,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists readings_recorded_at_idx on readings (recorded_at desc);
