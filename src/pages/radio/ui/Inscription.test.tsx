import { describe, expect, it } from "vitest";
import type { Station } from "@/shared/api/commands.ts";
import { renderPage } from "@/shared/test/render.tsx";
import { Inscription } from "@/pages/radio/ui/Inscription.tsx";

const station = (name: string, countryCode: Station["countryCode"] = "CN") =>
  ({ name, countryCode }) as Station;

const NAMES = [
  "雨声",
  "酒泉综合广播 FM101.5",
  "CGTN TV audio 伴音",
  "城阳综合广播 青岛广播爱车九四〇城阳综合广播 青岛广播爱车九四〇",
];

describe("Inscription", () => {
  it("keeps the seal and the name's first column in place for every station", async () => {
    const view = await renderPage(<Inscription title="" station={null} recordedAt={null} />);
    const places = [];
    const widths = [];
    for (const name of NAMES) {
      await view.rerender(<Inscription title={name} station={station(name)} recordedAt={null} />);
      const seal = view.container.querySelector("svg[viewBox]")!.getBoundingClientRect();
      const nameColumn = view.container.querySelector("p")!;
      const column = nameColumn.getBoundingClientRect();
      places.push({
        seal: [seal.right, seal.top],
        name: [column.right, column.top],
        size: getComputedStyle(nameColumn).fontSize,
      });
      widths.push(column.width);
    }
    // The longest name runs on into a second column.
    expect(widths.at(-1)).toBeGreaterThan(1.5 * widths[0]);
    expect(new Set(places.map((place) => JSON.stringify(place))).size).toBe(1);
  });

  it("writes the frequency as part of the name", async () => {
    const view = await renderPage(
      <Inscription
        title="酒泉综合广播 FM101.5"
        station={station("酒泉综合广播 FM101.5")}
        recordedAt={null}
      />
    );
    expect(view.container.querySelectorAll("p")).toHaveLength(1);
    expect(view.container.querySelector("p")!.textContent).toBe("酒泉综合广播FM101.5");
  });
});
