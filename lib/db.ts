import "server-only"
import { createClient } from "@libsql/client"

const url = process.env.TURSO_DATABASE_URL

if (!url) {
  throw new Error(
    "Missing TURSO_DATABASE_URL. Copy .env.local.example to .env.local " +
      "(local dev uses file:./local.db)."
  )
}

// One libSQL client for the whole server. Points at a local SQLite file in dev
// (file:./local.db) and at Turso in production — same API for both.
export const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
