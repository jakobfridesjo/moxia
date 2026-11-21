import { afterEach } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup } from "@/shared/test/solid.ts";
// Unlike the tests, motion stays on: it is what is measured.
import "@/app/styles/globals.css";

afterEach(() => {
  cleanup();
  clearMocks();
});
