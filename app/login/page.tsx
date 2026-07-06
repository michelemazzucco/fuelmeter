"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { login } from "@/lib/actions"
import { useAuth } from "@/components/auth-provider"
import { PaperBox } from "@/components/paper"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export default function LoginPage() {
  const router = useRouter()
  const isAuthenticated = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/")
    }
  }, [isAuthenticated, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error } = await login(username, password)
    if (error) {
      setError(error)
      setSubmitting(false)
      return
    }
    router.push("/")
    router.refresh()
  }

  return (
    <div className="max-w-sm">
      <h1 className="sr-only">Login</h1>
      <PaperBox label="Login">
        <form onSubmit={handleSubmit} className="space-y-5">
          <p className="text-muted-foreground uppercase">
            Sign in to add readings and edit settings.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="username" className="uppercase">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              autoComplete="username"
              className="border-[0.5px] bg-transparent"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="uppercase">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="border-[0.5px] bg-transparent"
            />
          </div>
          {error && <p className="uppercase text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="uppercase">
            {submitting ? "Logging in…" : "Login"}
          </Button>
        </form>
      </PaperBox>
    </div>
  )
}
