import { createFileRoute, Outlet } from "@tanstack/react-router";
import AppLayout from "@/app/layouts/AppLayout.tsx";

// Pathless layout: the settings and about pages, behind the radio.
export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function AppShell() {
  return (
    <AppLayout>
      <div className="flex h-full flex-col px-5 pt-3 pb-5">
        <Outlet />
      </div>
    </AppLayout>
  );
}
