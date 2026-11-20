import type { Station, Tape } from "@/shared/api/commands.ts";

// Builders for command results; override only the fields a test reads.

export function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: "960e57c5-0601-11e8-ae97-52543be04c81",
    name: "中国之声",
    streamUrl: "https://example.com/live.mp3",
    homepage: null,
    favicon: null,
    tags: [],
    countryCode: "CN",
    state: null,
    languages: ["chinese"],
    codec: "MP3",
    bitrate: 128,
    hls: false,
    votes: 0,
    clickCount: 0,
    ...overrides,
  };
}

export function makeTape(overrides: Partial<Tape> = {}): Tape {
  return {
    id: "20261112-080000-000",
    station: makeStation(),
    recordedAt: "2026-11-12T08:00:00Z",
    duration: 95,
    codec: "mp3",
    notes: [],
    ...overrides,
  };
}
