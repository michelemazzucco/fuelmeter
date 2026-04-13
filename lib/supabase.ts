import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error(
        "Missing Supabase env vars. Copy .env.local.example to .env.local and fill in your project credentials."
      )
    }
    _client = createClient(url, key)
  }
  return _client
}

// Convenience proxy — behaves like the old `supabase` export but initializes lazily
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export type Reading = {
  id: string
  recorded_at: string
  level_cm: number | null
  level_liters: number | null
  is_refill: boolean
  notes: string | null
  created_at: string
}

export type TankConfig = {
  id: string
  capacity_liters: number
  low_threshold_liters: number
  updated_at: string
}
