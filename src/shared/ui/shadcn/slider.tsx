import { Slider as SliderPrimitive } from "@kobalte/core/slider";
import { cn } from "@/shared/lib/class-names.ts";

interface SliderProps {
  /** Names the slider for assistive tech. */
  label: string;
  /** From 0 to 100. */
  value: number;
  onChange: (value: number) => void;
  class?: string;
}

function Slider(props: SliderProps) {
  return (
    <SliderPrimitive
      data-slot="slider"
      class={cn("relative flex w-full touch-none items-center select-none", props.class)}
      value={[props.value]}
      onChange={([next]) => {
        if (next !== undefined) props.onChange(next);
      }}
      minValue={0}
      maxValue={100}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        class="relative h-1 w-full grow rounded-2xl bg-input/90"
      >
        <SliderPrimitive.Fill
          data-slot="slider-range"
          class="absolute h-full rounded-2xl bg-primary"
        />
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label={props.label}
          class="-top-1.5 block size-4 rounded-2xl bg-white shadow-md ring-1 ring-black/10 transition-[color,box-shadow] duration-200 not-dark:bg-clip-padding hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-hidden"
        >
          <SliderPrimitive.Input />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Track>
    </SliderPrimitive>
  );
}

export { Slider };
