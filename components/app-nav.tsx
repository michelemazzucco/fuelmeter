"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Fuel } from "lucide-react"

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/readings", label: "Readings" },
  { href: "/settings", label: "Settings" },
]

export function AppNav() {
  const pathname = usePathname()

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
      </div>
    </header>
  )
}
