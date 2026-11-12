import { createClient, type Client } from "@libsql/client"
import { format } from "date-fns"
import { publicBoilerHours } from "../../../lib/heating"
import { mapConfig, mapReading, type Row } from "../../../lib/rows"
import type { BoilerHours, Reading, TankConfig } from "../../../lib/types"

let client: Client | undefined

function db(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) throw new Error("TURSO_DATABASE_URL is not set")
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  return client
}

export async function loadReadings(): Promise<Reading[]> {
  const { rows } = await db().execute("select * from readings order by recorded_at asc")
  return rows.map((r) => mapReading(r as Row))
}

export async function loadConfig(): Promise<TankConfig> {
  const { rows } = await db().execute("select * from tank_config limit 1")
  if (!rows[0]) throw new Error("tank_config has no row")
  return mapConfig(rows[0] as Row)
}

/**
 * The same weekly view an anonymous dashboard viewer gets, never daily values:
 * those show when the house is empty, and the MCP key travels in a URL.
 * Empty when Netatmo was never set up and the table does not exist yet.
 */
export async function loadBoilerHours(): Promise<Extract<BoilerHours, { resolution: "week" }>> {
  let days: { day: string; hours: number }[] = []
  try {
    const { rows } = await db().execute(
      "select day, boiler_on_seconds from boiler_daily order by day asc"
    )
    days = rows.map((r) => ({ day: r.day as string, hours: (r.boiler_on_seconds as number) / 3600 }))
  } catch {}
  return { resolution: "week", ...publicBoilerHours(days, format(new Date(), "yyyy-MM-dd")) }
}
