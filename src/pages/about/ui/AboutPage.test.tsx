import { page as screen } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { languageAtom } from "@/shared/config/preferences.ts";
import { renderPageInRouter } from "@/shared/test/render.tsx";
import AboutPage from "@/pages/about/ui/AboutPage.tsx";

describe("AboutPage", () => {
  it("shows the version and credits the station directory and libraries", async () => {
    await renderPageInRouter(<AboutPage />);

    await expect.element(screen.getByText(/^Version \d+\.\d+\.\d+/)).toBeVisible();
    await expect.element(screen.getByText("By Jakob Fridesjö")).toBeVisible();
    await expect.element(screen.getByText("radio-browser.info")).toBeVisible();
    await expect.element(screen.getByText("MPL-2.0")).toBeVisible();

    languageAtom.set("zh-Hans");
    await expect.element(screen.getByText("致谢")).toBeVisible();
    await expect.element(screen.getByText("电台目录")).toBeVisible();
  });

  it("links to the licences page", async () => {
    const { router } = await renderPageInRouter(<AboutPage />, { initialPath: "/about" });

    await screen.getByRole("link", { name: "Show licences" }).click();

    expect(router.state.location.pathname).toBe("/about/licenses");
  });

  it("goes back to the settings", async () => {
    const { router } = await renderPageInRouter(<AboutPage />, { initialPath: "/about" });

    await screen.getByRole("button", { name: "Back" }).click();

    expect(router.state.location.pathname).toBe("/settings");
  });
});
