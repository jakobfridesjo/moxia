import { describe, expect, it } from "vitest";
import { makeStation } from "@/shared/test/fixtures.ts";
import { dialOrder, nextCountry, seekStation } from "@/pages/radio/model/station-order.ts";

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

describe("seekStation", () => {
  const order = [
    makeStation({ id: "news", categories: ["news"] }),
    makeStation({ id: "music", categories: ["music"] }),
    makeStation({ id: "untagged" }),
    makeStation({ id: "both", categories: ["music", "news"] }),
  ];
  const byId = (id: string) => order.find((station) => station.id === id) ?? null;

  it("steps through every station, wrapping around", () => {
    expect(seekStation(order, byId("both"), 1, "all")?.id).toBe("news");
    expect(seekStation(order, byId("news"), -1, "all")?.id).toBe("both");
  });

  it("skips stations outside the category", () => {
    expect(seekStation(order, byId("music"), 1, "music")?.id).toBe("both");
    expect(seekStation(order, byId("music"), -1, "news")?.id).toBe("news");
  });

  it("goes on from a station outside the category, keeping its place", () => {
    expect(seekStation(order, byId("untagged"), 1, "news")?.id).toBe("both");
    expect(seekStation(order, byId("untagged"), -1, "news")?.id).toBe("news");
  });

  it("starts at an end when nothing plays, and finds nothing in an empty category", () => {
    expect(seekStation(order, null, 1, "music")?.id).toBe("music");
    expect(seekStation(order, null, -1, "music")?.id).toBe("both");
    expect(seekStation(order, byId("news"), 1, "traffic")).toBeNull();
  });
});
