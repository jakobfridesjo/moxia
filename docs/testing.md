# Testing

`mise test` runs both sides; `mise test:rust` and `mise test:web` run one.

## Rust

On a Fedora Atomic Desktop host, run Rust tests in the toolbox (see [building.md](building.md)).

The core's tests need no network or sound device: stream parsing and tape timing are tested on bytes, and the directory on a server that refuses connections.

### Performance

- `mise bench:subtitles [tape]` loads the subtitle models and transcribes a recording (by default the newest tape) the way the player feeds it, then prints the load time and the real-time factor (time transcribing ÷ length of the audio; it must stay well under 1). It needs the models downloaded in Settings.
- The `profiling` Cargo profile is release with line tables, so a sampling profiler can name functions: `samply record target/profiling/examples/subtitles <models dir> <tape>` shows where the time goes, stage by stage.
- `mise perf:web` plays the radio through fixed scenarios in headless Chromium at a phone's size and pixel density (`src/app/testing/radio.perf.tsx`): idle, playing, subtitles, changing place and station, the mountain path. For each it reports frame times, how busy the main thread was and the hottest functions. Reports, a screenshot and a `.cpuprofile` per scenario, which Chrome DevTools opens, go to `test-results/perf/`. Headless Chromium draws in software, where the painting's GPU effects are left out (as on a machine without a hardware GPU); `PERF=gpu pnpm exec vitest run --project perf` lends it the GPU, which is what measures them. Only the main thread is measured, not the GPU's own work. Compare runs of one setup, not across setups.
- Measure on the phone and in fp16 before deciding anything; desktop numbers only compare one change with another.

## Frontend

### Where tests run

| File                              | Runs in                       |
| --------------------------------- | ----------------------------- |
| `*.test.ts`                       | Node                          |
| `*.test.tsx`, `*.browser.test.ts` | Chromium                      |
| `*.isolated.test.tsx`             | Chromium, for files that mock |

- Browser tests use Vitest Browser Mode; there is no jsdom.
- `render` (`shared/test/solid.ts`) mounts a component under the body, and `renderPage`, `renderPageInRouter` (`shared/test/render.tsx`) and `renderRoute` (`app/testing/router.tsx`) build on it. Each takes a function that returns the JSX, `renderPage(() => <Page />)`, since Solid creates elements as the JSX runs. To change a prop, pass it a signal and set it; `flush()` from `solid-js` applies the change at once, or poll with `expect.element`.
- All browser tests share one page. Reset global stores in `app/testing/browser-shared-page.ts`.
- Install Chromium with `mise test:web:browsers` (add `--with-deps` on a fresh Linux).

### Mocking Rust

- Mock at the IPC boundary with `mockCommands` (`shared/test/tauri.ts`). Never `vi.mock` `commands.ts`.
- Push `Channel` messages with `sendToChannel`; it numbers them on from earlier sends to the same channel, so send in as many calls as the test needs. Check what was sent with `callsTo`.
- Build results with `shared/test/fixtures.ts` (`makeStation`, `makeTape`), overriding only the fields the test reads.
- A test that renders a route with `renderRoute` lives in `app/routes/` as `-<name>.test.tsx`: lower layers cannot import from `app`.
- A handler that keeps state (say, a `Map` of favourites) beats scripting each refetch.
- Drive the player by sending `PlayerEvent`s to `play`'s `onEvent` channel.

### Other mocks

- Prefer the DOM, `renderPageInRouter`/`renderRoute` and props over `vi.mock()`.
- When you must mock, target a concrete module and name the file `*.isolated.test.tsx`.
