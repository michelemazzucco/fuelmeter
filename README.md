# FuelMeter

Know how much diesel is left in the tank, and when it'll run out.

## Why it exists

Up in the mountains I heat the house and the water with a diesel tank, and "do I
have enough to make it through winter" used to be a vibe rather than a number. The
tank has no gauge. You check it with a dip-stick, get a reading in centimetres, and
then guess.

So I built FuelMeter. I log the dip-stick reading, it converts to litres off the
manufacturer's calibration table, and it tells me roughly when I'll run out. The
bit I'm weirdly proud of is the forecast: a flat rate lies, because I burn way more
in January than in May. So instead of averaging, it learns the seasonal pattern
from my own history and draws a confidence band around the projection.

It's deeply boring to anyone but me, and I check it constantly.

## What it does

- **Log a reading** in centimetres (the raw dip-stick measurement) and mark refills.
- **Converts cm to litres** against the manufacturer's calibration table
  (`lib/tank-lookup.ts`, 1–110 cm maps to a full tank of 1564 L), interpolating for
  decimal values.
- **Shows the tank state**: a fuel gauge and a consumption chart of your history.
- **Forecasts the run-out date** with a seasonal model learned from your own usage,
  not a flat rate, and puts a confidence band around it.

## How the forecast works

The predictor (`lib/predictions.ts`) finds the current fill cycle (the readings
since the last refill) and estimates a consumption rate with OLS linear regression
over that segment, which holds up better than endpoint-to-endpoint when a single
reading is noisy. Just after a refill, when the segment is short, that rate is
blended with your historical average so early predictions aren't wild.

On top of that it derives 12 monthly seasonal weights from all of your history, so
the projection burns fuel faster in winter and slower in summer instead of assuming
a constant rate. The spread between segments becomes a ±1σ confidence band around
the forecast line.

For the full model details, see [`CLAUDE.md`](./CLAUDE.md).

## Tech stack

- **Next.js 16** (App Router) · **React 19**
- **Tailwind CSS v4** · **shadcn/ui** (base-ui primitives)
- **SQLite** via **Turso / libSQL** (`@libsql/client`)
- **Recharts** for charts · **date-fns** for date math

Pages are client components that call **Server Actions** (`lib/actions.ts`) for all
reads and writes. The database client is server-only.

## Getting started

Requires [pnpm](https://pnpm.io/).

```bash
# 1. Configure environment
cp .env.local.example .env.local
# The DB URL is preset for local dev (TURSO_DATABASE_URL=file:./local.db).
# Fill in the single-user login: AUTH_USERNAME, AUTH_PASSWORD, and a long
# random AUTH_SECRET.

# 2. Install dependencies
pnpm install

# 3. Create and seed the local database
pnpm db:reset

# 4. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Other useful commands:

```bash
pnpm build         # production build (type-checks first)
pnpm tsc --noEmit  # type-check only
pnpm db:reset      # drop tables, replay db/schema.sql, load db/seed.sql
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture notes, the prediction model, and
production (Turso + Vercel) setup.

## Author

A personal project by [Michele Mazzucco](https://michelemazzucco.it).
