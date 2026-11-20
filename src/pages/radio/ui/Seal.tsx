import { Fragment, useId, type ComponentProps } from "react";
import { cn } from "@/shared/lib/class-names.ts";
import { playKeyClick } from "@/shared/lib/key-sound.ts";
import { glyphFilter, inkFilter, STONES } from "@/pages/radio/lib/seal-ink.ts";

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
 */
export function SealInk() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        {Array.from({ length: STONES }, (_, stone) => (
          <Fragment key={stone}>
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
          </Fragment>
        ))}
      </defs>
    </svg>
  );
}

/** Blur, add grit, then cut back to a hard edge: corners and stroke ends round off and the edges chip. */
function WornFilter({
  id,
  seed,
  blur,
  grit,
  cut,
  mottled,
}: {
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
      id={id}
      filterUnits="userSpaceOnUse"
      x={-20}
      y={-20}
      width={200}
      height={200}
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="soft" />
      <feComponentTransfer in="soft" result="solid">
        <feFuncA type="linear" slope={40} />
      </feComponentTransfer>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={0.55}
        numOctaves={2}
        seed={seed}
        result="grit"
      />
      <feComposite
        in="soft"
        in2="grit"
        operator="arithmetic"
        k2={1}
        k3={grit}
        k4={-grit / 2}
        result="rough"
      />
      <feComponentTransfer in="rough" result="edge">
        <feFuncA type="linear" slope={9} intercept={cut} />
      </feComponentTransfer>
      <feComposite in="solid" in2="edge" operator="in" result="print" />
      {mottled && (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={0.09}
            numOctaves={3}
            seed={seed + 30}
            result="wash"
          />
          <feColorMatrix
            in="wash"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.3"
            result="density"
          />
          <feComposite in="print" in2="density" operator="in" />
        </>
      )}
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
  className?: string;
}

/**
 * One seal impression: red worn into the painting, over a faint paper wash that keeps the character
 * readable on busy brushwork. The ink multiplies with the painting, so the wash sits in its own layer.
 * At night the red lies on top instead, since multiplied into dark paper it would vanish, and needs no
 * wash: it reads on the dark as it is.
 */
export function SealMark({
  glyph,
  shape = "square",
  carved,
  faint,
  size,
  className,
}: SealMarkProps) {
  const maskId = `seal-${useId().replace(/\W/g, "")}`;
  const { size: units, outline, fontSize, border } = SHAPES[shape];
  const bleed = bleedOf(shape, size);
  const box = {
    width: size + bleed * 2,
    height: size + bleed * 2,
    viewBox: `${-BLEED} ${-BLEED} ${units + BLEED * 2} ${units + BLEED * 2}`,
  };
  const character = (paint: string) => (
    <text
      x={units / 2}
      y={units / 2}
      fontSize={fontSize}
      textAnchor="middle"
      dominantBaseline="central"
      className={cn("font-serif font-black", paint)}
    >
      {glyph}
    </text>
  );
  return (
    <span aria-hidden className={cn("grid shrink-0", className)}>
      <svg {...box} className="col-start-1 row-start-1 dark:hidden">
        <path d={outline} className="fill-paper opacity-55" />
      </svg>
      <svg
        {...box}
        className="col-start-1 row-start-1 overflow-visible mix-blend-multiply dark:mix-blend-normal"
      >
        {carved ? (
          <>
            <mask
              id={maskId}
              maskUnits="userSpaceOnUse"
              x={-4}
              y={-4}
              width={units + 8}
              height={units + 8}
            >
              <rect x={-4} y={-4} width={units + 8} height={units + 8} fill="white" />
              <g filter={glyphFilter(glyph)}>{character("fill-black")}</g>
            </mask>
            <g mask={`url(#${maskId})`}>
              <path
                d={outline}
                strokeWidth={border}
                filter={inkFilter(glyph)}
                className="fill-seal stroke-seal"
              />
            </g>
          </>
        ) : (
          <g opacity={faint ? 0.3 : 1}>
            <path
              d={outline}
              fill="none"
              strokeWidth={border}
              filter={inkFilter(glyph)}
              className="stroke-seal"
            />
            <g filter={glyphFilter(glyph)}>{character("fill-seal")}</g>
          </g>
        )}
      </svg>
    </span>
  );
}

interface SealProps extends Omit<ComponentProps<"button">, "type" | "children"> {
  children: string;
  /** Carved the other way round: solid red, with the character cut out. */
  pressed?: boolean;
  shape?: SealShape;
}

/** A red seal stamped on the painting, used as a key; it clicks when key sounds are on. */
export function Seal({
  children,
  pressed,
  shape = "square",
  className,
  style,
  onClick,
  ...props
}: SealProps) {
  const size = shape === "round" ? 44 : 40;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-control
      className={cn(
        "relative shrink-0 cursor-pointer rounded-[3px] outline-none transition-[scale] duration-150 select-none active:scale-92 focus-visible:ring-2 focus-visible:ring-ink motion-reduce:transition-none",
        shape === "round" && "rounded-full",
        className
      )}
      style={{ margin: -bleedOf(shape, size), ...style }}
      onClick={(event) => {
        playKeyClick();
        onClick?.(event);
      }}
      {...props}
    >
      <SealMark glyph={children} shape={shape} carved={pressed} size={size} />
    </button>
  );
}
