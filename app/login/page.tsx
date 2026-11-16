"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { LoginForm } from "@/components/login-form"
import { PaperBox } from "@/components/paper"

export default function LoginPage() {
  const router = useRouter()
  const isAuthenticated = useAuth()

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/")
    }
  }, [isAuthenticated, router])

  return (
    <div className="max-w-sm">
      <h1 className="sr-only">Login</h1>
      <PaperBox label="Login">
        <LoginForm onSuccess={() => router.push("/")} />
      </PaperBox>
    </div>
  )
}
