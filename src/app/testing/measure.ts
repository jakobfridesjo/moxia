import { cdp, server } from "vitest/browser";
import { renderCounts, resetRenders } from "@/app/testing/react-renders.ts";

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

type Metrics = Record<string, number>;

/** Where each scenario's CPU profile is written, to open in Chrome DevTools' Performance panel. */
const PROFILES = "test-results/perf";

async function metrics(): Promise<Metrics> {
  const { metrics } = await cdp().send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

/** Frame intervals in ms, for `ms` milliseconds. */
function frameIntervals(ms: number) {
  return new Promise<number[]>((resolve) => {
    const intervals: number[] = [];
    let start = 0;
    let last = 0;
    const step = (now: number) => {
      if (!start) start = now;
      else intervals.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(step);
      else resolve(intervals);
    };
    requestAnimationFrame(step);
  });
}

function label({ functionName, url, lineNumber }: ProfileNode["callFrame"]) {
  const file = url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "");
  const where = file ? ` ${file.split("/").slice(-2).join("/")}:${lineNumber + 1}` : "";
  return `${functionName || "(anonymous)"}${where}`;
}

/**
 * Self time in ms by function, most first, without idle time. A built-in such as `drawImage`
 * is named with the script function that called it, as that is what can change.
 */
function hotFunctions(profile: CpuProfile, top: number) {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const caller = (id: number) => {
    for (let at = parents.get(id); at !== undefined; at = parents.get(at)) {
      const node = byNode.get(at);
      if (node?.callFrame.url) return label(node.callFrame);
    }
    return null;
  };
  const self = new Map<string, number>();
  profile.samples.forEach((id, index) => {
    const frame = byNode.get(id)?.callFrame;
    if (!frame || frame.functionName === "(idle)") return;
    const from = frame.url ? null : caller(id);
    const name = from ? `${label(frame)} ← ${from}` : label(frame);
    self.set(name, (self.get(name) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...self].sort(([, a], [, b]) => b - a).slice(0, top);
}

/** What draws: a GPU, or SwiftShader, Chromium's software stand-in. */
function renderer() {
  const gl = document.createElement("canvas").getContext("webgl");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "no WebGL";
}

export interface Measurement {
  scenario: string;
  seconds: number;
  frames: { fps: number; p50: number; p95: number; max: number; over33ms: number };
  /** Share of wall time the main thread was busy, and on what. */
  busy: { total: number; script: number; layout: number; style: number };
  longTasks: { count: number; ms: number };
  react: ReturnType<typeof renderCounts>;
  hot: [string, number][];
}

/** Watches the page for `seconds` while it does whatever `scenario` set going. */
export async function measure(scenario: string, seconds: number): Promise<Measurement> {
  const session = cdp();
  await session.send("Performance.enable", { timeDomain: "timeTicks" });
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 250 });
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) =>
    list.getEntries().forEach((entry) => longTasks.push(entry.duration))
  );
  observer.observe({ type: "longtask" });
  resetRenders();
  const before = await metrics();
  await session.send("Profiler.start");

  const intervals = await frameIntervals(seconds * 1000);

  const { profile } = (await session.send("Profiler.stop")) as { profile: CpuProfile };
  const after = await metrics();
  observer.disconnect();
  await server.commands.writeFile(
    `${PROFILES}/${scenario.replaceAll(/\W+/g, "-")}.cpuprofile`,
    JSON.stringify(profile)
  );

  const wall = (after.Timestamp ?? 0) - (before.Timestamp ?? 0);
  const share = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) / wall;
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    scenario,
    seconds,
    frames: {
      fps: intervals.length / seconds,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted.at(-1) ?? 0,
      over33ms: intervals.filter((interval) => interval > 33.4).length,
    },
    busy: {
      total: share("TaskDuration"),
      script: share("ScriptDuration"),
      layout: share("LayoutDuration"),
      style: share("RecalcStyleDuration"),
    },
    longTasks: { count: longTasks.length, ms: longTasks.reduce((sum, ms) => sum + ms, 0) },
    react: renderCounts(),
    hot: hotFunctions(profile, 12),
  };
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
const ms = (value: number) => `${value.toFixed(1)} ms`;

function report(measurements: Measurement[]) {
  const lines = [`renderer: ${renderer()} · ${window.devicePixelRatio}× pixels`];
  lines.push(
    ...measurements.flatMap((m) => [
      `── ${m.scenario} (${m.seconds} s)`,
      `   frames  ${m.frames.fps.toFixed(1)} fps · p50 ${ms(m.frames.p50)} · p95 ${ms(m.frames.p95)} · max ${ms(m.frames.max)} · ${m.frames.over33ms} over 33 ms`,
      `   busy    ${pct(m.busy.total)} (script ${pct(m.busy.script)}, layout ${pct(m.busy.layout)}, style ${pct(m.busy.style)}) · long tasks ${m.longTasks.count} (${ms(m.longTasks.ms)})`,
      `   react   ${m.react.commits} commits · ${
        m.react.components
          .slice(0, 8)
          .map(([name, count]) => `${name}×${count}`)
          .join(", ") || "nothing rendered"
      }`,
      `   hot     ${m.hot
        .slice(0, 8)
        .map(([name, time]) => `${name} ${time.toFixed(0)}ms`)
        .join("\n           ")}`,
    ])
  );
  return lines.join("\n");
}

export async function saveReport(measurements: Measurement[]) {
  await server.commands.writeFile(`${PROFILES}/report.json`, JSON.stringify(measurements, null, 2));
  await server.commands.writeFile(`${PROFILES}/report.txt`, report(measurements));
}
