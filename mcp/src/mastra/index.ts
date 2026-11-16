import { Mastra } from "@mastra/core"
import { timingSafeEqual } from "node:crypto"
import { fuelmeterServer } from "./mcp"

// The dashboard runs the model in the browser on home time; days and "today" must match it.
// Hosts often set TZ=UTC themselves, so a separate variable overrides it.
process.env.TZ = process.env.HOME_TZ || "Europe/Rome"

function keyMatches(given: string | undefined): boolean {
  const expected = process.env.MCP_KEY
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const mastra = new Mastra({
  mcpServers: { fuelmeter: fuelmeterServer },
  server: {
    middleware: [
      {
        path: "/api/*",
        // Some MCP clients cannot send a header, so the key also travels in the URL
        handler: async (c, next) => {
          const bearer = c.req.header("Authorization")?.replace(/^Bearer /, "")
          if (!keyMatches(c.req.query("key") ?? bearer)) {
            return new Response("Unauthorized", { status: 401 })
          }
          await next()
        },
      },
    ],
  },
})
