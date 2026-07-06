"use client"

import { createContext, useContext } from "react"

const AuthContext = createContext(false)

export function AuthProvider({
  isAuthenticated,
  children,
}: {
  isAuthenticated: boolean
  children: React.ReactNode
}) {
  return <AuthContext value={isAuthenticated}>{children}</AuthContext>
}

export function useAuth(): boolean {
  return useContext(AuthContext)
}
