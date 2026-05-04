import { createContext, useContext } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { TreeContextProvider } from "fumadocs-ui/contexts/tree";
import { TOC, TOCProvider } from "fumadocs-ui/layouts/docs/page/slots/toc";
import { PageLastUpdate } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import browserCollections from "fumadocs-mdx:collections/browser";

import { AppHeader } from "@/components/app-header";
import { DocsSidebarNav } from "@/components/docs-sidebar-nav";
import { NotFoundPage } from "@/components/not-found-page";
import { PageActions } from "@/components/page-actions";
import { source } from "@/lib/source";

const ArticleContext = createContext<{ markdownUrl: string }>({
  markdownUrl: "",
});

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: slugs });
    await clientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData, params }) => {
    const slug = params._splat ?? "";
    const ogImage = `https://marmot.sh/api/og/docs/${slug ? `${slug}/` : ""}image.png`;
    const canonical = `https://marmot.sh/docs/${slug}`;
    const title = loaderData?.title
      ? `${loaderData.title} — marmot`
      : "marmot — docs";
    const description =
      loaderData?.description ?? "One CLI for AI, search, and data lookup.";
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
  notFoundComponent: () => <NotFoundPage mode="docs" />,
});

const serverLoader = createServerFn({ method: "GET" })
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    const pageTree = await source.serializePageTree(source.getPageTree());

    return {
      path: page.path,
      url: page.url,
      pageTree,
      title: page.data.title,
      description: page.data.description,
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component({ toc, frontmatter, default: MDX, lastModified }) {
    const title = frontmatter.title as string;
    const description = frontmatter.description as string | undefined;
    const { markdownUrl } = useContext(ArticleContext);

    return (
      <TOCProvider toc={toc}>
        <div className="[--fd-docs-row-1:3.5rem] [--fd-docs-height:100dvh] [--fd-toc-width:220px]">
          <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_var(--fd-toc-width)] xl:grid-rows-[auto] xl:gap-10 xl:[grid-template-areas:'main_toc']">
            <article className="min-w-0 max-w-5xl py-8 lg:py-10 xl:[grid-area:main]">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-[1.75em] font-semibold tracking-tight">
                  {title}
                </h1>
                {markdownUrl ? (
                  <div className="shrink-0">
                    <PageActions markdownUrl={markdownUrl} />
                  </div>
                ) : null}
              </div>
              {description ? (
                <p className="mt-4 mb-2 text-base text-muted-foreground">
                  {description}
                </p>
              ) : null}
              {lastModified ? (
                <PageLastUpdate
                  date={lastModified as Date}
                  className="mb-10 text-xs text-muted-foreground font-normal"
                />
              ) : (
                <div className="mb-10" />
              )}
              <div className="prose prose-neutral max-w-none dark:prose-invert prose-a:text-primary prose-a:no-underline hover:prose-a:no-underline [&_:is(h1,h2,h3,h4,h5,h6)_a]:text-foreground [&_:is(h1,h2,h3,h4,h5,h6)_a]:no-underline">
                <MDX components={{ ...defaultMdxComponents }} />
              </div>
            </article>
            <TOC />
          </div>
        </div>
      </TOCProvider>
    );
  },
});

function Page() {
  const data = Route.useLoaderData();
  const { pageTree } = useFumadocsLoader(data);
  const Content = clientLoader.getComponent(data.path) as unknown as React.FC;
  const markdownUrl = `/llms.mdx${data.url}`;

  return (
    <TreeContextProvider tree={pageTree}>
      <ArticleContext.Provider value={{ markdownUrl }}>
        <AppHeader
          position="fixed"
          showSearch
          mobileSidebar={<DocsSidebarNav root={pageTree} />}
        />
        <div className="flex min-h-screen flex-1 flex-col pt-14 md:flex-row">
          <aside className="hidden shrink-0 bg-background md:sticky md:top-14 md:block md:h-[calc(100dvh-3.5rem)] md:w-64 md:overflow-y-auto md:pr-8 lg:px-4 lg:py-8 lg:pr-8 xl:pl-8 xl:pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <DocsSidebarNav root={pageTree} />
          </aside>
          <main className="min-w-0 flex-1 px-4 sm:px-6 lg:px-8 xl:pr-10">
            <Content />
          </main>
        </div>
      </ArticleContext.Provider>
    </TreeContextProvider>
  );
}
