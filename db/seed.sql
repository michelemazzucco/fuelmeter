-- Historical readings
-- level_liters recalculated from level_cm using the tank calibration table.
-- Refill entries (pieno) have no cm measurement — liters kept from original records.

insert into readings (recorded_at, level_cm, level_liters, is_refill, notes) values
  ('2021-12-01', null,   1500, 1, 'pieno'),
  ('2022-03-13', 60.5,    908, 0, null),   -- 60→896, 61→919, interp 60.5→907.5
  ('2022-07-11', 49.5,    656, 0, null),   -- 49→645, 50→666, interp 49.5→655.5
  ('2022-08-02', null,   1500, 1, 'pieno'),
  ('2023-03-04', 62.0,    944, 0, null),
  ('2023-08-10', 47.5,    610, 0, null),   -- 47→599, 48→620, interp 47.5→609.5
  ('2023-10-18', 45.5,    570, 0, null),   -- 45→560, 46→580, interp 45.5→570
  ('2023-11-09', null,   1500, 1, 'pieno'),
  ('2024-05-18', 55.0,    783, 0, null),
  ('2024-08-26', 49.5,    656, 0, null),
  ('2024-08-30', null,   1500, 1, 'pieno'),
  ('2025-03-29', 57.0,    830, 0, null),
  ('2025-07-19', 47.0,    599, 0, null),
  ('2025-09-01', 44.5,    551, 0, null),   -- 44→542, 45→560, interp 44.5→551
  ('2025-09-15', null,   1540, 1, 'pieno +990lt'),
  ('2026-01-15', 71.5,   1122, 0, null),  -- 71→1111, 72→1132, interp 71.5→1121.5
  ('2026-03-29', 55.0,    783, 0, null);
