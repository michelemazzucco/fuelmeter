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
        // The MCP endpoint is public: it serves only what the public dashboard shows.
        // The key guards the rest (Studio and Mastra's own routes).
        handler: async (c, next) => {
          if (c.req.path.startsWith("/api/mcp/")) return next()
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
