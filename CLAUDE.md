# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server at localhost:3000
pnpm build        # production build (type-checks via tsc first)
pnpm tsc --noEmit # type-check only
pnpm db:reset     # drop tables, replay db/schema.sql, load db/seed.sql
                  # targets TURSO_DATABASE_URL (local file in dev, Turso in prod)
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

### Database schema (`db/schema.sql`)
SQLite. Two tables:
- `tank_config` — single row, `capacity_liters` (default 1564) and `low_threshold_liters`.
- `readings` — `level_cm` (nullable real, primary dip-stick measurement), `level_liters` (nullable real, always derived via `cmToLiters` — never stored from manual input), `is_refill` (`integer` 0/1, exposed as boolean by `mapReading`), `notes`.

SQLite type notes: ids are `text` (default `lower(hex(randomblob(16)))`); litre/cm columns are `real`; timestamps are ISO `text` (`recorded_at` is supplied by the app, `created_at`/`updated_at` default to `current_timestamp`).

Seed data is in `db/seed.sql` (17 historical readings 2021–2026). After any schema change, run `pnpm db:reset` (locally, and once against prod with the Turso env vars set).

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
- Local dev: `TURSO_DATABASE_URL=file:./local.db` (no auth token needed). Run `pnpm db:reset` to create/seed the file.
- Production (Turso + Vercel):
  1. `pnpm dlx turso db create fuelmeter`, then `turso db tokens create fuelmeter`.
  2. Seed prod once: run `pnpm db:reset` with `TURSO_DATABASE_URL` (`libsql://…`) and `TURSO_AUTH_TOKEN` set to the Turso values.
  3. Add both env vars in Vercel project settings — **server-only**, no `NEXT_PUBLIC_` prefix. Server Actions run on the Node runtime by default.
