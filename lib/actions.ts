"use server"

import { cookies } from "next/headers"
import { db } from "./db"
import type { Reading, TankConfig } from "./types"
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
