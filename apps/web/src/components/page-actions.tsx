"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Sparkles,
} from "lucide-react";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";

import { Button } from "@marmot-sh/ui/shadcn/button";
import { ButtonGroup } from "@marmot-sh/ui/shadcn/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@marmot-sh/ui/shadcn/dropdown-menu";

const cache = new Map<string, string>();

export function PageActions({ markdownUrl }: { markdownUrl: string }) {
  const [isLoading, setLoading] = useState(false);

  const [checked, onCopy] = useCopyButton(async () => {
    const cached = cache.get(markdownUrl);
    if (cached) {
      await navigator.clipboard.writeText(cached);
      return;
    }

    setLoading(true);
    try {
      // Prefer the streaming `ClipboardItem` API: it lets the browser
      // initiate the copy synchronously inside the user-gesture window
      // (required by Safari) while the network fetch resolves in
      // parallel. Fall back to a plain `writeText` after fetch for
      // older browsers (or anywhere `ClipboardItem` isn't supported,
      // e.g. Firefox before 116, some embedded webviews).
      const clip = navigator.clipboard;
      if (typeof window.ClipboardItem === "function" && typeof clip.write === "function") {
        await clip.write([
          new window.ClipboardItem({
            "text/plain": fetch(markdownUrl).then(async (res) => {
              const content = await res.text();
              cache.set(markdownUrl, content);
              return content;
            }),
          }),
        ]);
      } else {
        const res = await fetch(markdownUrl);
        const content = await res.text();
        cache.set(markdownUrl, content);
        await clip.writeText(content);
      }
    } finally {
      setLoading(false);
    }
  });

  const items = useMemo(() => {
    const absolute =
      typeof window !== "undefined"
        ? new URL(markdownUrl, window.location.origin).toString()
        : markdownUrl;
    const q = `Read ${absolute}, I want to ask questions about it.`;

    return [
      {
        label: "View as Markdown",
        href: markdownUrl,
        icon: FileText,
        external: false,
      },
      {
        label: "Open in ChatGPT",
        href: `https://chatgpt.com/?${new URLSearchParams({ hints: "search", q })}`,
        icon: Sparkles,
        external: true,
      },
      {
        label: "Open in Claude",
        href: `https://claude.ai/new?${new URLSearchParams({ q })}`,
        icon: Sparkles,
        external: true,
      },
      {
        label: "Open in v0",
        href: `https://v0.dev/?${new URLSearchParams({ q })}`,
        icon: Sparkles,
        external: true,
      },
      {
        label: "Open in Scira",
        href: `https://scira.ai/?${new URLSearchParams({ q })}`,
        icon: Sparkles,
        external: true,
      },
    ];
  }, [markdownUrl]);

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={isLoading}
        onClick={onCopy}
        aria-label="Copy page as Markdown"
        className="gap-2 border-0 shadow-none"
      >
        {checked ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        Copy Page
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="More page actions"
              className="border-0 px-2 shadow-none"
            />
          }
        >
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-56">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              render={
                <a
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noreferrer noopener" : undefined}
                />
              }
            >
              <item.icon className="size-4 text-muted-foreground" />
              <span className="flex-1">{item.label}</span>
              {item.external ? (
                <ExternalLink className="size-3.5 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
