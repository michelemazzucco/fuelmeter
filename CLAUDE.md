# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server at localhost:3000
pnpm build        # production build (type-checks via tsc first)
pnpm tsc --noEmit # type-check only
pnpm test         # vitest, lib/*.test.ts (synthetic tank + boiler data)
pnpm db:reset     # drop readings/tank_config, replay db/schema.sql, load db/seed.sql
                  # targets TURSO_DATABASE_URL (local file in dev, Turso in prod)
pnpm db:migrate   # replay db/schema.sql only — additive, drops and seeds nothing
pnpm netatmo:login # one-time Netatmo OAuth login, stores tokens in the DB

cd mcp && pnpm dev   # read-only MCP server (Mastra) at localhost:4111
cd mcp && pnpm build # mastra build; also proves ../lib bundles without root node_modules
```

Always use **pnpm**, never npm or yarn.

## Architecture

**Stack:** Next.js 16 App Router · Tailwind CSS v4 · shadcn/ui (base/Nova preset) · SQLite via Turso/libSQL · Recharts · date-fns

### Data flow
Pages are `"use client"` and call **Server Actions** in `lib/actions.ts` (`"use server"`) for all reads and writes. The DB client is server-only — it must never be imported into client code. libSQL credentials live in server-only env vars (no `NEXT_PUBLIC_` prefix). Same `@libsql/client` points at a local SQLite file in dev and at Turso in prod.

### Key lib files
- `lib/db.ts` — server-only libSQL client singleton (`import "server-only"`). Reads `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
- `lib/actions.ts` — `"use server"` data layer: `getReadings`, `getTankConfig`, `addReading`, `deleteReading`, `saveTankConfig`. `mapReading` coerces SQLite `is_refill` (`0/1`) to a JS boolean. Use parameterized queries (`db.execute({ sql, args })`).
- `lib/types.ts` — the `Reading` and `TankConfig` types (importable from client code; pulls in no server-only deps).
- `lib/tank-lookup.ts` — cm → litres lookup table (manufacturer calibration, 1–110 cm = 1564 L max). `cmToLiters(cm)` interpolates linearly for decimal values. Single source of truth for the conversion — never duplicate it.
- `lib/predictions.ts` — `computePrediction()` takes all readings and returns run-out date, days remaining, daily rate, and forecast chart points. Only readings with non-null `level_liters` are used. Key model details:
  - **Segment detection** uses `is_refill` to find the current consumption cycle (fallback: last level increase).
  - **Rate estimation** uses OLS linear regression through all readings in the current segment — more robust than endpoint-to-endpoint when any individual reading is noisy.
  - **Short-segment blending**: when the current segment spans < 90 days (e.g. just after a refill), the OLS rate is blended with the exponentially-weighted mean of all historical segment rates (`α = segmentDays/90`). At 90+ days, the current OLS rate is used fully.
  - **Seasonal model** (`computeMonthlyWeights`): derives 12 dimensionless monthly weights (mean = 1.0) from all historical segments. Requires ≥ 6 covered months; otherwise falls back to flat rate.
  - **Calibrated rate**: raw OLS rate ÷ average seasonal weight of the segment → season-independent L/day. Projection applies `calibratedRate × weight[month]` day-by-day.
  - **Confidence band**: cross-segment std dev of calibrated rates gives `rateStdDev`. Projected `ForecastPoint`s carry optional `levelLow` (pessimistic, +1σ) and `levelHigh` (optimistic, −1σ) fields rendered as faint dashed lines in the chart.

- `lib/netatmo.ts` — server-only Netatmo client: token refresh (rotated refresh token saved in `netatmo_auth`), device discovery via `homesdata` (NATherm1 + its NAPlug relay), daily `sum_boiler_on` via `getmeasure`.
- `lib/heating.ts` — boiler-hours model, client-safe. `fitBoilerModel` fits `drop = base·days + k·hours` on reading intervals ≥ 90 % covered by Netatmo, and needs 3 of them with ≥ 100 boiler hours in total. Until then the fallback sets base = calibrated rate × lightest seasonal weight and gives k the rest of the drops; it also takes partly covered intervals (≥ 14 covered days), where the covered days get the share of the drop that the seasonal weights give them, and it needs ≥ 100 boiler hours in total (with fewer, k is mostly estimation error). No model → `buildBoilerContext` returns `null` and the Heating box shows `NOT ENOUGH DATA YET`. `nearTermCorrection` = last 14 days' boiler burn ÷ seasonal expectation, clamped to [0.5, 1.5]. `buildBoilerContext` bundles both for the optional `boiler` arg of `computeDailyHistory` / `computeConsumptionStats` / `computePrediction`: measured days burn `base + k·hours` (in the daily history other days of the same interval burn at the seasonal rate, and the total is scaled to the measured drop), and the forecast's first 30 days are scaled by the correction, fading to the plain seasonal model. Without the arg, behavior is unchanged.

- `lib/rows.ts` — `mapReading` / `mapConfig` (SQLite row → type). Shared by `actions.ts` and the MCP, since a `"use server"` file can only export async functions.

### MCP server (`mcp/`)
Separate pnpm package (own lockfile, excluded from the root `tsconfig.json`), deployed on Mastra Cloud with project root `mcp/`. One `MCPServer` with 10 read-only tools that load rows through `mcp/src/mastra/db.ts` and call the pure functions in `lib/` (never copy them: the old `fuelmeter-agent` copy drifted). `lib/` files it imports must stay free of `server-only`, Next and `@/` imports. Every `/api/*` route needs `MCP_KEY` as `?key=` or a Bearer header. `legacy: "stateless"` keeps 2025-revision clients like claude.ai working on `@mastra/mcp` 2.x. Boiler data goes through `publicBoilerHours` + `boilerDaysOf` (the anonymous-viewer view), never daily values, because the key travels in the URL. Tools carry `readOnlyHint` (shared `readOnly` in `context.ts`), and `index.ts` forces `TZ` to `HOME_TZ` (default `Europe/Rome`) because the dashboard computes on browser time. See `mcp/README.md`.

### Database schema (`db/schema.sql`)
SQLite. Four tables:
- `tank_config` — single row, `capacity_liters` (default 1564) and `low_threshold_liters`.
- `netatmo_auth` — single row (`id = 1`): Netatmo tokens, discovered device ids, home timezone, `last_sync_at` (last success), `last_attempt_at` (claimed atomically before each run, so failures and concurrent loads retry at most every 30 min).
- `boiler_daily` — `day` (`yyyy-MM-dd`, home timezone) → `boiler_on_seconds`. Filled by the `syncBoilerHours` server action (called on dashboard load, at most every 6 h; refetches the last 2 days). Read through `getBoilerHours`: daily values only for a logged-in user (they reveal when the house is empty); anonymous viewers get weekly + monthly totals through `publicBoilerHours`, which leaves out the week in progress (its total grows with each sync and would show day by day whether the house is heated), and `boilerDaysOf` spreads the weeks evenly into days for the model.
- `readings` — `level_cm` (nullable real, primary dip-stick measurement), `level_liters` (nullable real, always derived via `cmToLiters` — never stored from manual input), `is_refill` (`integer` 0/1, exposed as boolean by `mapReading`), `notes`.

SQLite type notes: ids are `text` (default `lower(hex(randomblob(16)))`); litre/cm columns are `real`; timestamps are ISO `text` (`recorded_at` is supplied by the app, `created_at`/`updated_at` default to `current_timestamp`).

Seed data is in `db/seed.sql` (17 historical readings 2021–2026). After an additive schema change run `pnpm db:migrate`; `pnpm db:reset` wipes readings, so never run it against prod once real data is there. The reset keeps `netatmo_auth` / `boiler_daily`.

### Recharts pitfalls
- **Never wrap Recharts children in a React Fragment** (`<>...</>`). Recharts scans direct children to identify its own components; a Fragment hides them and silently breaks the whole chart. Use individual `{condition && <Line ... />}` expressions instead.
- **CSS variable names must match `chartConfig` keys**: `ChartContainer` generates `--color-<key>` from each config entry. If you use `stroke="var(--color-level)"` the config must have a `level` key — not `actual` or any other name.
- The `dataKey` on a `Line` and the `chartConfig` key do **not** need to match. The config key drives the CSS variable name; the dataKey drives data lookup.

### shadcn/ui — base-ui primitives, not Radix
This project uses the **base** component library (`@base-ui/react`), not the default Radix variant. The critical difference: use the `render` prop instead of `asChild`:

```tsx
// correct
<SheetTrigger render={<Button />}>Label</SheetTrigger>

// wrong — asChild does not exist on base-ui components
<SheetTrigger asChild><Button>Label</Button></SheetTrigger>
```

When adding new shadcn components:
```bash
pnpm dlx shadcn@latest add <component> --yes
```

### Environment
Copy `.env.local.example` → `.env.local`.
- Netatmo (optional): `NETATMO_CLIENT_ID`, `NETATMO_CLIENT_SECRET` from an app at dev.netatmo.com whose redirect URI is `http://localhost:8787/callback`. Run `pnpm netatmo:login` once: it does the OAuth login in the browser and stores the tokens in `netatmo_auth` (the dev portal's token generator is unreliable). The rotated refresh token then lives there. `NETATMO_REFRESH_TOKEN` is an optional fallback. Without them the dashboard has no Heating box and the forecast is unchanged.
- Local dev: `TURSO_DATABASE_URL=file:./local.db` (no auth token needed). Run `pnpm db:reset` to create/seed the file.
- Production (Turso + Vercel):
  1. `pnpm dlx turso db create fuelmeter`, then `turso db tokens create fuelmeter`.
  2. Seed prod once: run `pnpm db:reset` with `TURSO_DATABASE_URL` (`libsql://…`) and `TURSO_AUTH_TOKEN` set to the Turso values.
  3. Add both env vars in Vercel project settings — **server-only**, no `NEXT_PUBLIC_` prefix. Server Actions run on the Node runtime by default.
