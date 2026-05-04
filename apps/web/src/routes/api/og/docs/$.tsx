import { createFileRoute } from "@tanstack/react-router";
import { ImageResponse } from "@vercel/og";

import { source } from "@/lib/source";

const BACKGROUND_URL =
  "https://assets.marmot.sh/marmot-og-docs-background.png";
const FONT_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/archivo@5.2.5/files/archivo-latin-600-normal.woff";

let cachedFont: ArrayBuffer | null = null;
async function getFont(): Promise<ArrayBuffer> {
  if (cachedFont) return cachedFont;
  const res = await fetch(FONT_URL);
  cachedFont = await res.arrayBuffer();
  return cachedFont;
}

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

        const fontData = await getFont();

        const response = new ImageResponse(
          (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: "1200px",
                height: "630px",
                backgroundColor: "#0a0a0a",
                color: "white",
                padding: "64px",
                fontFamily: "Archivo, system-ui, sans-serif",
                position: "relative",
              }}
            >
              <img
                src={BACKGROUND_URL}
                width={1200}
                height={630}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  objectFit: "cover",
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  height: "100%",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    marginTop: "auto",
                    marginBottom: "auto",
                  }}
                >
                  <h1
                    style={{
                      fontSize: 56,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      margin: 0,
                    }}
                  >
                    {title}
                  </h1>
                  {description ? (
                    <p
                      style={{
                        fontSize: 26,
                        color: "#d6d3d1",
                        margin: 0,
                        maxWidth: 900,
                        fontWeight: 400,
                        lineHeight: 1.4,
                      }}
                    >
                      {description}
                    </p>
                  ) : null}
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 18, color: "#d6d3d1" }}>
                    marmot.sh
                  </span>
                </div>
              </div>
            </div>
          ),
          {
            width: 1200,
            height: 630,
            fonts: [
              {
                name: "Archivo",
                data: fontData,
                weight: 600,
                style: "normal",
              },
            ],
          },
        );

        response.headers.set(
          "Cache-Control",
          "public, s-maxage=604800, max-age=86400",
        );

        return response;
      },
    },
  },
});
