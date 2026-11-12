import type { Reading, TankConfig } from "./types"

export type Row = Record<string, unknown>

export function mapReading(row: Row): Reading {
  return {
    id: row.id as string,
    recorded_at: row.recorded_at as string,
    level_cm: row.level_cm as number | null,
    level_liters: row.level_liters as number | null,
    is_refill: !!row.is_refill,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
  }
}

export function mapConfig(row: Row): TankConfig {
  return {
    id: row.id as string,
    capacity_liters: row.capacity_liters as number,
    low_threshold_liters: row.low_threshold_liters as number,
    updated_at: row.updated_at as string,
  }
}
