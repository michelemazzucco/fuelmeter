# FuelMeter MCP

Read-only MCP server over the FuelMeter database, built with Mastra. It lets Claude (web, desktop, phone) read the tank readings, the forecast, the consumption and the Netatmo boiler hours.

It imports the models from `../lib` directly, so the numbers are the same as the dashboard.

## Tools

| Tool | What it gives |
|---|---|
| `get_tank_status` | capacity, latest reading, level estimated for today, % full |
| `get_forecast` | run-out date, days left, L/day, optional curve with the ±1σ band |
| `list_readings` | dip-stick readings, filter by date or refills |
| `get_daily_levels` | estimated litres and burn per day in a range (max 400 days) |
| `get_consumption_stats` | 12-month and 30-day average, lightest and heaviest day, since refill |
| `list_consumption_cycles` | one row per refill cycle with litres, days and L/day |
| `get_seasonal_weights` | monthly weights and the season-independent L/day |
| `get_boiler_hours` | boiler-on hours per week or month, without the week in progress |
| `get_boiler_model` | base L/day without heating and litres per boiler hour (capped at the burner flow) |
| `convert_cm_to_liters` | dip-stick cm to litres |

## Run locally

```bash
cp .env.example .env   # set MCP_KEY to something, e.g. openssl rand -hex 32 (guards Studio)
pnpm install
pnpm dev               # http://localhost:4111
```

The MCP endpoint is `http://localhost:4111/api/mcp/fuelmeter/mcp`. It is public. Every other `/api` route, Studio included, answers 401 without `?key=<MCP_KEY>` or a Bearer header. To try the tools, use the MCP inspector:

```bash
npx @modelcontextprotocol/inspector
```

## Deploy on Mastra Cloud

1. Make a read-only Turso token: `turso db tokens create fuelmeter --read-only`.
2. Create a Mastra Cloud project from this repo with project root `mcp/`.
3. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (the read-only one) and `MCP_KEY`.
4. In claude.ai, Settings → Connectors → Add custom connector, URL `https://<project>.mastra.cloud/api/mcp/fuelmeter/mcp`. It then shows up in the phone app too.

The MCP shows the same data as the public dashboard. Daily boiler hours show when the house is empty, so it gives only weekly and monthly totals and leaves out the week in progress, and the model spreads each week evenly over its days, like the dashboard does for anonymous viewers. That is why the endpoint can be public, like the dashboard. Keep this rule if you add tools: nothing in the MCP may show more than an anonymous dashboard viewer sees.

The dashboard runs the model in the browser, on home time. The server always sets `TZ` to `HOME_TZ` (default `Europe/Rome`) and overrides the host's own `TZ`, so days, "today" and the run-out date match the dashboard.
