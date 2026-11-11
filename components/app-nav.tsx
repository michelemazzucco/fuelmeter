"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AddRecord } from "@/components/add-record";

const links = [
  { href: "/", label: "DASHBOARD" },
  { href: "/readings", label: "ENTRIES" },
  { href: "/settings", label: "SETTINGS" },
];

const actionClass =
  "flex items-center gap-1 border-[0.5px] border-foreground bg-primary px-2 py-0.5 leading-[1em] uppercase text-primary-foreground transition-colors hover:bg-background hover:text-foreground";

export function AppNav({ showMcp }: { showMcp: boolean }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-background">
      <div className="flex max-w-5xl items-stretch gap-px px-2">
        <Link
          href="/"
          className="flex items-center pr-2.5 font-bold tracking-wide"
        >
          FUELMETER
        </Link>
        <nav className="flex items-stretch gap-px">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center px-2 leading-[1em] tracking-wide transition-colors hover:bg-foreground hover:text-background",
                pathname === link.href && "bg-foreground text-background",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-stretch gap-px">
          {showMcp && (
            <Link
              href="/mcp"
              className={cn(
                "flex items-center gap-1.5 px-2 leading-[1em] tracking-wide transition-colors hover:bg-foreground hover:text-background",
                pathname === "/mcp" && "bg-foreground text-background",
              )}
            >
              <span aria-hidden className="live-square size-[5px] bg-current" />
              MCP
            </Link>
          )}
          <AddRecord className={actionClass} />
        </div>
      </div>
    </header>
  );
}
