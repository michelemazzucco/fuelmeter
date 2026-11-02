import "server-only"
import { db } from "./db"

const API = "https://api.netatmo.com"
const MAX_MEASURES = 1024
const DAY_SECONDS = 86400

type AuthRow = {
  access_token: string | null
  refresh_token: string
  expires_at: string | null
  relay_id: string | null
  thermostat_id: string | null
  timezone: string | null
  last_sync_at: string | null
  last_attempt_at: string | null
}

/** The refresh token comes from `pnpm netatmo:login` (stored in the DB) or the optional env var. */
export function isNetatmoConfigured(): boolean {
  return Boolean(process.env.NETATMO_CLIENT_ID && process.env.NETATMO_CLIENT_SECRET)
}

export async function getAuthRow(): Promise<AuthRow | null> {
  const { rows } = await db.execute("select * from netatmo_auth where id = 1")
  return (rows[0] as unknown as AuthRow) ?? null
}

async function requestToken(refreshToken: string) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.NETATMO_CLIENT_ID!,
      client_secret: process.env.NETATMO_CLIENT_SECRET!,
    }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Netatmo token refresh failed (${res.status})`)
  return (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
}

/**
 * Netatmo rotates the refresh token on every refresh, so the latest one must
 * be stored. If the stored one is rejected and the env var holds a different
 * (newly generated) token, retry with that.
 */
export async function getAccessToken(): Promise<string> {
  const row = await getAuthRow()
  const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : 0
  if (row?.access_token && expiresAt - Date.now() > 60_000) return row.access_token

  const envToken = process.env.NETATMO_REFRESH_TOKEN
  const refreshToken = row?.refresh_token ?? envToken
  if (!refreshToken) throw new Error("No Netatmo token yet — run pnpm netatmo:login")
  let token
  try {
    token = await requestToken(refreshToken)
  } catch (e) {
    if (!envToken || envToken === refreshToken) throw e
    token = await requestToken(envToken)
  }

  const newExpiry = new Date(Date.now() + token.expires_in * 1000).toISOString()
  await db.execute({
    sql: `insert into netatmo_auth (id, access_token, refresh_token, expires_at, updated_at)
          values (1, ?, ?, ?, ?)
          on conflict(id) do update set
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at`,
    args: [token.access_token, token.refresh_token, newExpiry, new Date().toISOString()],
  })
  return token.access_token
}

async function apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const accessToken = await getAccessToken()
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Netatmo ${path} failed (${res.status})`)
  const json = (await res.json()) as { body: T }
  return json.body
}

type Devices = { relayId: string; thermostatId: string; timezone: string }

/** Finds the NATherm1 thermostat and the NAPlug relay it reports through. */
export async function discoverDevices(): Promise<Devices> {
  const row = await getAuthRow()
  if (row?.relay_id && row.thermostat_id && row.timezone) {
    return { relayId: row.relay_id, thermostatId: row.thermostat_id, timezone: row.timezone }
  }

  const body = await apiGet<{
    homes: { timezone: string; modules?: { id: string; type: string; bridge?: string }[] }[]
  }>("/api/homesdata", {})

  for (const home of body.homes) {
    const thermostat = home.modules?.find((m) => m.type === "NATherm1")
    if (thermostat?.bridge) {
      const devices = {
        relayId: thermostat.bridge,
        thermostatId: thermostat.id,
        timezone: home.timezone,
      }
      await db.execute({
        sql: "update netatmo_auth set relay_id = ?, thermostat_id = ?, timezone = ? where id = 1",
        args: [devices.relayId, devices.thermostatId, devices.timezone],
      })
      return devices
    }
  }
  throw new Error("No Netatmo Smart Thermostat (NATherm1) found on this account")
}

/** Boiler-on seconds per local day (`yyyy-MM-dd` in the home timezone). */
export async function fetchBoilerDays(from: Date, to: Date): Promise<Map<string, number>> {
  const { relayId, thermostatId, timezone } = await discoverDevices()
  const toDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })

  const days = new Map<string, number>()
  let begin = Math.floor(from.getTime() / 1000)
  const end = Math.floor(to.getTime() / 1000)

  while (begin < end) {
    const chunkEnd = Math.min(end, begin + MAX_MEASURES * DAY_SECONDS)
    const body = await apiGet<Record<string, (number | null)[]>>("/api/getmeasure", {
      device_id: relayId,
      module_id: thermostatId,
      scale: "1day",
      type: "sum_boiler_on",
      date_begin: String(begin),
      date_end: String(chunkEnd),
      limit: String(MAX_MEASURES),
      optimize: "false",
      real_time: "false",
    })
    for (const [timestamp, [seconds]] of Object.entries(body ?? {})) {
      if (seconds == null) continue
      days.set(toDay.format(new Date(Number(timestamp) * 1000)), seconds)
    }
    begin = chunkEnd
  }
  return days
}
