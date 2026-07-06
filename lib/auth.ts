import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"

// Single-user auth. Credentials + signing secret come from server-only env vars.
// The session cookie is an HMAC-SHA256 signature — nothing sensitive is stored in
// it, and the server validates the signature to authenticate.

export const SESSION_COOKIE = "fm_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Set AUTH_USERNAME, AUTH_PASSWORD and AUTH_SECRET in .env.local ` +
        "(see .env.local.example)."
    )
  }
  return value
}

// Constant-time string comparison that also avoids leaking length via early return.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  if (bufA.length !== bufB.length) {
    // Still run a comparison to keep timing roughly constant.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = requireEnv("AUTH_USERNAME")
  const expectedPass = requireEnv("AUTH_PASSWORD")
  // Evaluate both so a wrong username doesn't short-circuit the password check.
  const userOk = safeEqual(username, expectedUser)
  const passOk = safeEqual(password, expectedPass)
  return userOk && passOk
}

export function createSessionToken(): string {
  const secret = requireEnv("AUTH_SECRET")
  const username = requireEnv("AUTH_USERNAME")
  return createHmac("sha256", secret).update(username).digest("hex")
}

export function verifySessionToken(token: string): boolean {
  if (!token) return false
  return safeEqual(token, createSessionToken())
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  return token ? verifySessionToken(token) : false
}

export async function assertAuthenticated(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw new Error("Not authorized")
  }
}
