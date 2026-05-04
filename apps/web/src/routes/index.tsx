import React, { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bookmark,
  Check,
  Code2,
  Copy,
  Database,
  MessagesSquare,
  ScrollText,
  Star,
} from "lucide-react";

import { buttonVariants } from "@marmot-sh/ui/shadcn/button";
import { AppHeader } from "@/components/app-header";
import { Logo } from "@/components/logo";
import {
  ClaudeAI,
  Cursor,
  Hermes,
  OpenAI,
  OpenClaw,
  OpenCode,
} from "@/components/logos";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => {
    const title = "marmot — shell-native AI and web data";
    const description =
      "Marmot is one CLI for AI generation, web research, scraping, and data enrichment, with consistent flags and JSON output across providers.";
    const canonical = "https://marmot.sh/";
    const ogImage = "https://assets.marmot.sh/marmot-og-default.png";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonical },
        { property: "og:image", content: ogImage },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: ogImage },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
});

function Landing() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <Hero />
        <Workflows />
        <BuiltForAgents />
        <WhatsInTheBox />
        <FinalCta />
        <Footer />
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  shared code styling                                                       */
/* -------------------------------------------------------------------------- */

/** From `sm` up — taller CTAs with extra horizontal padding and type size.
 *  Below `sm`, plain `size: "default"` from `buttonVariants` is used. */
const CTA_SIZE_SM_UP = "sm:h-12 sm:gap-2 sm:px-7 sm:text-[15px]";

/* dark-mode terminal palette — fixed regardless of theme */
const D = {
  prompt: "text-[oklch(76%_0.18_50)]",
  cmd: "text-[oklch(97%_0.008_75)]",
  flag: "text-[oklch(82%_0.15_60)]",
  str: "text-[oklch(88%_0.09_85)]",
  out: "text-[oklch(90%_0.01_75)]",
  comment: "text-[oklch(64%_0.014_60)]",
  dim: "text-[oklch(54%_0.01_60)]",
};

/** Dark-mode gunmetal bezel + face shared by hero terminal, workflow snippets,
 *  and copyable terminals. Softer top/right catch-lights than pure white. */
const METAL_BEZEL_DARK =
  "dark:bg-gradient-to-tr dark:from-stone-900 dark:to-stone-700 ";

const METAL_FACE_DARK =
  "dark:bg-[linear-gradient(to_bottom,oklch(26%_0.005_42),oklch(19%_0.005_42))] " +
  "dark:shadow-[0_3px_6px_-1px_rgba(0,0,0,0.55),0_10px_20px_-6px_rgba(0,0,0,0.38),inset_0_1px_0_0_rgba(205,203,200,0.12),inset_-1px_0_0_0_rgba(188,186,183,0.08),inset_0_-1px_0_0_rgba(0,0,0,0.74),inset_1px_0_0_0_rgba(0,0,0,0.52)] ";

const METAL_TITLEBAR_INSET_DARK =
  "dark:shadow-[inset_0_1px_0_0_rgba(205,203,200,0.12),inset_-1px_0_0_0_rgba(188,186,183,0.08),inset_1px_0_0_0_rgba(0,0,0,0.52)]";

/** Light-mode flat fills only — warmer + a touch lighter than stone-950/900. */
const TERMINAL_FACE_LIGHT = "bg-[oklch(29%_0.016_58)] ";
const TERMINAL_TITLEBAR_LIGHT = "bg-[oklch(23%_0.013_56)] ";

function Terminal({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        // Outer bezel wrapper. Dark mode: a 2px ring with a diagonal
        // dark→light gradient that catches the eye like a brushed-metal
        // frame around the terminal. Light mode: transparent — the surface
        // already reads cleanly against the page without the ring.
        "rounded-[12px] p-px " +
        METAL_BEZEL_DARK +
        className
      }
    >
      <div
        className={
          "overflow-hidden rounded-[10px] text-[oklch(94%_0.005_60)] " +
          TERMINAL_FACE_LIGHT +
          METAL_FACE_DARK
        }
      >
        <div
          className={
            "relative flex h-9 items-center px-3.5 dark:rounded-t-[8px] " +
            TERMINAL_TITLEBAR_LIGHT +
            "dark:bg-[oklch(30%_0.006_42)] " +
            METAL_TITLEBAR_INSET_DARK
          }
        >
          <div className="flex items-center gap-[7px]">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          {title && (
            <span className="absolute inset-x-0 text-center font-mono text-[11px] font-medium text-[oklch(60%_0.01_252)]">
              {title}
            </span>
          )}
        </div>
        <div className="px-4 py-5 sm:px-6 sm:py-6">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  hero                                                                      */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="container mx-auto px-6 overflow-x-clip pt-10 pb-12 sm:pt-14 sm:pb-16 lg:pt-16">
      <div className="mb-6 flex justify-start sm:justify-center">
        <a
          href="https://github.com/marmot-sh/marmot"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Code2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>Open source · MIT</span>
          <ArrowRight className="h-3 w-3" aria-hidden />
        </a>
      </div>
      <h1 className="max-w-[30ch] text-balance text-left font-sans text-[1.75rem] font-[680] leading-[1.1] tracking-[-0.02em] text-foreground sm:mx-auto sm:text-center sm:leading-[1.05] sm:text-[2.25rem] lg:text-[2.75rem]">
        One CLI for AI and external context
      </h1>
      <p className="mt-4 max-w-[58ch] text-balance text-left text-base leading-[1.55] text-muted-foreground sm:mx-auto sm:text-center sm:text-lg">
        Let your agents access models, web search, and enrichment data without
        bloating context — multiple providers, one interface.
      </p>

      <div className="relative mt-12 mx-auto max-w-2xl">
        {/* Dark mode: warm radial glow behind dots; 2:1 ellipse (rx = 2·ry in a
            square box), centered on the terminal, fading to transparent. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-32 -inset-y-20 -z-20 hidden dark:block sm:-inset-x-40 sm:-inset-y-24 lg:-inset-x-56"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 70% 35% at 50% 44%, oklch(0.5 0.12 41 / 0.56), oklch(0.45 0.08 41 / 0.2) 38%, transparent 72%)",
          }}
        />
        {/* Dot-grid backdrop: 12px lattice of foreground/50 dots that radiate
            outward from the terminal and fade to transparent at the edges via
            a radial mask. Negative insets extend the lattice beyond the
            terminal so the fade has room to breathe; pointer-events disabled
            so the dots never block hover/click. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-32 -inset-y-20 -z-10 text-foreground/50 sm:-inset-x-40 sm:-inset-y-24 lg:-inset-x-56"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "12px 12px",
            maskImage:
              "radial-gradient(ellipse 55% 60% at center, black 30%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 55% 60% at center, black 30%, transparent 80%)",
          }}
        />
        <Terminal title="zsh - ~/marmot">
          <pre className="overflow-x-auto font-mono text-sm leading-[1.85] sm:text-[13.5px]">
            <span className={D.comment}># Install</span>
            {"\n"}
            <span className={D.prompt}>$</span>{" "}
            <span className={D.cmd}>npm i -g marmot-sh</span>
            {"\n\n"}
            <span className={D.comment}># Generate text</span>
            {"\n"}
            <span className={D.prompt}>$</span>{" "}
            <span className={D.cmd}>marmot </span>
            <span className={D.str}>&apos;tell me a joke&apos;</span>
            {"\n\n"}
            <span className={D.comment}># Search the web, then summarize</span>
            {"\n"}
            <span className={D.prompt}>$</span>{" "}
            <span className={D.cmd}>marmot search </span>
            <span className={D.str}>&apos;news about apple&apos;</span>{" "}
            <span className={D.dim}>\</span>
            {"\n  "}
            <span className={D.dim}>| </span>
            <span className={D.cmd}>marmot </span>
            <span className={D.str}>&apos;summarize&apos;</span>
          </pre>
        </Terminal>

        <img
          src="/marmot.webp"
          alt=""
          aria-hidden
          draggable={false}
          loading="eager"
          className="pointer-events-none absolute right-0 bottom-0 h-[46%] w-auto translate-x-[40px] translate-y-[12px] select-none sm:h-[60%] sm:translate-x-[34px] sm:translate-y-[24px] md:h-[75%] md:translate-x-[50px] md:translate-y-[40px]"
        />
      </div>

      <div className="mt-12 flex flex-row items-center justify-center gap-3">
        <Link
          to="/docs/$"
          params={{ _splat: "quickstart" }}
          className={buttonVariants({ size: "default", className: CTA_SIZE_SM_UP })}
        >
          Quick start
          <ArrowRight aria-hidden />
        </Link>
        <a
          href="https://github.com/marmot-sh/marmot"
          className={buttonVariants({
            variant: "secondary",
            size: "default",
            className: CTA_SIZE_SM_UP,
          })}
        >
          <Star aria-hidden />
          Star on GitHub
        </a>
      </div>

    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  workflows                                                                 */
/* -------------------------------------------------------------------------- */

type ExampleProps = {
  eyebrow: string;
  title: string;
  body: string;
  command: React.ReactNode;
  /** Tailwind classes applied to the outer card container. Used by the
   *  Workflows section to alternate `bg-background` and `bg-muted` plus the
   *  shared `rounded-2xl` shape — but kept generic so any caller can style. */
  className?: string;
  /** When true, wrap the inner code block in a 2px metal-bezel ring (light
   *  mode shows a brushed-metal gradient frame; dark mode keeps the body's
   *  black-metal insets). Used to opt cards in one at a time as we roll the
   *  treatment out. */
  withBezel?: boolean;
};

function Example({
  eyebrow,
  title,
  body,
  command,
  className = "",
  withBezel = false,
}: ExampleProps) {
  return (
    <div
      className={
        // `group` lets the title react to the card's hover state. `relative`
        // + `hover:z-10` lifts the hovered card above its neighbors so the
        // (overlapping, -space-y-px) borders + the shadow read on top, not
        // tucked beneath the next card. Smooth transitions on shadow/colour.
        "group relative min-w-0 p-4 transition-shadow duration-200 hover:z-10 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.18)] sm:p-10 lg:p-12 " +
        className
      }
    >
      <div className="grid min-w-0 items-center gap-8 lg:grid-cols-[1fr_auto] lg:gap-12">
        <div className="flex min-w-0 flex-col items-start gap-3">
          <span className="font-mono text-[11px] font-[600] uppercase tracking-[0.2em] text-primary">
            {eyebrow}
          </span>
          <h3 className="text-balance text-[1.375rem] font-[680] leading-[1.1] tracking-[-0.015em] text-foreground transition-colors duration-200 group-hover:text-primary sm:text-[1.625rem]">
            {title}
          </h3>
          <p className="max-w-[48ch] text-balance text-[15px] leading-[1.6] text-muted-foreground">
            {body}
          </p>
        </div>

        <div className="hide-scrollbar min-w-0 w-full max-sm:overflow-x-auto sm:overflow-x-visible">
          <div className="w-full max-sm:min-w-full max-sm:w-max">
            {withBezel ? (
              <div className={"min-w-0 rounded-[12px] p-px " + METAL_BEZEL_DARK}>
                <CodeBlock command={command} metal />
              </div>
            ) : (
              <CodeBlock command={command} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inner dark code surface used by Example. `metal` enables the full
 *  gunmetal dark-mode treatment — same as the hero `Terminal` body. */
function CodeBlock({
  command,
  metal = false,
}: {
  command: React.ReactNode;
  metal?: boolean;
}) {
  const dark = metal
    ? METAL_FACE_DARK
    : "dark:bg-none dark:bg-[oklch(15%_0.005_42)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),inset_-1px_0_0_0_rgba(255,255,255,0.06),inset_0_-1px_0_0_rgba(0,0,0,0.5),inset_1px_0_0_0_rgba(0,0,0,0.35)]";

  return (
    <div
      className={
        "rounded-[10px] px-3.5 py-4 text-[oklch(94%_0.005_60)] sm:px-6 sm:py-6 " +
        TERMINAL_FACE_LIGHT +
        dark
      }
    >
      <pre className="max-sm:overflow-x-visible font-mono text-[13px] leading-[1.75] sm:overflow-x-auto sm:text-[12.5px] sm:leading-[1.75] md:text-[13px]">
        {command}
      </pre>
    </div>
  );
}

function Workflows() {
  return (
    <section className="bg-muted/50 py-12 sm:py-16">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-[1.75rem] font-[680] leading-[1.15] tracking-[-0.015em] text-foreground sm:text-[2.25rem]">
            What you can do with Marmot...
          </h2>
          <p className="mx-auto mt-4 max-w-[58ch] text-balance text-base leading-[1.55] text-muted-foreground sm:text-lg">
            Compose agentic workflows from the shell. Keep your main agent's
            context for the work that matters.
          </p>
        </div>

        <div className="mx-auto mt-10 flex max-w-4xl flex-col gap-5 sm:mt-12 sm:gap-0 sm:-space-y-px">
        <Example
          className="rounded-2xl border border-border bg-background lg:-translate-x-5"
          eyebrow="/ 01"
          withBezel
          title="Triage your inbox."
          body="Pull a day of mail, hand it to a fast model, surface what actually needs you today."
          command={
            <>
              <span className={D.prompt}>$</span>{" "}
              <span className={D.cmd}>gog gmail search </span>
              <span className={D.str}>&apos;newer_than:1d&apos;</span>{" "}
              <span className={D.dim}>\</span>
              {"\n  "}
              <span className={D.dim}>| </span>
              <span className={D.cmd}>marmot </span>
              <span className={D.str}>
                &apos;summarize today&apos;s email&apos;
              </span>
            </>
          }
        />

        <Example
          className="rounded-2xl border border-border bg-muted lg:translate-x-5"
          eyebrow="/ 02"
          withBezel
          title="Brief any topic."
          body="Search the web and let a cheap model boil the result down to five bullets."
          command={
            <>
              <span className={D.prompt}>$</span>{" "}
              <span className={D.cmd}>marmot search </span>
              <span className={D.str}>&apos;news about apple&apos;</span>{" "}
              <span className={D.dim}>\</span>
              {"\n  "}
              <span className={D.dim}>| </span>
              <span className={D.cmd}>marmot </span>
              <span className={D.str}>
                &apos;give me 5 bullet highlights&apos;
              </span>
            </>
          }
        />

        <Example
          className="rounded-2xl border border-border bg-background lg:-translate-x-5"
          eyebrow="/ 03"
          withBezel
          title="Run your GTM ops."
          body="Look up a contact, verify the email, draft the intro — one pipe per concern."
          command={
            <>
              <span className={D.prompt}>$</span>{" "}
              <span className={D.cmd}>marmot enrich </span>
              <span className={D.flag}>--type</span>
              <span className={D.cmd}> person </span>
              <span className={D.flag}>--email</span>{" "}
              <span className={D.str}>ada@lovelace.io</span>{" "}
              <span className={D.dim}>\</span>
              {"\n  "}
              <span className={D.dim}>| </span>
              <span className={D.cmd}>marmot </span>
              <span className={D.str}>
                &apos;draft a personalized 3-line intro email&apos;
              </span>
            </>
          }
        />

        <Example
          className="rounded-2xl border border-border bg-muted lg:translate-x-5"
          eyebrow="/ 04"
          withBezel
          title="Drop into your CI/CD."
          body="Generate commit messages, PR descriptions, and release notes — anywhere `node` runs."
          command={
            <>
              <span className={D.prompt}>$</span>{" "}
              <span className={D.cmd}>gh pr diff </span>
              <span className={D.str}>$PR</span>{" "}
              <span className={D.dim}>\</span>
              {"\n  "}
              <span className={D.dim}>| </span>
              <span className={D.cmd}>marmot </span>
              <span className={D.str}>
                &apos;write a 3-bullet PR description&apos;
              </span>
            </>
          }
        />
      </div>

        <div className="mt-10 flex justify-center sm:mt-12">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className={buttonVariants({ size: "default", className: CTA_SIZE_SM_UP })}
          >
            Read the docs
            <ArrowRight aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}


/* -------------------------------------------------------------------------- */
/*  copyable terminal                                                         */
/* -------------------------------------------------------------------------- */

/** Dark code block with a tiny copy button anchored top-right. Pass the raw
 *  text to copy via `command` (clipboard payload — no ANSI/JSX) and the
 *  styled JSX as children. After a successful copy the icon swaps to a
 *  checkmark for ~1.5s. Used by the closing CTAs that are designed to be
 *  literally pasted into a terminal. */
function CopyableTerminal({
  command,
  children,
  className = "",
  withShadow = true,
  withBezel = false,
  preClassName = "",
}: {
  command: string;
  children: React.ReactNode;
  className?: string;
  withShadow?: boolean;
  withBezel?: boolean;
  preClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Swallow — clipboard can fail in restricted contexts (sandbox, http).
    }
  };

  // `withShadow` reserved for future use; metal styling matches hero + Workflows.
  void withShadow;

  const inner = (
    <div
      className={
        "relative rounded-[10px] px-5 py-5 text-[oklch(94%_0.005_60)] sm:px-6 sm:py-6 " +
        TERMINAL_FACE_LIGHT +
        METAL_FACE_DARK +
        (withBezel ? "" : className)
      }
    >
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      <pre
        className={
          "overflow-x-auto pr-8 font-mono text-sm leading-[1.85] sm:text-[14px] " +
          preClassName
        }
      >
        {children}
      </pre>
    </div>
  );

  if (!withBezel) return inner;

  return (
    <div
      className={"rounded-[12px] p-px " + METAL_BEZEL_DARK + className}
    >
      {inner}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  built for agents                                                          */
/* -------------------------------------------------------------------------- */

const AGENTS: Array<{
  name: string;
  Logo: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { name: "OpenClaw", Logo: OpenClaw },
  { name: "Hermes-Agent", Logo: Hermes },
  { name: "Claude Code", Logo: ClaudeAI },
  { name: "Codex", Logo: OpenAI },
  { name: "Cursor", Logo: Cursor },
  { name: "OpenCode", Logo: OpenCode },
];

/** Third major section. Heading + subline up top, then a flex row with the
 *  agent-skill install command on the left and the marmot-rack illustration
 *  on the right. Mobile stacks vertically. */
function BuiltForAgents() {
  return (
    <section className="container mx-auto px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-balance text-[1.75rem] font-[680] leading-[1.15] tracking-[-0.015em] text-foreground sm:text-[2.25rem]">
          Built for agents.
        </h2>
        <p className="mx-auto mt-4 max-w-[58ch] text-balance text-base leading-[1.55] text-muted-foreground sm:text-lg">
          Only one skill, and your agent can access many models, search, and
          data providers.
        </p>
      </div>

      <div
        aria-label="Supported agents"
        className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 sm:mt-10 sm:gap-x-9"
      >
        {AGENTS.map((agent) => (
          <agent.Logo
            key={agent.name}
            aria-label={agent.name}
            role="img"
            className={
              agent.name === "OpenClaw"
                ? "h-7 w-7 origin-center text-muted-foreground motion-safe:animate-wiggle"
                : "h-7 w-7 text-muted-foreground"
            }
          />
        ))}
      </div>

      <CopyableTerminal
        className="mx-auto mt-8 w-fit max-w-full sm:mt-10"
        withBezel
        command="npx skills add https://github.com/marmot-sh/marmot --skill marmot"
      >
        <span className={D.prompt}>$</span>{" "}
        <span className={D.cmd}>npx skills add </span>
        <span className={D.str}>https://github.com/marmot-sh/marmot</span>{" "}
        <span className={D.flag}>--skill</span>
        <span className={D.cmd}> marmot</span>
      </CopyableTerminal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  what's in the box                                                         */
/* -------------------------------------------------------------------------- */

type FeatureTile = {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  /** Two-stop gradient applied to the icon chip background. Hues shift 10–25°
   *  between stops so each chip reads as one color with depth, not as a
   *  rainbow. White icon glyph sits on top. */
  gradient: string;
};

const FEATURE_TILES: FeatureTile[] = [
  {
    icon: Bookmark,
    title: "Presets",
    description: "Save the flag bundles you reach for. Run them with --preset or @name.",
    // Brand orange — saturated, the anchor of the family.
    gradient:
      "linear-gradient(135deg, oklch(64% 0.22 41), oklch(58% 0.21 25))",
  },
  {
    icon: Database,
    title: "Caching",
    description: "Skip duplicate calls. Cached responses return instantly, free.",
    // Amber — lighter, leans yellow.
    gradient:
      "linear-gradient(135deg, oklch(72% 0.18 70), oklch(66% 0.18 55))",
  },
  {
    icon: ScrollText,
    title: "Sessions",
    description: "Track logs and messages across calls. Off by default.",
    // Burnt copper — deeper, leans red.
    gradient:
      "linear-gradient(135deg, oklch(54% 0.16 35), oklch(48% 0.15 25))",
  },
  {
    icon: MessagesSquare,
    title: "Chat mode",
    description: "Build context turn by turn. Compact when it gets long.",
    // Terracotta — softer, dustier mid-tone.
    gradient:
      "linear-gradient(135deg, oklch(60% 0.14 50), oklch(55% 0.13 40))",
  },
];

function WhatsInTheBox() {
  return (
    <section className="bg-muted/50 py-12 sm:py-16">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-[1.75rem] font-[680] leading-[1.15] tracking-[-0.015em] text-foreground sm:text-[2.25rem]">
            What's in the box.
          </h2>
        </div>

        <div className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-4 sm:gap-5">
          {FEATURE_TILES.map((tile) => (
            <div
              key={tile.title}
              className="border border-dashed border-border bg-muted p-5 sm:p-6"
            >
              <div
                aria-hidden
                className="flex h-10 w-10 items-center justify-center rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.06)]"
                style={{ background: tile.gradient }}
              >
                <tile.icon className="h-5 w-5 text-white" aria-hidden />
              </div>
              <h3 className="mt-4 text-[1rem] font-semibold leading-[1.3] tracking-[-0.005em] text-foreground">
                {tile.title}
              </h3>
              <p className="mt-1.5 text-balance text-sm leading-[1.6] text-muted-foreground">
                {tile.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  final cta                                                                 */
/* -------------------------------------------------------------------------- */

/** Closing CTA — large headline + a centered, shadow-less, w-fit terminal
 *  block with the two-line install + setup recipe. */
function FinalCta() {
  return (
    <section className="container mx-auto overflow-x-clip px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-balance text-center text-[2rem] font-[680] leading-[1.1] tracking-[-0.025em] text-foreground sm:leading-[1.05] sm:text-[2.75rem] lg:text-[3.25rem]">
          Try Marmot now.
        </h2>
      </div>

      <div className="relative mx-auto mt-8 w-fit max-w-full sm:mt-10">
        {/* Same dark-mode glow + dot lattice as hero; tighter ellipse (50% radii)
            for the smaller terminal. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-32 -inset-y-20 -z-20 hidden dark:block sm:-inset-x-40 sm:-inset-y-24 lg:-inset-x-56"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 35% 17.5% at 50% 44%, oklch(0.5 0.12 41 / 0.56), oklch(0.45 0.08 41 / 0.2) 38%, transparent 72%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-32 -inset-y-20 -z-10 text-foreground/50 sm:-inset-x-40 sm:-inset-y-24 lg:-inset-x-56"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "12px 12px",
            maskImage:
              "radial-gradient(ellipse 55% 60% at center, black 30%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 55% 60% at center, black 30%, transparent 80%)",
          }}
        />
        <CopyableTerminal
          className="relative z-0"
          withShadow={false}
          withBezel
          command={"npm install -g marmot-sh\nmarmot setup"}
          preClassName="leading-[1.95] sm:text-[14.5px]"
        >
          <span className={D.prompt}>$</span>{" "}
          <span className={D.cmd}>npm install -g marmot-sh</span>
          {"\n"}
          <span className={D.prompt}>$</span>{" "}
          <span className={D.cmd}>marmot setup</span>
        </CopyableTerminal>
      </div>

      <div className="mt-6 flex justify-center sm:mt-8">
        <Link
          to="/docs/$"
          params={{ _splat: "quickstart" }}
          className={buttonVariants({ size: "default", className: CTA_SIZE_SM_UP })}
        >
          Quick start
          <ArrowRight aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  footer                                                                    */
/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="bg-muted">
      <div className="container mx-auto flex flex-col items-start gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-12">
        <Logo />
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[13px]"
        >
          <FooterLink to="/docs/$" splat="">
            Docs
          </FooterLink>
          <FooterLink to="/docs/$" splat="quickstart">
            Quick start
          </FooterLink>
          <FooterLink to="/docs/$" splat="installation">
            Installation
          </FooterLink>
          <FooterLink href="https://github.com/marmot-sh/marmot">
            GitHub
          </FooterLink>
        </nav>
      </div>
    </footer>
  );
}

function FooterLink({
  to,
  splat,
  href,
  children,
}: {
  to?: "/docs/$";
  splat?: string;
  href?: string;
  children: React.ReactNode;
}) {
  const className =
    "text-muted-foreground transition-colors hover:text-foreground";
  if (to)
    return (
      <Link to={to} params={{ _splat: splat ?? "" }} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
