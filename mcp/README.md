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
cp .env.example .env   # set MCP_KEY to something, e.g. openssl rand -hex 32
pnpm install
pnpm dev               # http://localhost:4111
```

The MCP endpoint is `http://localhost:4111/api/mcp/fuelmeter/mcp?key=<MCP_KEY>`. Every `/api` route, Studio included, answers 401 without the key. Send it as `?key=` or as a Bearer header. With `MCP_KEY` unset every route answers 401 to everyone. To try the tools, use the MCP inspector with that URL:

```bash
npx @modelcontextprotocol/inspector
```

## Deploy on the Mastra platform

Deploys go through the CLI. There is no deploy on push.

1. Make a read-only Turso token: `turso db tokens create fuelmeter --read-only`.
2. Put `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (the read-only one), `MCP_KEY` and `HOME_TZ` in `mcp/.env`. The first deploy uploads this file as the server's env vars. After that, change them with `pnpm exec mastra server env set` or in the dashboard.
3. `pnpm exec mastra auth login`, then `pnpm exec mastra server deploy` from `mcp/`. `.mastra-project.json` links this folder to the `fuelmeter` project. Set `MCP_KEY` before the deploy, or the endpoint answers 401 to everyone.
4. In claude.ai, Settings → Connectors → Add custom connector, URL `https://fuelmeter.server.mastra.cloud/api/mcp/fuelmeter/mcp`. Under Authentication pick "No sign-in" (with "Sign in now" the `authorization` header is not selectable), then add a request header `authorization` with the value `Bearer <MCP_KEY>`. If your dialog has no request headers, use the URL with `?key=<MCP_KEY>` instead. It then shows up in the phone app too.
5. Set `MCP_URL` to the URL without the key in the web app (Vercel). It shows the MCP menu item and the `/mcp` setup page, which gives the address with a `YOUR_KEY` placeholder. The real key never goes in the web app.

The endpoint needs the key so that strangers cannot use up the Mastra credit and the Turso quota. The key is not what protects the data, because it travels in a URL and a URL can leak. The MCP shows the same data as the public dashboard. Daily boiler hours show when the house is empty, so it gives only weekly and monthly totals and leaves out the week in progress, and the model spreads each week evenly over its days, like the dashboard does for anonymous viewers. A leaked URL then shows nothing new. Keep this rule if you add tools: nothing in the MCP may show more than an anonymous dashboard viewer sees. To rotate the key, change `MCP_KEY` and update the connector.

The dashboard runs the model in the browser, on home time. The server always sets `TZ` to `HOME_TZ` (default `Europe/Rome`) and overrides the host's own `TZ`, so days, "today" and the run-out date match the dashboard.
