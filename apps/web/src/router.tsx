import { createRouter } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/not-found-page";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: () => <NotFoundPage />,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
