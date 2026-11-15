"use client"

import { MacWindow } from "@/components/mac-window"
import { LoginForm } from "@/components/login-form"

interface LoginWindowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cascade?: boolean
}

export function LoginWindow({ open, onOpenChange, cascade }: LoginWindowProps) {
  return (
    <MacWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Login"
      description="Sign in to add readings and edit settings."
      cascade={cascade}
    >
      <LoginForm onSuccess={() => onOpenChange(false)} />
    </MacWindow>
  )
}
