import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PaperBox } from "@/components/paper"
import { CopyBlock } from "@/components/copy-button"

export const metadata: Metadata = {
  title: "MCP · Fuelmeter",
  description: "Read the tank, the forecast and the boiler hours from Claude, Cursor or any MCP client.",
}

// Mirrors the tools in mcp/src/mastra/mcp.ts; that package is not importable from the app.
const tools = [
  ["get_tank_status", "Capacity, latest reading, level estimated for today, % full"],
  ["get_forecast", "Run-out date, days left, L/day, optional curve with the ±1σ band"],
  ["list_readings", "Dip-stick readings, filter by date or refills"],
  ["get_daily_levels", "Estimated litres and burn per day in a range"],
  ["get_consumption_stats", "12-month and 30-day average, lightest and heaviest day, since refill"],
  ["list_consumption_cycles", "One row per refill cycle with litres, days and L/day"],
  ["get_seasonal_weights", "Monthly weights and the season-independent L/day"],
  ["get_boiler_hours", "Boiler-on hours per week or month"],
  ["get_boiler_model", "Base L/day without heating and litres per boiler hour (capped at the burner flow)"],
  ["convert_cm_to_liters", "Dip-stick cm to litres"],
]

const prompts = [
  "How much oil is left in the tank?",
  "When do I need to order more?",
  "How did this winter compare to last year?",
  "How many litres does one hour of heating burn?",
]

export default function McpPage() {
  const url = process.env.MCP_URL
  if (!url) notFound()

  const keyedUrl = `${url}?key=YOUR_KEY`
  const cursorConfig = JSON.stringify({ mcpServers: { fuelmeter: { url: keyedUrl } } }, null, 2)

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="space-y-2">
        <h1 className="font-bold uppercase tracking-wide">Talk to this tank</h1>
        <p>
          Fuelmeter is agent-readable. Add its MCP server to Claude, Cursor or any MCP client and ask
          about the tank from your chat. It is read-only and shows the same data as this dashboard.
        </p>
      </div>

      <PaperBox label="Server URL" contentClassName="space-y-2 px-4 pb-4 pt-5">
        <CopyBlock text={keyedUrl} />
        <p className="text-muted-foreground">
          The server needs a key. Ask me for one, then put it in place of YOUR_KEY.
        </p>
      </PaperBox>

      <PaperBox label="Setup" contentClassName="space-y-5 px-4 pb-4 pt-5">
        <div className="space-y-2">
          <h3 className="uppercase">Claude</h3>
          <p>Settings → Connectors → Add custom connector, then paste the server URL with your key. It also works in the phone app.</p>
          <p>
            To keep the key out of the URL, paste the URL without ?key=, pick No sign-in and add an
            authorization header with the value Bearer YOUR_KEY.
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="uppercase">Claude Code</h3>
          <CopyBlock text={`claude mcp add --transport http fuelmeter "${keyedUrl}"`} />
        </div>
        <div className="space-y-2">
          <h3 className="uppercase">Cursor</h3>
          <p>Add to ~/.cursor/mcp.json:</p>
          <CopyBlock text={cursorConfig} />
        </div>
      </PaperBox>

      <PaperBox label="Try asking">
        <ul className="space-y-1">
          {prompts.map((prompt) => (
            <li key={prompt}>“{prompt}”</li>
          ))}
        </ul>
      </PaperBox>

      <PaperBox label={`Tools · ${tools.length} read-only`}>
        <dl className="space-y-2">
          {tools.map(([name, description]) => (
            <div key={name}>
              <dt className="font-bold">{name}</dt>
              <dd className="text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </PaperBox>
    </div>
  )
}
