/** Different stones wear differently: a seal picks one of these by its character. */
export const STONES = 8;

const stone = (glyph: string) => (glyph.codePointAt(0) ?? 0) % STONES;

/** The worn filter for a seal's border and red, mounted by `SealInk`. */
export const inkFilter = (glyph: string) => `url(#seal-ink-${stone(glyph)})`;

/** The lighter worn filter for a seal's character, so it stays legible. */
export const glyphFilter = (glyph: string) => `url(#seal-glyph-${stone(glyph)})`;
