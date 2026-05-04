import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { NotFoundPage } from "@/components/not-found-page";
import "@fontsource-variable/archivo";
import "@fontsource-variable/geist-mono";
import appCss from "../styles.css?url";

const themeBootstrap = `(function(){
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored == null && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "marmot.sh" },
      { name: "description", content: "Small, sharp CLIs for the shell." },
      { property: "og:site_name", content: "marmot.sh" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },
      { property: "og:title", content: "marmot — shell-native AI and web data" },
      {
        property: "og:description",
        content: "Small, sharp CLIs for the shell.",
      },
      { property: "og:url", content: "https://marmot.sh" },
      {
        property: "og:image",
        content: "https://assets.marmot.sh/marmot-og-default.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "marmot — shell-native AI and web data" },
      {
        name: "twitter:description",
        content: "Small, sharp CLIs for the shell.",
      },
      {
        name: "twitter:image",
        content: "https://assets.marmot.sh/marmot-og-default.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/marmot.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico", sizes: "any" },
    ],
    scripts: [{ children: themeBootstrap }],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
});

function NotFound() {
  return <NotFoundPage />;
}

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider search={{ enabled: false }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
