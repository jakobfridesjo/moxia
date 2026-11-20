import { createFileRoute } from "@tanstack/react-router";
import RadioManager from "@/pages/radio/ui/RadioManager.tsx";

// The radio fills the window on its own, outside the shell of the settings pages.
export const Route = createFileRoute("/")({
  component: RadioManager,
});
