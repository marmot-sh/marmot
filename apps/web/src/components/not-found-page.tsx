import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@marmot-sh/ui/shadcn/button";
import { AppHeader } from "@/components/app-header";

type NotFoundMode = "site" | "docs";

export function NotFoundPage({ mode = "site" }: { mode?: NotFoundMode }) {
  const isDocs = mode === "docs";

  return (
    <>
      <AppHeader position="fixed" showSearch={isDocs} />
      <main className="relative min-h-screen overflow-hidden bg-background pt-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-14 h-px bg-border"
        />
        <section className="container mx-auto flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-6 py-12 text-center">
          <img
            src="/marmot.webp"
            width="675"
            height="800"
            alt="Marmot mascot"
            loading="eager"
            decoding="async"
            className="mb-8 h-auto w-32 select-none sm:w-40"
            draggable={false}
          />
          <h1 className="text-balance text-4xl font-[720] leading-tight text-foreground sm:text-5xl">
            Page not found.
          </h1>
          <p className="mt-4 max-w-md text-balance text-base leading-7 text-muted-foreground">
            We could not find that page. The docs are the best place to keep
            moving.
          </p>
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className={buttonVariants({
              size: "lg",
              className: "mt-7 h-11 gap-2 px-5",
            })}
          >
            Go to Docs
            <ArrowRight aria-hidden />
          </Link>
        </section>
      </main>
    </>
  );
}
