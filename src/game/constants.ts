/**
 * Game-wide constants for Connect 5 Impossible.
 * All board geometry and rule parameters live here.
 */

/** Number of columns on the board. */
export const COLS = 9;

/** Number of rows on the board. */
export const ROWS = 7;

/** Number of consecutive pieces required to win. */
export const WIN_LENGTH = 5;

/** Total number of cells on the board. */
export const TOTAL_CELLS = COLS * ROWS;

/** Player identifiers. */
export const PLAYER_ONE = 1 as const;
export const PLAYER_TWO = 2 as const;
export const EMPTY = 0 as const;

/**
 * Direction vectors for win-detection scans.
 * Each pair represents [deltaRow, deltaColumn].
 */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],   // horizontal →
  [1, 0],   // vertical   ↓
  [1, 1],   // diagonal   ↘
  [1, -1],  // diagonal   ↙
] as const;
