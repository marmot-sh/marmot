"use client";

import type * as PageTree from "fumadocs-core/page-tree";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const baseUrl = "/docs";

function urlToSplat(url: string): string {
  if (url === baseUrl || url === `${baseUrl}/`) return "";
  const prefix = `${baseUrl}/`;
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  return url.replace(/^\//, "");
}

function isExternal(item: PageTree.Item) {
  return Boolean(
    item.external ||
      item.url.startsWith("http://") ||
      item.url.startsWith("https://"),
  );
}

function DocNavLink({ item }: { item: PageTree.Item }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active =
    pathname === item.url ||
    (item.url !== baseUrl && pathname.startsWith(`${item.url}/`));

  const className = cn(
    "block w-fit rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
    active
      ? "bg-muted font-bold text-foreground"
      : "text-foreground/90 hover:bg-muted/60 hover:text-foreground",
  );

  if (isExternal(item)) {
    return (
      <a href={item.url} className={className}>
        {item.name}
      </a>
    );
  }

  return (
    <Link
      to="/docs/$"
      params={{ _splat: urlToSplat(item.url) }}
      className={className}
    >
      {item.name}
    </Link>
  );
}

function NavNodes({
  nodes,
  depth = 0,
}: {
  nodes: PageTree.Node[];
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node, i) => {
        const key =
          "$id" in node && node.$id != null ? node.$id : `${depth}-${i}`;

        if (node.type === "separator") {
          return <li key={key} className="my-3 list-none" aria-hidden />;
        }

        if (node.type === "page") {
          return (
            <li key={key} className="list-none">
              <DocNavLink item={node} />
            </li>
          );
        }

        /* folder */
        return (
          <li key={key} className="list-none">
            {node.index ? (
              <DocNavLink item={node.index} />
            ) : (
              <div className="mt-8 mb-1.5 px-3 text-xs font-medium text-muted-foreground">
                {node.name}
              </div>
            )}
            <NavNodes nodes={node.children} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
}

export function DocsSidebarNav({ root }: { root: PageTree.Root }) {
  return (
    <nav aria-label="Documentation" className="text-xs">
      <NavNodes nodes={root.children} />
    </nav>
  );
}
