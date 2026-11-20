import { describe, expect, it } from "vitest";
import { makeStation } from "@/shared/test/fixtures.ts";
import { dialOrder, nextCountry } from "@/pages/radio/model/station-order.ts";

describe("dialOrder", () => {
  it("orders stations by country, then region", () => {
    const stations = [
      makeStation({ id: "hk", name: "香港电台", countryCode: "HK" }),
      makeStation({ id: "sh", name: "上海新闻", countryCode: "CN", state: "上海" }),
      makeStation({ id: "bj", name: "北京新闻", countryCode: "CN", state: "北京" }),
      makeStation({ id: "tw", name: "中广", countryCode: "TW" }),
    ];
    expect(dialOrder(stations).map((station) => station.id)).toEqual(["bj", "sh", "tw", "hk"]);
  });
});

describe("nextCountry", () => {
  const order = dialOrder([
    makeStation({ id: "bj", name: "北京新闻", countryCode: "CN", state: "北京" }),
    makeStation({ id: "sh", name: "上海新闻", countryCode: "CN", state: "上海" }),
    makeStation({ id: "tw", name: "中广", countryCode: "TW" }),
    makeStation({ id: "hk", name: "香港电台", countryCode: "HK" }),
  ]);
  const byId = (id: string) => order.find((station) => station.id === id) ?? null;

  it("jumps to the first station of the next country", () => {
    expect(nextCountry(order, byId("sh"), 1)?.id).toBe("tw");
  });

  it("wraps around both ways", () => {
    expect(nextCountry(order, byId("hk"), 1)?.id).toBe("bj");
    expect(nextCountry(order, byId("bj"), -1)?.id).toBe("hk");
  });

  it("starts from either end without a station", () => {
    expect(nextCountry(order, null, 1)?.id).toBe("bj");
    expect(nextCountry([], null, 1)).toBeNull();
  });
});
