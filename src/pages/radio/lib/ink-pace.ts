/** How often slow weather is drawn: mist and falling leaves look the same at 30 frames a second. */
export const AMBIENT_FRAME_MS = 1000 / 30;
/** A frame due within this much is drawn now, as the screen's frames do not land exactly. */
export const FRAME_SLACK_MS = 4;
