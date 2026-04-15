# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # start dev server at localhost:3000
pnpm build        # production build (type-checks via tsc first)
pnpm tsc --noEmit # type-check only

# Supabase local stack (requires Docker)
supabase start                # start local Postgres + Studio at localhost:54323
supabase stop                 # stop (data preserved)
supabase stop --no-backup     # stop + wipe
supabase db reset             # wipe local DB, replay all migrations, load seed.sql
supabase migration new <name> # create a new migration file
supabase db push              # push pending migrations to remote project
```

Always use **pnpm**, never npm or yarn.

## Architecture

**Stack:** Next.js 16 App Router · Tailwind CSS v4 · shadcn/ui (base/Nova preset) · Supabase (Postgres) · Recharts · date-fns

### Data flow
All pages are `"use client"` and fetch directly from Supabase via the browser client in `lib/supabase.ts`. There is no API layer — reads and writes go straight to Supabase from the component.

### Key lib files
- `lib/supabase.ts` — lazy Supabase client (proxy pattern to avoid prerender crash when env vars are absent). Exports the `Reading` and `TankConfig` types.
- `lib/tank-lookup.ts` — cm → litres lookup table (manufacturer calibration, 1–110 cm = 1564 L max). `cmToLiters(cm)` interpolates linearly for decimal values. Single source of truth for the conversion — never duplicate it.
- `lib/predictions.ts` — `computePrediction()` takes all readings and returns run-out date, days remaining, daily rate, and forecast chart points. Only readings with non-null `level_liters` are used. Key model details:
  - **Segment detection** uses `is_refill` to find the current consumption cycle (fallback: last level increase).
  - **Rate estimation** uses OLS linear regression through all readings in the current segment — more robust than endpoint-to-endpoint when any individual reading is noisy.
  - **Short-segment blending**: when the current segment spans < 90 days (e.g. just after a refill), the OLS rate is blended with the exponentially-weighted mean of all historical segment rates (`α = segmentDays/90`). At 90+ days, the current OLS rate is used fully.
  - **Seasonal model** (`computeMonthlyWeights`): derives 12 dimensionless monthly weights (mean = 1.0) from all historical segments. Requires ≥ 6 covered months; otherwise falls back to flat rate.
  - **Calibrated rate**: raw OLS rate ÷ average seasonal weight of the segment → season-independent L/day. Projection applies `calibratedRate × weight[month]` day-by-day.
  - **Confidence band**: cross-segment std dev of calibrated rates gives `rateStdDev`. Projected `ForecastPoint`s carry optional `levelLow` (pessimistic, +1σ) and `levelHigh` (optimistic, −1σ) fields rendered as faint dashed lines in the chart.

### Database schema (`supabase/migrations/`)
Two tables:
- `tank_config` — single row, `capacity_liters` (default 1564) and `low_threshold_liters`.
- `readings` — `level_cm` (nullable, primary dip-stick measurement), `level_liters` (nullable, always derived via `cmToLiters` — never stored from manual input), `is_refill` (boolean), `notes`.

Seed data is in `supabase/seed.sql` (17 historical readings 2021–2026). After any schema change, run `supabase db reset` locally.

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
- Local dev: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, anon key is the `Publishable` key printed by `supabase start`.
- Remote project ref: `vxznsovcbeoutgozdnsy`.
