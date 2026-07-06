// Resets the database: drops the tables, replays db/schema.sql, then db/seed.sql.
// Targets whatever TURSO_DATABASE_URL points at — a local file in dev
// (file:./local.db) or your Turso DB in prod (with TURSO_AUTH_TOKEN set).
//
//   pnpm db:reset
//
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createClient } from "@libsql/client"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

// Load .env.local if present, without overriding vars already in the environment
// (so prod runs can pass TURSO_* inline and still work even with no .env.local).
const envPath = join(root, ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^["']|["']$/g, "")
  }
}

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error("TURSO_DATABASE_URL is not set (expected e.g. file:./local.db).")
  process.exit(1)
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

const schema = readFileSync(join(root, "db", "schema.sql"), "utf8")
const seed = readFileSync(join(root, "db", "seed.sql"), "utf8")

console.log(`Resetting database at ${url} …`)
await db.executeMultiple(
  "drop table if exists readings; drop table if exists tank_config;"
)
await db.executeMultiple(schema)
await db.executeMultiple(seed)

const { rows } = await db.execute("select count(*) as n from readings")
console.log(`Done. ${rows[0].n} readings loaded.`)
