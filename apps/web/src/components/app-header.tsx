"use client";

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Github, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@marmot-sh/ui/shadcn/sheet";
import { DocsSearch } from "./docs-search";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

export function AppHeader({
  position = "sticky",
  showSearch = false,
  mobileSidebar,
}: {
  position?: "sticky" | "fixed";
  showSearch?: boolean;
  mobileSidebar?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className={cn(
        "top-0 z-50 border-b border-transparent bg-background/95 backdrop-blur-[2px]",
        position === "fixed" && "fixed w-full border-border",
        position === "sticky" && "sticky",
      )}
    >
      <div className="flex h-14 w-full items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <div className="ml-auto flex items-center gap-2">
          {showSearch ? (
            <div className="hidden w-56 md:block lg:w-64">
              <DocsSearch />
            </div>
          ) : null}

          <div className="hidden items-center gap-2 md:flex">
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              activeProps={{ className: "!text-foreground" }}
              className="inline-flex h-9 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Docs
            </Link>
            <a
              href="https://github.com/marmot-sh/marmot"
              aria-label="GitHub"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Github className="h-[18px] w-[18px]" aria-hidden />
            </a>
            <ThemeToggle />
          </div>

          {/* The hamburger renders on every page at mobile width. When a
              sidebar is provided (docs pages) the drawer carries it.
              Otherwise it carries the same affordances the desktop header
              shows: Docs link, GitHub, theme toggle. Without this, mobile
              landing-page visitors would have no way to reach Docs, GitHub,
              or change the theme. */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <button
                  type="button"
                  aria-label="Open menu"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                >
                  <Menu className="h-[18px] w-[18px]" aria-hidden />
                </button>
              }
            />
            <SheetContent
              side="right"
              showCloseButton={false}
              className="w-72 gap-0 p-0"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Theme
                </span>
                <ThemeToggle />
              </div>
              <div
                className="flex-1 overflow-y-auto px-4 py-4"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) {
                    setMobileOpen(false);
                  }
                }}
              >
                {mobileSidebar ?? <DefaultMobileMenu />}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/**
 * Default contents of the mobile drawer when no page-specific sidebar is
 * supplied (landing page, marketing pages, etc.). Mirrors the desktop
 * top-bar affordances so mobile visitors aren't stranded.
 */
function DefaultMobileMenu() {
  return (
    <nav aria-label="Site" className="flex flex-col gap-1 text-sm">
      <Link
        to="/docs/$"
        params={{ _splat: "" }}
        className="block rounded-md px-3 py-2 font-medium text-foreground hover:bg-muted"
      >
        Docs
      </Link>
      <a
        href="https://github.com/marmot-sh/marmot"
        className="block rounded-md px-3 py-2 font-medium text-foreground hover:bg-muted"
      >
        GitHub
      </a>
    </nav>
  );
}
