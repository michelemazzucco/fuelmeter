"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { login } from "@/lib/actions"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    router.refresh()
    onSuccess()
  }

  return (
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
  )
}
