"use server"

import { cookies } from "next/headers"
import { db } from "./db"
import type { BoilerDay, BoilerHours, BoilerSyncStatus, Reading, TankConfig } from "./types"
import { aggregateBoilerDays } from "./heating"
import { fetchBoilerDays, getAuthRow, isNetatmoConfigured } from "./netatmo"
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  assertAuthenticated,
  createSessionToken,
  isAuthenticated,
  verifyCredentials,
} from "./auth"

type Row = Record<string, unknown>

function mapReading(row: Row): Reading {
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

function mapConfig(row: Row): TankConfig {
  return {
    id: row.id as string,
    capacity_liters: row.capacity_liters as number,
    low_threshold_liters: row.low_threshold_liters as number,
    updated_at: row.updated_at as string,
  }
}

export async function getReadings(order: "asc" | "desc" = "asc"): Promise<Reading[]> {
  const dir = order === "desc" ? "desc" : "asc"
  const result = await db.execute(
    `select * from readings order by recorded_at ${dir}`
  )
  return result.rows.map((r) => mapReading(r as Row))
}

export async function getTankConfig(): Promise<TankConfig | null> {
  const result = await db.execute("select * from tank_config limit 1")
  const row = result.rows[0]
  return row ? mapConfig(row as Row) : null
}

export async function login(
  username: string,
  password: string
): Promise<{ error?: string }> {
  if (!verifyCredentials(username, password)) {
    return { error: "Invalid username or password." }
  }
  const store = await cookies()
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
  return {}
}

export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function getAuthState(): Promise<boolean> {
  return isAuthenticated()
}

export async function addReading(input: {
  recorded_at: string
  level_cm: number | null
  level_liters: number | null
  is_refill: boolean
  notes: string | null
}): Promise<void> {
  await assertAuthenticated()
  await db.execute({
    sql: `insert into readings (recorded_at, level_cm, level_liters, is_refill, notes)
          values (?, ?, ?, ?, ?)`,
    args: [
      input.recorded_at,
      input.level_cm,
      input.level_liters,
      input.is_refill ? 1 : 0,
      input.notes,
    ],
  })
}

export async function deleteReading(id: string): Promise<void> {
  await assertAuthenticated()
  await db.execute({ sql: "delete from readings where id = ?", args: [id] })
}

export async function saveTankConfig(input: {
  id?: string
  capacity_liters: number
  low_threshold_liters: number
}): Promise<{ error?: string }> {
  try {
    await assertAuthenticated()
    if (input.id) {
      await db.execute({
        sql: `update tank_config
              set capacity_liters = ?, low_threshold_liters = ?, updated_at = ?
              where id = ?`,
        args: [
          input.capacity_liters,
          input.low_threshold_liters,
          new Date().toISOString(),
          input.id,
        ],
      })
    } else {
      await db.execute({
        sql: `insert into tank_config (capacity_liters, low_threshold_liters)
              values (?, ?)`,
        args: [input.capacity_liters, input.low_threshold_liters],
      })
    }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." }
  }
}

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
// A failed sync is not recorded in last_sync_at, so attempts get their own, shorter gate
const RETRY_INTERVAL_MS = 30 * 60 * 1000
// The last two days are still filling up on the Netatmo side, so refetch them
const REFETCH_DAYS = 2

/**
 * Never throws: a database without the boiler tables (not yet migrated) must
 * not keep the dashboard from loading.
 */
export async function getBoilerHours(): Promise<BoilerHours> {
  let days: BoilerDay[]
  try {
    const result = await db.execute(
      "select day, boiler_on_seconds from boiler_daily order by day asc"
    )
    days = result.rows.map((r) => ({
      day: r.day as string,
      hours: (r.boiler_on_seconds as number) / 3600,
    }))
  } catch (e) {
    console.error("Reading boiler_daily failed — run pnpm db:migrate?", e)
    days = []
  }
  if (await isAuthenticated()) return { resolution: "day", days }
  return { resolution: "week", ...aggregateBoilerDays(days) }
}

/**
 * Pulls daily boiler-on time from Netatmo into boiler_daily. Open to anonymous
 * visitors because it only stores data fetched from the API. Each run first
 * claims last_attempt_at with a conditional update, so concurrent page loads
 * and failing runs reach Netatmo at most once per 30 min.
 */
export async function syncBoilerHours(): Promise<BoilerSyncStatus> {
  if (!isNetatmoConfigured()) return { status: "not-configured", added: 0, lastSyncAt: null }

  let lastSyncAt: string | null = null
  try {
    const auth = await getAuthRow()
    lastSyncAt = auth?.last_sync_at ?? null
    const now = Date.now()
    if (lastSyncAt && now - new Date(lastSyncAt).getTime() < SYNC_INTERVAL_MS) {
      return { status: "skipped", added: 0, lastSyncAt }
    }

    if (!auth) {
      const envToken = process.env.NETATMO_REFRESH_TOKEN
      if (!envToken) return { status: "not-configured", added: 0, lastSyncAt: null }
      await db.execute({
        sql: "insert into netatmo_auth (id, refresh_token) values (1, ?) on conflict(id) do nothing",
        args: [envToken],
      })
    }
    const claim = await db.execute({
      sql: `update netatmo_auth set last_attempt_at = ?
            where id = 1 and (last_attempt_at is null or last_attempt_at < ?)`,
      args: [new Date(now).toISOString(), new Date(now - RETRY_INTERVAL_MS).toISOString()],
    })
    if (claim.rowsAffected === 0) return { status: "skipped", added: 0, lastSyncAt }

    const latest = await db.execute("select max(day) as day from boiler_daily")
    const latestDay = latest.rows[0]?.day as string | null
    let from: Date
    if (latestDay) {
      from = new Date(`${latestDay}T00:00:00Z`)
      from.setUTCDate(from.getUTCDate() - REFETCH_DAYS)
    } else {
      const first = await db.execute("select min(recorded_at) as at from readings")
      from = new Date((first.rows[0]?.at as string | null) ?? now)
    }

    const days = await fetchBoilerDays(from, new Date())
    const syncedAt = new Date().toISOString()
    await db.batch(
      [
        ...[...days].map(([day, seconds]) => ({
          sql: `insert into boiler_daily (day, boiler_on_seconds, fetched_at) values (?, ?, ?)
                on conflict(day) do update set
                  boiler_on_seconds = excluded.boiler_on_seconds,
                  fetched_at = excluded.fetched_at`,
          args: [day, seconds, syncedAt],
        })),
        { sql: "update netatmo_auth set last_sync_at = ? where id = 1", args: [syncedAt] },
      ],
      "write"
    )
    return { status: "ok", added: days.size, lastSyncAt: syncedAt }
  } catch (e) {
    console.error("Netatmo sync failed", e)
    return {
      status: "error",
      added: 0,
      lastSyncAt,
      error: e instanceof Error ? e.message : "Netatmo sync failed",
    }
  }
}
