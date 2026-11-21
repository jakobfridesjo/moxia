import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group.tsx";

/** One of `options` chosen; pressing the chosen one again leaves it chosen. */
export function Choices<T extends string>(props: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (option: T) => JSX.Element;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <ToggleGroup
      aria-label={props.label}
      variant="outline"
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      onChange={(next) => {
        const chosen = props.options.find((option) => option === next);
        if (chosen) props.onChange(chosen);
      }}
    >
      <For each={props.options}>
        {(option) => (
          <ToggleGroupItem value={option} class="px-3">
            {props.render(option)}
          </ToggleGroupItem>
        )}
      </For>
    </ToggleGroup>
  );
}
