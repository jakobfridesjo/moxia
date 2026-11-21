import { page as screen } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { renderPage } from "@/shared/test/render.tsx";
import { CategorySeal } from "@/pages/radio/ui/CategorySeal.tsx";
import { SealInk } from "@/pages/radio/ui/Seal.tsx";

const renderSeal = (onPick: () => void) =>
  renderPage(() => (
    <>
      <SealInk />
      <CategorySeal category="music" onPick={onPick} />
    </>
  ));

describe("CategorySeal", () => {
  it("turns to the next category when pressed", async () => {
    const onPick = vi.fn();
    renderSeal(onPick);
    await screen.getByRole("button", { name: "Category: Music. Press for the next, News" }).click();
    expect(onPick).toHaveBeenCalledWith("news");
  });

  it("goes straight to a category beside it", async () => {
    const onPick = vi.fn();
    renderSeal(onPick);
    await screen.getByRole("button", { name: "All stations" }).click();
    expect(onPick).toHaveBeenCalledWith("all");
  });
});
