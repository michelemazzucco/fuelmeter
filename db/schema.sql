-- Tank configuration (single row)
create table if not exists tank_config (
  id                   text primary key default (lower(hex(randomblob(16)))),
  capacity_liters      real not null default 1564,
  low_threshold_liters real not null default 150,
  updated_at           text default current_timestamp
);

insert into tank_config (capacity_liters, low_threshold_liters)
select 1564, 150
where not exists (select 1 from tank_config);

-- Fuel readings
create table if not exists readings (
  id           text primary key default (lower(hex(randomblob(16)))),
  recorded_at  text not null default current_timestamp,
  level_cm     real,                   -- primary measurement (dip-stick / gauge in cm)
  level_liters real,                   -- calculated from level_cm via tank schema (nullable until schema is known)
  is_refill    integer not null default 0,
  notes        text,
  created_at   text default current_timestamp
);

create index if not exists readings_recorded_at_idx on readings (recorded_at desc);
