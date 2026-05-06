import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppHeader } from "@/components/app-header";
import { Footer } from "@/components/footer";

export const Route = createFileRoute("/_marketing")({
  component: MarketingLayout,
});

function MarketingLayout() {
  return (
    <>
      <AppHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
