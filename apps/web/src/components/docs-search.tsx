"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useDocsSearch } from "fumadocs-core/search/client";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@marmot-sh/ui/shadcn/command";
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

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const { search, setSearch, query } = useDocsSearch({ type: "fetch" });
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const results = query.data && query.data !== "empty" ? query.data : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
        className={cn(
          "inline-flex h-9 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search docs</span>
        <kbd className="pointer-events-none ml-2 hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search docs"
        description="Search documentation pages and headings."
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search docs..."
          />
          <CommandList>
            {query.isLoading ? (
              <CommandEmpty>Searching…</CommandEmpty>
            ) : search.length === 0 ? (
              <CommandEmpty>Type to search the docs.</CommandEmpty>
            ) : results.length === 0 ? (
              <CommandEmpty>No results.</CommandEmpty>
            ) : (
              <CommandGroup>
                {results.map((r) => {
                  const { splat, hash } = splitUrl(r.url);
                  return (
                    <CommandItem
                      key={r.id}
                      value={`${r.id}-${r.content}`}
                      onSelect={() => {
                        setOpen(false);
                        setSearch("");
                        void navigate({
                          to: "/docs/$",
                          params: { _splat: splat },
                          hash,
                        });
                      }}
                      className={cn(
                        r.type !== "page" && "pl-6 text-muted-foreground",
                      )}
                    >
                      {r.content}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
