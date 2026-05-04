import { createFileRoute } from "@tanstack/react-router";
import { ImageResponse } from "workers-og";

import { source } from "@/lib/source";

const BACKGROUND_URL =
  "https://assets.marmot.sh/marmot-og-docs-background.png";
const FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/archivo@5.2.5/files/archivo-latin-600-normal.woff";

export const Route = createFileRoute("/api/og/docs/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = params._splat?.split("/") ?? [];
        const pageSlug = slugs.slice(0, -1);
        const page = source.getPage(pageSlug);

        const data = page?.data as Record<string, unknown> | undefined;
        const title =
          (data?.ogTitle as string) ??
          (data?.title as string) ??
          "marmot docs";
        const description =
          (data?.ogDescription as string) ??
          (data?.description as string) ??
          "Small, sharp CLIs for the shell.";

        const fontResponse = await fetch(FONT_URL);
        const fontData = await fontResponse.arrayBuffer();

        const html = `
          <div style="display: flex; flex-direction: column; width: 1200px; height: 630px; background-color: #ffffff; color: #0a0a0a; padding: 64px; font-family: 'Archivo', system-ui, sans-serif; position: relative;">
            <img src="${BACKGROUND_URL}" width="1200" height="630" style="position: absolute; top: 0; left: 0; object-fit: cover;" />
            <div style="display: flex; flex-direction: column; width: 100%; height: 100%; position: relative;">
              <div style="display: flex; flex-direction: column; gap: 16px; margin-top: auto; margin-bottom: auto;">
                <h1 style="font-size: 56px; font-weight: 600; letter-spacing: -0.02em; margin: 0; color: #0a0a0a;">${title}</h1>
                ${description ? `<p style="font-size: 26px; color: #525252; margin: 0; max-width: 900px; font-weight: 400; line-height: 1.4; text-wrap: balance;">${description}</p>` : ""}
              </div>
              <div style="display: flex; align-items: center;">
                <span style="font-size: 18px; color: #737373;">marmot.sh</span>
              </div>
            </div>
          </div>
        `;

        const response = new ImageResponse(html, {
          width: 1200,
          height: 630,
          format: "png",
          fonts: [
            {
              name: "Archivo",
              data: fontData,
              weight: 600,
              style: "normal",
            },
          ],
        });

        response.headers.set(
          "Cache-Control",
          "public, s-maxage=604800, max-age=86400",
        );

        return response;
      },
    },
  },
});
