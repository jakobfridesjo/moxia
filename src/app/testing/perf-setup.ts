// Before anything loads React, so it reports every commit.
import "@/app/testing/react-renders.ts";
import { afterEach } from "vitest";
import { cleanup } from "vitest-browser-react";
import { clearMocks } from "@tauri-apps/api/mocks";
// Unlike the tests, motion stays on: it is what is measured.
import "@/app/styles/globals.css";

afterEach(async () => {
  await cleanup();
  clearMocks();
});
