/** The quietest level a meter shows, in dB below full scale. */
const FLOOR_DB = -36;

/** Where a meter reads a peak `level` (0 to 1), from 0 at the floor to 1 at full scale. */
export function meterReading(level: number) {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(Math.min(level, 1));
  return Math.min(Math.max((db - FLOOR_DB) / -FLOOR_DB, 0), 1);
}
