import { page as screen } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { keySoundsAtom, languageAtom, shadersAtom } from "@/shared/config/preferences.ts";
import { formatInteger } from "@/shared/lib/number-format.ts";
import { renderPageInRouter } from "@/shared/test/render.tsx";
import SettingsManager from "@/pages/settings/ui/SettingsManager.tsx";

describe("SettingsManager", () => {
  it("translates the interface and formats numbers for the chosen language", async () => {
    await renderPageInRouter(() => <SettingsManager />);

    await screen.getByRole("button", { name: "Svenska" }).click();

    await expect.element(screen.getByText("Inställningar")).toBeVisible();
    await expect
      .element(screen.getByRole("group", { name: "Knappljud" }).getByRole("button", { name: "Av" }))
      .toBeVisible();
    expect(formatInteger(1234)).toBe("1\u00a0234");
    expect(localStorage.getItem("language")).toBe("sv");

    await screen.getByRole("button", { name: "中文（简体）" }).click();
    await expect.element(screen.getByText("设置")).toBeVisible();
    expect(languageAtom.get()).toBe("zh-Hans");

    await screen.getByRole("button", { name: "中文（繁體）" }).click();
    await expect.element(screen.getByText("設定", { exact: true })).toBeVisible();
    expect(languageAtom.get()).toBe("zh-Hant");
  });

  it("keeps one option chosen", async () => {
    await renderPageInRouter(() => <SettingsManager />);

    const on = screen
      .getByRole("group", { name: "Key sounds" })
      .getByRole("button", { name: "On" });
    await on.click();
    await expect.element(on).toHaveAttribute("aria-pressed", "true");
    // Pressing the chosen option again leaves it chosen.
    await on.click();
    await expect.element(on).toHaveAttribute("aria-pressed", "true");
    expect(keySoundsAtom.get()).toBe(true);
    expect(localStorage.getItem("keySounds")).toBe("true");
  });

  it("turns the shaders off", async () => {
    await renderPageInRouter(() => <SettingsManager />);

    await screen
      .getByRole("group", { name: "Shaders" })
      .getByRole("button", { name: "Off" })
      .click();

    expect(shadersAtom.get()).toBe(false);
    expect(localStorage.getItem("shaders")).toBe("false");
    await expect
      .element(screen.getByRole("group", { name: "Weather" }).getByRole("button", { name: "Off" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("group", { name: "Weather" }).getByRole("button", { name: "On" }))
      .toBeDisabled();
  });

  it("links to the about page", async () => {
    const { router } = await renderPageInRouter(() => <SettingsManager />);

    await screen.getByRole("link", { name: "About Moxia" }).click();

    expect(router.state.location.pathname).toBe("/about");
  });
});
