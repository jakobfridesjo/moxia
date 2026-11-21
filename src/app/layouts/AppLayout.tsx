import type { JSX } from "@solidjs/web";

/** The shell of the pages behind the radio, settings and about: the same rice paper as the painting. */
function AppLayout(props: { children: JSX.Element }) {
  return (
    <div class="relative isolate flex h-svh flex-col overflow-hidden bg-paper text-ink pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <div class="relative z-0 mx-auto min-h-0 w-full max-w-3xl flex-1">{props.children}</div>
    </div>
  );
}

export default AppLayout;
