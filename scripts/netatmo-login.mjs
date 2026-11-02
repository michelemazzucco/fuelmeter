// One-time Netatmo login, in place of the dev portal's token generator.
// Opens the Netatmo consent page, catches the redirect on localhost, swaps the
// code for tokens and stores them in netatmo_auth (in TURSO_DATABASE_URL).
//
//   pnpm netatmo:login
//
// The app at dev.netatmo.com must list http://localhost:8787/callback as its
// redirect URI.
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { createClient } from "@libsql/client"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const { NETATMO_CLIENT_ID, NETATMO_CLIENT_SECRET, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } =
  process.env
if (!NETATMO_CLIENT_ID || !NETATMO_CLIENT_SECRET || !TURSO_DATABASE_URL) {
  console.error("Set NETATMO_CLIENT_ID, NETATMO_CLIENT_SECRET and TURSO_DATABASE_URL in .env.local.")
  process.exit(1)
}

const PORT = 8787
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const SCOPE = "read_thermostat"
const state = randomBytes(16).toString("hex")

const authorizeUrl =
  "https://api.netatmo.com/oauth2/authorize?" +
  new URLSearchParams({
    client_id: NETATMO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
  })

async function exchange(code) {
  const res = await fetch("https://api.netatmo.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: NETATMO_CLIENT_ID,
      client_secret: NETATMO_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`)
  return res.json()
}

async function store(token) {
  const db = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN })
  const now = new Date()
  // Clearing last_attempt_at lets the next dashboard load sync right away
  await db.execute({
    sql: `insert into netatmo_auth (id, access_token, refresh_token, expires_at, updated_at)
          values (1, ?, ?, ?, ?)
          on conflict(id) do update set
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            last_attempt_at = null,
            updated_at = excluded.updated_at`,
    args: [
      token.access_token,
      token.refresh_token,
      new Date(now.getTime() + token.expires_in * 1000).toISOString(),
      now.toISOString(),
    ],
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI)
  if (url.pathname !== "/callback") {
    res.writeHead(404).end()
    return
  }
  const reply = (status, text) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(text)
  }

  const error = url.searchParams.get("error")
  if (error) {
    reply(400, `Netatmo refused: ${error}`)
    console.error(`Netatmo refused: ${error}`)
    server.close()
    process.exitCode = 1
    return
  }
  if (url.searchParams.get("state") !== state) {
    reply(400, "State mismatch — start pnpm netatmo:login again.")
    return
  }

  try {
    await store(await exchange(url.searchParams.get("code")))
    reply(200, "Netatmo connected. You can close this tab.")
    console.log(`Netatmo connected. Tokens saved to ${TURSO_DATABASE_URL}.`)
  } catch (e) {
    reply(500, String(e))
    console.error(e)
    process.exitCode = 1
  }
  server.close()
})

server.listen(PORT, () => {
  console.log(`Opening the Netatmo login page. If no browser opens, visit:\n${authorizeUrl}`)
  spawn("open", [authorizeUrl], { stdio: "ignore", detached: true }).on("error", () => {})
})
