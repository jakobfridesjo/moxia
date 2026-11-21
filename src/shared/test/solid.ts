import { render as mount } from "@solidjs/web";
import type { JSX } from "@solidjs/web";

const mounted = new Set<() => void>();

/** Mounts `ui` in a container of its own under the body; `cleanup` unmounts whatever is left. */
export function render(ui: () => JSX.Element) {
  const container = document.body.appendChild(document.createElement("div"));
  const dispose = mount(ui, container);
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    dispose();
    container.remove();
  };
  mounted.add(unmount);
  return { container, unmount };
}

export function cleanup() {
  for (const unmount of mounted) unmount();
}
