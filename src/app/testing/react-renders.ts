/**
 * Counts which components render, through the hook React DevTools uses. Install it before React
 * loads: as the first setup file of the project that measures.
 */

interface Fiber {
  type: unknown;
  flags: number;
  /** When the fiber last began rendering; development builds of React keep it. */
  actualStartTime?: number;
  child: Fiber | null;
  sibling: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
}

/** React's flag on a fiber whose component function ran. */
const PERFORMED_WORK = 1;

let commits = 0;
let lastCommit = 0;
const renders = new Map<string, number>();

function nameOf(type: unknown): string | null {
  if (typeof type === "function")
    return (type as { displayName?: string }).displayName ?? type.name;
  if (type && typeof type === "object") {
    const wrapped = type as { displayName?: string; render?: unknown; type?: unknown };
    return wrapped.displayName ?? nameOf(wrapped.render ?? wrapped.type);
  }
  return null;
}

/**
 * A fiber rendered in this commit if its component ran after the last commit; a subtree React
 * skipped keeps the fibers, and the times, of an earlier one.
 */
function count(root: Fiber | null, since: number) {
  const pending = root ? [root] : [];
  for (let fiber = pending.pop(); fiber; fiber = pending.pop()) {
    if (fiber.flags & PERFORMED_WORK && (fiber.actualStartTime ?? -1) >= since) {
      const name = nameOf(fiber.type);
      if (name) renders.set(name, (renders.get(name) ?? 0) + 1);
    }
    if (fiber.sibling) pending.push(fiber.sibling);
    if (fiber.child) pending.push(fiber.child);
  }
}

type Hook = Record<string, unknown> & {
  onCommitFiberRoot?: (id: number, root: FiberRoot, ...rest: unknown[]) => void;
};

const global = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook };
const renderers = new Map<number, unknown>();
const hook: Hook = (global.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
  renderers,
  supportsFiber: true,
  inject: (renderer: unknown) => {
    renderers.set(renderers.size + 1, renderer);
    return renderers.size;
  },
  checkDCE: () => {},
  onScheduleFiberRoot: () => {},
  onCommitFiberUnmount: () => {},
  onPostCommitFiberRoot: () => {},
});
const previous = hook.onCommitFiberRoot;
hook.onCommitFiberRoot = (id, root, ...rest) => {
  previous?.(id, root, ...rest);
  commits += 1;
  count(root.current, lastCommit);
  lastCommit = performance.now();
};

export function resetRenders() {
  commits = 0;
  renders.clear();
}

/** Commits since the last reset, and how often each component rendered in them, most first. */
export function renderCounts() {
  return {
    commits,
    components: [...renders].sort(([, a], [, b]) => b - a),
  };
}
