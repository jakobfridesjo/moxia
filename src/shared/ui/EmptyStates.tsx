import type { JSX } from "@solidjs/web";
import { cn } from "@/shared/lib/class-names.ts";

export function CenteredEmpty(props: { children: JSX.Element; class?: string }) {
  return (
    <div class={cn("flex flex-1 items-center justify-center", props.class)}>{props.children}</div>
  );
}
