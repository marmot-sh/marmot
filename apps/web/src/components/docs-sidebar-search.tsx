"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useDocsSearch } from "fumadocs-core/search/client";
import { cn } from "@/lib/utils";

const baseUrl = "/docs";

function splitUrl(url: string): { splat: string; hash?: string } {
  const hashIndex = url.indexOf("#");
  const path = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : undefined;

  let splat = "";
  if (path === baseUrl || path === `${baseUrl}/`) {
    splat = "";
  } else {
    const prefix = `${baseUrl}/`;
    splat = path.startsWith(prefix)
      ? path.slice(prefix.length)
      : path.replace(/^\//, "");
  }
  return { splat, hash };
}

export function DocsSidebarSearch() {
  const { search, setSearch, query } = useDocsSearch({ type: "fetch" });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results =
    query.data && query.data !== "empty" ? query.data : undefined;
  const showDropdown = open && search.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search docs"
          className={cn(
            "h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        />
      </div>

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-9 z-20 max-h-80 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-md">
          {query.isLoading ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              Searching…
            </div>
          ) : !results || results.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No results.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {results.map((r) => {
                const { splat, hash } = splitUrl(r.url);
                return (
                  <li key={r.id}>
                    <Link
                      to="/docs/$"
                      params={{ _splat: splat }}
                      hash={hash}
                      onClick={() => {
                        setOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "block rounded-sm px-2 py-1 text-xs",
                        "text-muted-foreground hover:bg-muted hover:text-foreground",
                        r.type === "page" && "font-medium text-foreground",
                      )}
                    >
                      {r.content}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
