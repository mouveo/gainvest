"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS: { href: string; label: string; match: (path: string) => boolean }[] = [
  {
    href: "/portfolio",
    label: "Portefeuille",
    match: (p) => p === "/portfolio" || p.startsWith("/portfolio/"),
  },
  {
    href: "/settings/accounts",
    label: "Comptes",
    match: (p) => p.startsWith("/settings/accounts"),
  },
];

export function AppNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex items-center gap-4 text-sm">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-colors",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
