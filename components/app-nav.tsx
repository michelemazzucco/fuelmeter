"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Fuel, LogIn, LogOut } from "lucide-react"
import { logout } from "@/lib/actions"
import { useAuth } from "@/components/auth-provider"
import { Button, buttonVariants } from "@/components/ui/button"

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/readings", label: "Readings" },
  { href: "/settings", label: "Settings" },
]

export function AppNav() {
  const pathname = usePathname()
  const router = useRouter()
  const isAuthenticated = useAuth()

  async function handleLogout() {
    await logout()
    router.refresh()
  }

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-40">
      <div className="container mx-auto px-4 max-w-5xl h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
          <Fuel className="h-5 w-5 text-amber-500" />
          <span>FuelMeter</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === link.href
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          {isAuthenticated ? (
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-1 h-4 w-4" />
              Log out
            </Button>
          ) : (
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <LogIn className="mr-1 h-4 w-4" />
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
