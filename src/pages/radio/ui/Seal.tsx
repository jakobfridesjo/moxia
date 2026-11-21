import type { ComponentProps, JSX } from "@solidjs/web";
import { createUniqueId, For, omit, Show } from "solid-js";
import { ariaBoolean } from "@/shared/lib/aria.ts";
import { cn } from "@/shared/lib/class-names.ts";
import { playKeyClick } from "@/shared/lib/key-sound.ts";
import { glyphFilter, inkFilter, STONES, WASH_FILTER } from "@/pages/radio/lib/seal-ink.ts";

type SealShape = "square" | "round";

/** Each outline in its own units; the thick border is softened by the worn filter, not drawn round. */
const SHAPES: Record<
  SealShape,
  { size: number; outline: string; fontSize: number; border: number }
> = {
  square: {
    size: 44,
    outline: "M9 3.5H35Q40.5 3.5 40.5 9V35Q40.5 40.5 35 40.5H9Q3.5 40.5 3.5 35V9Q3.5 3.5 9 3.5Z",
    fontSize: 22,
    border: 4.6,
  },
  round: {
    size: 42,
    outline: "M21 3A18 18 0 1 1 21 39A18 18 0 1 1 21 3Z",
    fontSize: 21,
    border: 4.2,
  },
};

/**
 * The worn-stone filters every seal is printed through. Mount once per screen; seals refer to them by id.
 * The body gets the full wear and a faint mottle in the paste; characters a lighter wear, so they stay legible.
 * The wash under a seal is feathered past its edge, so the seal sits on cleared paper, not on a tile.
 */
export function SealInk() {
  return (
    <svg aria-hidden="true" width="0" height="0" class="absolute">
      <defs>
        <For each={Array.from({ length: STONES }, (_, stone) => stone)}>
          {(stone) => (
            <>
              <WornFilter
                id={`seal-ink-${stone}`}
                seed={stone + 1}
                blur={0.8}
                grit={0.42}
                cut={-4.1}
                mottled
              />
              <WornFilter
                id={`seal-glyph-${stone}`}
                seed={stone + 61}
                blur={0.35}
                grit={0.14}
                cut={-3.4}
              />
            </>
          )}
        </For>
        <filter id="seal-wash" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={3} />
        </filter>
      </defs>
    </svg>
  );
}

/** Blur, add grit, then cut back to a hard edge: corners and stroke ends round off and the edges chip. */
function WornFilter(props: {
  id: string;
  seed: number;
  blur: number;
  grit: number;
  cut: number;
  mottled?: boolean;
}) {
  return (
    // A fixed region larger than any seal, in its own units: one relative to the shape cut the outer
    // edge of the round seal's border off in WebKit.
    <filter
      id={props.id}
      filterUnits="userSpaceOnUse"
      x={-20}
      y={-20}
      width={200}
      height={200}
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation={props.blur} result="soft" />
      <feComponentTransfer in="soft" result="solid">
        <feFuncA type="linear" slope={40} />
      </feComponentTransfer>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={0.55}
        numOctaves={2}
        seed={props.seed}
        result="grit"
      />
      <feComposite
        in="soft"
        in2="grit"
        operator="arithmetic"
        k2={1}
        k3={props.grit}
        k4={-props.grit / 2}
        result="rough"
      />
      <feComponentTransfer in="rough" result="edge">
        <feFuncA type="linear" slope={9} intercept={props.cut} />
      </feComponentTransfer>
      <feComposite in="solid" in2="edge" operator="in" result="print" />
      <Show when={props.mottled}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency={0.09}
          numOctaves={3}
          seed={props.seed + 30}
          result="wash"
        />
        <feColorMatrix
          in="wash"
          type="matrix"
          values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.3"
          result="density"
        />
        <feComposite in="print" in2="density" operator="in" />
      </Show>
    </filter>
  );
}

/**
 * Room around a seal, in its units, for the worn edge to spread into. WebKit crops a blended layer to
 * the box of what holds it, so the drawing, bleed and all, must lie inside that box: a key pulls the
 * bleed back out of the layout with a negative margin on itself, never on what it holds.
 */
export const BLEED = 4;

/** The bleed around a seal drawn `size` px wide, in px. */
const bleedOf = (shape: SealShape, size: number) => (BLEED * size) / SHAPES[shape].size;

interface SealMarkProps {
  glyph: string;
  shape?: SealShape;
  /** 白文: the character cut out of solid red, so the painting shows through it. */
  carved?: boolean;
  /** Barely inked, as a key with nothing stored on it. */
  faint?: boolean;
  /** Width in px. */
  size: number;
  class?: string;
}

/**
 * One seal impression: red worn into the painting, over a faint paper wash that keeps the character
 * readable on busy brushwork, feathered past the edge. The ink multiplies with the painting, so the wash sits in its own layer.
 * At night the red lies on top instead, since multiplied into dark paper it would vanish, and needs no
 * wash: it reads on the dark as it is.
 */
export function SealMark(props: SealMarkProps) {
  const maskId = `seal-${createUniqueId().replace(/\W/g, "")}`;
  const shape = () => SHAPES[props.shape ?? "square"];
  const box = () => {
    const units = shape().size;
    const bleed = bleedOf(props.shape ?? "square", props.size);
    return {
      width: props.size + bleed * 2,
      height: props.size + bleed * 2,
      viewBox: `${-BLEED} ${-BLEED} ${units + BLEED * 2} ${units + BLEED * 2}`,
    };
  };
  const character = (paint: string) => (
    <text
      x={shape().size / 2}
      y={shape().size / 2}
      font-size={String(shape().fontSize)}
      text-anchor="middle"
      dominant-baseline="central"
      class={cn("font-serif font-black", paint)}
    >
      {props.glyph}
    </text>
  );
  return (
    <span aria-hidden="true" class={cn("grid shrink-0", props.class)}>
      <svg {...box()} class="col-start-1 row-start-1 overflow-visible dark:hidden">
        <path d={shape().outline} filter={WASH_FILTER} class="fill-paper opacity-75" />
      </svg>
      <svg
        {...box()}
        class="col-start-1 row-start-1 overflow-visible mix-blend-multiply dark:mix-blend-normal"
      >
        <Show
          when={props.carved}
          fallback={
            <g opacity={props.faint ? 0.3 : 1}>
              <path
                d={shape().outline}
                fill="none"
                stroke-width={shape().border}
                filter={inkFilter(props.glyph)}
                class="stroke-seal"
              />
              <g filter={glyphFilter(props.glyph)}>{character("fill-seal")}</g>
            </g>
          }
        >
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={-4}
            y={-4}
            width={shape().size + 8}
            height={shape().size + 8}
          >
            <rect x={-4} y={-4} width={shape().size + 8} height={shape().size + 8} fill="white" />
            <g filter={glyphFilter(props.glyph)}>{character("fill-black")}</g>
          </mask>
          <g mask={`url(#${maskId})`}>
            <path
              d={shape().outline}
              stroke-width={shape().border}
              filter={inkFilter(props.glyph)}
              class="fill-seal stroke-seal"
            />
          </g>
        </Show>
      </svg>
    </span>
  );
}

interface SealProps extends Omit<
  ComponentProps<"button">,
  "type" | "children" | "class" | "style" | "onClick" | "aria-pressed"
> {
  children: string;
  /** Carved the other way round: solid red, with the character cut out. */
  pressed?: boolean;
  shape?: SealShape;
  class?: string;
  onClick?: (event: MouseEvent) => void;
}

/** A red seal stamped on the painting, used as a key; it clicks when key sounds are on. */
export function Seal(props: SealProps): JSX.Element {
  const rest = omit(props, "children", "pressed", "shape", "class", "onClick");
  const size = () => (props.shape === "round" ? 44 : 40);
  return (
    <button
      type="button"
      aria-pressed={props.pressed === undefined ? undefined : ariaBoolean(props.pressed)}
      data-control
      {...rest}
      class={cn(
        "relative shrink-0 cursor-pointer rounded-[3px] outline-none transition-[scale] duration-150 select-none active:scale-92 focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none",
        props.shape === "round" && "rounded-full",
        props.class
      )}
      style={{ margin: `${-bleedOf(props.shape ?? "square", size())}px` }}
      onClick={(event) => {
        playKeyClick();
        props.onClick?.(event);
      }}
    >
      <SealMark glyph={props.children} shape={props.shape} carved={props.pressed} size={size()} />
    </button>
  );
}
