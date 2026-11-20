import { beforeEach, describe, expect, it, vi } from "vitest";
import { toastError } from "@/shared/lib/toast.ts";

const sonner = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => sonner);

const STICKY = { duration: Number.POSITIVE_INFINITY };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toastError", () => {
  it("stays up until dismissed", () => {
    toastError("Save failed");

    expect(sonner.toast.error).toHaveBeenCalledWith("Save failed", STICKY);
  });

  it("keeps the caller's id and description", () => {
    toastError("Save failed", { id: "save", description: "Try again" });

    expect(sonner.toast.error).toHaveBeenCalledWith("Save failed", {
      ...STICKY,
      id: "save",
      description: "Try again",
    });
  });
});
