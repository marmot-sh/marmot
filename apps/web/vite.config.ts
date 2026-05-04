import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import * as MdxConfig from "./source.config";

export default defineConfig({
  ssr: {
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom/server",
        "react-dom/server.edge",
        "lucide-react",
        "fumadocs-core/source",
        "fumadocs-mdx/runtime/server",
      ],
    },
  },
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json", "../../packages/ui/tsconfig.json"],
    }),
    mdx(MdxConfig),
    tailwindcss(),
    tanstackStart({
      prerender: { enabled: true, crawlLinks: true },
      router: { routeFileIgnorePrefix: "components" },
      sitemap: { enabled: true, host: "https://marmot.sh" },
    }),
    viteReact(),
  ],
});
