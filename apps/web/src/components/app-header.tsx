"use client";

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Github, Menu } from "lucide-react";
import { XTwitter } from "./logos";
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

const navLinkClass =
  "inline-flex h-9 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const iconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      <div className="flex h-14 w-full items-center px-4 sm:px-6 lg:px-8">
        {/* Left: logo. Takes equal flex share on md+ so the center section
            balances against the right cluster. */}
        <div className="md:flex-1">
          <Logo />
        </div>

        {/* Center: docs search on docs pages, marketing nav links elsewhere.
            md+ only — mobile uses the hamburger drawer. */}
        <div className="hidden md:flex md:flex-1 md:justify-center">
          {showSearch ? (
            <div className="w-56 lg:w-64">
              <DocsSearch />
            </div>
          ) : (
            <nav aria-label="Primary" className="flex items-center gap-1">
              <Link
                to="/docs/$"
                params={{ _splat: "" }}
                activeProps={{ className: "!text-foreground" }}
                className={navLinkClass}
              >
                Docs
              </Link>
              <Link
                to="/providers"
                activeProps={{ className: "!text-foreground" }}
                className={navLinkClass}
              >
                Providers
              </Link>
            </nav>
          )}
        </div>

        {/* Right: X, GitHub, theme toggle. Same on every page, marketing or
            docs. md+ only — mobile uses the hamburger drawer. */}
        <div className="hidden md:flex md:flex-1 md:items-center md:justify-end md:gap-2">
          <a
            href="https://x.com/marmot_sh"
            aria-label="X (formerly Twitter)"
            className={iconButtonClass}
          >
            <XTwitter className="h-[15px] w-auto" />
          </a>
          <a
            href="https://github.com/marmot-sh/marmot"
            aria-label="GitHub"
            className={iconButtonClass}
          >
            <Github className="h-[18px] w-[18px]" aria-hidden />
          </a>
          <ThemeToggle />
        </div>

        {/* Mobile hamburger. Pushed to the right by ml-auto since the logo
            doesn't grow on mobile (no flex-1 outside md:). */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label="Open menu"
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
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
      <Link
        to="/providers"
        className="block rounded-md px-3 py-2 font-medium text-foreground hover:bg-muted"
      >
        Providers
      </Link>
      <a
        href="https://github.com/marmot-sh/marmot"
        className="block rounded-md px-3 py-2 font-medium text-foreground hover:bg-muted"
      >
        GitHub
      </a>
      <a
        href="https://x.com/marmot_sh"
        className="block rounded-md px-3 py-2 font-medium text-foreground hover:bg-muted"
      >
        X
      </a>
    </nav>
  );
}
