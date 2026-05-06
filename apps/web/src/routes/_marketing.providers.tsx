import type { ComponentType, SVGProps } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Brain, Database, Search } from "lucide-react";

export const Route = createFileRoute("/_marketing/providers")({
  component: Providers,
  head: () => {
    const title = "Providers — marmot";
    const description =
      "Marmot is provider-agnostic. Bring your own keys to any of the AI, search, and data providers below.";
    const canonical = "https://marmot.sh/providers";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
});

type ProviderRow = {
  name: string;
  url: string;
  /** Optional badge shown after the provider name. Used to flag the
   *  Ollama row as a local runtime that needs neither a key nor a
   *  signup. Reusable if other rows ever pick up similar metadata. */
  badge?: string;
};

const AI_PROVIDERS: readonly ProviderRow[] = [
  { name: "Anthropic", url: "https://www.anthropic.com" },
  { name: "Cloudflare Workers AI", url: "https://www.cloudflare.com" },
  {
    name: "Ollama",
    url: "https://ollama.com",
    badge: "Local · no signup",
  },
  { name: "OpenAI", url: "https://openai.com" },
  { name: "OpenRouter", url: "https://openrouter.ai" },
  { name: "Vercel AI Gateway", url: "https://vercel.com/ai-gateway" },
];

const SEARCH_PROVIDERS: readonly ProviderRow[] = [
  { name: "Brave Search", url: "https://brave.com" },
  { name: "Exa", url: "https://exa.ai" },
  { name: "Firecrawl", url: "https://firecrawl.dev" },
  { name: "Parallel", url: "https://parallel.ai" },
  { name: "Tavily", url: "https://tavily.com" },
];

const ENRICHMENT_PROVIDERS: readonly ProviderRow[] = [
  { name: "Apollo", url: "https://www.apollo.io" },
  { name: "Bouncer", url: "https://www.usebouncer.com" },
  { name: "Datagma", url: "https://datagma.com" },
  { name: "Hunter", url: "https://hunter.io" },
  { name: "Kickbox", url: "https://kickbox.com" },
  { name: "People Data Labs", url: "https://www.peopledatalabs.com" },
  { name: "Tomba", url: "https://tomba.io" },
  { name: "ZeroBounce", url: "https://www.zerobounce.net" },
];

function Providers() {
  return (
    <>
      <section className="container mx-auto px-6 pt-14 pb-12 sm:pt-20 sm:pb-14">
        <h1 className="max-w-[30ch] text-balance text-left font-sans text-[1.75rem] font-[680] leading-[1.1] tracking-[-0.02em] text-foreground sm:mx-auto sm:text-center sm:leading-[1.05] sm:text-[2.25rem] lg:text-[2.75rem]">
          Pick a provider. Any provider.
        </h1>
        <p className="mt-4 max-w-[58ch] text-left text-base leading-[1.55] text-muted-foreground sm:mx-auto sm:text-center sm:text-lg">
          Marmot is provider-agnostic and BYOK.
          <br />
          Set a default, pass in a flag, or configure presets.
        </p>
      </section>

      <ProviderTable title="AI" Icon={Brain} rows={AI_PROVIDERS} />
      <ProviderTable title="Search" Icon={Search} rows={SEARCH_PROVIDERS} />
      <ProviderTable
        title="Enrichment"
        Icon={Database}
        rows={ENRICHMENT_PROVIDERS}
      />

      <section className="container mx-auto px-6 pt-12 pb-24 sm:pt-16 sm:pb-32">
        <p className="mx-auto max-w-[60ch] text-center text-sm text-muted-foreground">
          See{" "}
          <a
            href="/docs/reference/providers"
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground"
          >
            providers reference
          </a>{" "}
          for more details.
        </p>
      </section>
    </>
  );
}

function ProviderTable({
  title,
  Icon,
  rows,
}: {
  title: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  rows: readonly ProviderRow[];
}) {
  return (
    <section className="py-8 sm:py-10">
      <div className="container mx-auto max-w-3xl px-6">
        <h2 className="mb-6 flex items-center gap-2.5 text-[1.0625rem] font-[640] tracking-[-0.01em] text-foreground sm:mb-7 sm:text-[1.25rem]">
          <Icon
            className="h-[18px] w-[18px] text-muted-foreground"
            aria-hidden
            strokeWidth={1.75}
          />
          {title}
        </h2>
        <div className="border-t border-border">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center gap-4 border-b border-border py-2.5 text-[14px] sm:gap-6 sm:py-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-foreground">{row.name}</span>
                {row.badge ? (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-[0.1rem] text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    {row.badge}
                  </span>
                ) : null}
              </div>
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {row.url.replace(/^https?:\/\/(www\.)?/, "")}
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
