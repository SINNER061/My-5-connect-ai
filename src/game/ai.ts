/**
 * Connect 5 Impossible – Phase 3 Strong AI
 *
 * Architecture:
 *   - Negamax with alpha-beta pruning (fail-soft)
 *   - Iterative deepening with 1 400 ms time budget
 *   - Transposition table – Zobrist hashing, 1 M entries
 *   - Move ordering: immediate wins → forced blocks → threat moves →
 *                    killer moves → history heuristic → centre preference
 *   - Threat Space Search (TSS): double / split / overlapping / fork /
 *     trap detection; forced-sequence search
 *   - Rich evaluation: open-2/3/4, broken-3/4, double-open-3/4,
 *     centre control, vertical / horizontal / diagonal pressure,
 *     endgame tightening
 *   - Adaptive search extensions for forcing lines
 *   - Horizon-effect reduction via quiescence on direct threats
 *
 * Public interface (unchanged from Phase 1):
 *   chooseMove(state: GameState): number   → legal column index, or -1
 */

import { COLS, ROWS, WIN_LENGTH, EMPTY, PLAYER_TWO } from './constants.js';
import type { Board, GameState, Player } from './types.js';
import { tacticalSearch, TSS_HORIZON } from './tactical.js';

// ─── Tuneable constants ────────────────────────────────────────────────────────

const TIME_LIMIT_MS   = 1_400;   // leave 100 ms margin for worker overhead
const MAX_DEPTH       = 14;      // absolute cap on iterative deepening

// Score sentinels
const WIN_SCORE       = 1_000_000_000;
const LOSS_SCORE      = -WIN_SCORE;

// Pattern scores (absolute, positive = good for the side being evaluated)
const S_FOUR          = 200_000;   // 4-in-a-row with 1 accessible empty
const S_FOUR_LATENT   =  80_000;   // 4-in-a-row, empty not yet accessible
const S_THREE_OPEN    =  10_000;   // open-3 (both ends unblocked)
const S_THREE         =   2_000;   // closed-3 (one end blocked)
const S_BROKEN_FOUR   = 120_000;   // broken-4 (4 pieces in window of 6, 1 gap)
const S_BROKEN_THREE  =   3_500;   // broken-3
const S_TWO_OPEN      =     400;   // open-2
const S_TWO           =      60;   // closed-2
const S_ONE           =       8;

// Double-threat bonus (two simultaneous direct threats = forced win)
// S_DOUBLE_FOUR / S_DOUBLE_THREE were used for the analyseThreat bonus which is
// now removed from evaluate() (captured implicitly by window scores × count).
// Kept for reference; not currently active.
// const S_DOUBLE_FOUR   = 900_000;
// const S_DOUBLE_THREE  =  25_000;

// Positional bonuses per piece
const CENTER_COL = Math.floor(COLS / 2);          // 4
const CENTER_ROW = Math.floor(ROWS / 2);          // 3

// Column preference for move ordering (centre-out for 9 columns)
const COL_ORDER = [4, 3, 5, 2, 6, 1, 7, 0, 8] as const;

// ─── Transposition table ───────────────────────────────────────────────────────

const TT_BITS  = 20;
const TT_SIZE  = 1 << TT_BITS;   // 1 048 576 entries
const TT_MASK  = TT_SIZE - 1;

// Parallel arrays for cache efficiency
const ttKey    = new Int32Array(TT_SIZE);
const ttDepth  = new Int8Array(TT_SIZE);
const ttScore  = new Int32Array(TT_SIZE);
const ttFlag   = new Uint8Array(TT_SIZE);   // 0 = exact, 1 = lower, 2 = upper
const ttMove   = new Int8Array(TT_SIZE).fill(-1);

const FLAG_EXACT = 0;
const FLAG_LOWER = 1;   // alpha cutoff (fail-low) → upper bound
const FLAG_UPPER = 2;   // beta  cutoff (fail-high) → lower bound

function ttClear(): void {
  ttKey.fill(0);
  ttDepth.fill(-1);
}

// ─── Zobrist hashing ──────────────────────────────────────────────────────────

// Deterministic pseudo-random 32-bit values; safe for XOR hashing.
function lcg32(s: number): number {
  return (Math.imul(s, 1_664_525) + 1_013_904_223) | 0;
}

const CELLS = ROWS * COLS;
// zobrist[cellIndex * 2 + (player-1)]  →  32-bit hash contribution
const zobrist = new Int32Array(CELLS * 2);
let _seed = 0xDEAD_BEEF | 0;
for (let i = 0; i < zobrist.length; i++) {
  _seed = lcg32(_seed);
  zobrist[i] = _seed;
}
const Z_SIDE = lcg32(_seed); // XOR this when it is player 2's turn

function computeHash(board: Int8Array, player: number): number {
  let h = 0;
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i];
    if (cell !== EMPTY) {
      h ^= zobrist[i * 2 + (cell - 1)];
    }
  }
  if (player === PLAYER_TWO) h ^= Z_SIDE;
  return h;
}

// Incremental hash update when a piece is placed / removed

// ─── Internal mutable board ───────────────────────────────────────────────────
//
// Keeping the search in a compact mutable representation avoids allocating
// thousands of GameState objects.  We convert once from the immutable engine
// Board and search entirely on Int8Array + tops[].

/** Convert an immutable engine Board to a mutable Int8Array. */
function boardToInt8(board: Board): Int8Array {
  const b = new Int8Array(CELLS);
  for (let i = 0; i < CELLS; i++) b[i] = board[i];
  return b;
}

/**
 * Compute tops[col] = lowest free row in each column, or -1 if full.
 * Row 0 is the top; row ROWS-1 is the bottom.
 */
function computeTops(board: Int8Array): Int8Array {
  const tops = new Int8Array(COLS).fill(-1);
  for (let col = 0; col < COLS; col++) {
    for (let row = ROWS - 1; row >= 0; row--) {
      if (board[row * COLS + col] === EMPTY) {
        tops[col] = row;
        break;
      }
    }
  }
  return tops;
}

/** Undo a piece placed at the known row. */
function undrop(board: Int8Array, tops: Int8Array, col: number, row: number): void {
  board[row * COLS + col] = EMPTY;
  tops[col] = row;
}

// ─── Win detection (incremental) ─────────────────────────────────────────────

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 0], [1, 1], [1, -1],
];

/** Check whether placing at (row, col) by `player` produces a win. */
function isWinAt(board: Int8Array, row: number, col: number, player: number): boolean {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    // positive direction
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++; r += dr; c += dc;
    }
    // negative direction
    r = row - dr; c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++; r -= dr; c -= dc;
    }
    if (count >= WIN_LENGTH) return true;
  }
  return false;
}

// ─── Fast inline threat checkers ─────────────────────────────────────────────

/**
 * Fast O(4 * WIN_LENGTH^2) check: does the piece just placed at (row, col)
 * by `player` create any four-threat (WIN_LENGTH-1 in a window of WIN_LENGTH
 * with the one empty cell being accessible)?
 *
 * Used in move ordering to avoid the expensive full-board `analyseThreat`.
 */
function hasFour(board: Int8Array, tops: Int8Array, row: number, col: number, player: number): boolean {
  const opp = 3 - player;
  for (const [dr, dc] of DIRS) {
    // Slide a window of WIN_LENGTH along this axis; only check windows containing (row, col).
    for (let offset = 0; offset < WIN_LENGTH; offset++) {
      const r0 = row - offset * dr;
      const c0 = col - offset * dc;
      // Check the window [r0, c0] .. [r0+(W-1)*dr, c0+(W-1)*dc]
      const rEnd = r0 + (WIN_LENGTH - 1) * dr;
      const cEnd = c0 + (WIN_LENGTH - 1) * dc;
      if (r0 < 0 || r0 >= ROWS || c0 < 0 || c0 >= COLS) continue;
      if (rEnd < 0 || rEnd >= ROWS || cEnd < 0 || cEnd >= COLS) continue;

      let mine = 0, oppN = 0, emptyR = -1, emptyC = -1;
      for (let k = 0; k < WIN_LENGTH; k++) {
        const r = r0 + k * dr;
        const c = c0 + k * dc;
        const cell = board[r * COLS + c];
        if (cell === player) { mine++; }
        else if (cell === opp) { oppN++; break; }
        else { emptyR = r; emptyC = c; }
      }
      if (oppN === 0 && mine === WIN_LENGTH - 1 && emptyR >= 0 && tops[emptyC] === emptyR) {
        return true;
      }
    }
  }
  return false;
}

// ─── Threat detection ─────────────────────────────────────────────────────────

interface ThreatInfo {
  /** Number of accessible four-threats (4-in-a-row, 1 accessible empty). */
  fours:      number;
  /** Number of latent four-threats (4-in-a-row, empty not yet accessible). */
  foursLatent: number;
  /** Number of open-three threats with at least one accessible empty. */
  threesOpen: number;
  /** Columns that must be played to block direct (four) threats. */
  urgentCols: Set<number>;
}

/**
 * Scan the board for threats belonging to `player`.
 * A "four" is a window of WIN_LENGTH with 4 pieces and 1 empty.
 * Accessibility: the empty cell is playable iff tops[col] === row.
 */
function analyseThreat(board: Int8Array, tops: Int8Array, player: number): ThreatInfo {
  const opp = 3 - player as Player;
  let fours = 0, foursLatent = 0, threesOpen = 0;
  const urgentCols = new Set<number>();

  const scanWindow = (
    r0: number, c0: number, dr: number, dc: number,
  ): void => {
    let mine = 0, oppN = 0, emptyCount = 0;
    let emptyCol = -1, emptyAccessible = false;
    let openEnds = 0;

    for (let k = 0; k < WIN_LENGTH; k++) {
      const r = r0 + k * dr;
      const c = c0 + k * dc;
      const cell = board[r * COLS + c];
      if (cell === player) {
        mine++;
      } else if (cell === (opp as number)) {
        oppN++;
      } else {
        emptyCount++;
        emptyCol = c;
        if (tops[c] === r) emptyAccessible = true;
      }
    }
    if (oppN > 0) return; // blocked window

    if (mine === WIN_LENGTH - 1 && emptyCount === 1) {
      // Four-threat: note the blocking column
      if (emptyAccessible) {
        fours++;
        urgentCols.add(emptyCol);
      } else {
        foursLatent++;
      }
    } else if (mine === WIN_LENGTH - 2 && emptyCount === 2) {
      // Check openness: both cells outside window accessible?
      // Simplified: count how many empty cells are accessible
      let accCount = 0;
      for (let k = 0; k < WIN_LENGTH; k++) {
        const r = r0 + k * dr;
        const c = c0 + k * dc;
        if (board[r * COLS + c] === EMPTY && tops[c] === r) accCount++;
      }
      // Check cells just beyond the window ends
      const prevR = r0 - dr, prevC = c0 - dc;
      const nextR = r0 + WIN_LENGTH * dr, nextC = c0 + WIN_LENGTH * dc;
      const prevOpen = prevR >= 0 && prevR < ROWS && prevC >= 0 && prevC < COLS &&
                       board[prevR * COLS + prevC] === EMPTY;
      const nextOpen = nextR >= 0 && nextR < ROWS && nextC >= 0 && nextC < COLS &&
                       board[nextR * COLS + nextC] === EMPTY;
      if (accCount >= 1 && (prevOpen || nextOpen)) openEnds++;
      if (openEnds > 0 && accCount >= 1) threesOpen++;
    }
  };

  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - WIN_LENGTH; c++) scanWindow(r, c, 0, 1);
  }
  // Vertical
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = 0; c < COLS; c++) scanWindow(r, c, 1, 0);
  }
  // Diagonal ↘
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = 0; c <= COLS - WIN_LENGTH; c++) scanWindow(r, c, 1, 1);
  }
  // Diagonal ↙
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = WIN_LENGTH - 1; c < COLS; c++) scanWindow(r, c, 1, -1);
  }

  return { fours, foursLatent, threesOpen, urgentCols };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Score a single window of WIN_LENGTH cells for `player`.
 * Returns 0 if the window is blocked (opponent piece present).
 */
function scoreWindow(
  board: Int8Array,
  tops: Int8Array,
  r0: number, c0: number,
  dr: number, dc: number,
  player: number, opp: number,
): number {
  let mine = 0, oppN = 0, accessible = 0;

  for (let k = 0; k < WIN_LENGTH; k++) {
    const r = r0 + k * dr;
    const c = c0 + k * dc;
    const cell = board[r * COLS + c];
    if (cell === player) mine++;
    else if (cell === opp) { oppN++; }
    else if (tops[c] === r) accessible++;
  }

  if (oppN > 0) return 0;
  if (mine === WIN_LENGTH) return WIN_SCORE; // shouldn't reach here; handled externally

  switch (mine) {
    case WIN_LENGTH - 1: // four
      return accessible > 0 ? S_FOUR : S_FOUR_LATENT;
    case WIN_LENGTH - 2: { // three
      // Check openness beyond the window
      const prevR = r0 - dr, prevC = c0 - dc;
      const nextR = r0 + WIN_LENGTH * dr, nextC = c0 + WIN_LENGTH * dc;
      const prevOpen = prevR >= 0 && prevR < ROWS && prevC >= 0 && prevC < COLS &&
                       board[prevR * COLS + prevC] === EMPTY;
      const nextOpen = nextR >= 0 && nextR < ROWS && nextC >= 0 && nextC < COLS &&
                       board[nextR * COLS + nextC] === EMPTY;
      const open = prevOpen && nextOpen;
      if (accessible > 0) return open ? S_THREE_OPEN : S_THREE;
      return S_THREE >> 2;
    }
    case WIN_LENGTH - 3: // two
      return accessible > 0 ? S_TWO_OPEN : S_TWO;
    case 1:
      return S_ONE;
    default:
      return 0;
  }
}

/**
 * Score a window of WIN_LENGTH+1 for broken patterns (e.g. XX_XX, X_XXX).
 */
function scoreBrokenWindow(
  board: Int8Array,
  tops: Int8Array,
  r0: number, c0: number,
  dr: number, dc: number,
  player: number, opp: number,
): number {
  let mine = 0, oppN = 0, accessible = 0, emptyCount = 0;
  const LEN = WIN_LENGTH + 1;

  for (let k = 0; k < LEN; k++) {
    const r = r0 + k * dr;
    const c = c0 + k * dc;
    const cell = board[r * COLS + c];
    if (cell === player) mine++;
    else if (cell === opp) { oppN++; }
    else { emptyCount++; if (tops[c] === r) accessible++; }
  }

  if (oppN > 0) return 0;

  if (mine === WIN_LENGTH - 1 && emptyCount === 2 && accessible >= 1) {
    // Broken four: 4 pieces in a 6-window with 2 gaps, at least 1 accessible
    return S_BROKEN_FOUR;
  }
  if (mine === WIN_LENGTH - 2 && emptyCount === 3 && accessible >= 1) {
    return S_BROKEN_THREE;
  }
  return 0;
}

/**
 * Positional bonus: reward pieces near the centre.
 */
function positionalScore(board: Int8Array, player: number): number {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r * COLS + c] === player) {
        const dc = Math.abs(c - CENTER_COL);
        const dr = Math.abs(r - CENTER_ROW);
        score += Math.max(0, 4 - dc) * 8 + Math.max(0, 3 - dr) * 4;
      }
    }
  }
  return score;
}

/**
 * Full board evaluation relative to `player` (positive = better for player).
 */
function evaluate(board: Int8Array, tops: Int8Array, player: number, moveCount: number): number {
  const opp = 3 - player;
  let myScore = 0, oppScore = 0;

  // --- Standard windows (WIN_LENGTH) ---
  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - WIN_LENGTH; c++) {
      myScore  += scoreWindow(board, tops, r, c, 0, 1, player, opp);
      oppScore += scoreWindow(board, tops, r, c, 0, 1, opp, player);
    }
  }
  // Vertical
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = 0; c < COLS; c++) {
      myScore  += scoreWindow(board, tops, r, c, 1, 0, player, opp);
      oppScore += scoreWindow(board, tops, r, c, 1, 0, opp, player);
    }
  }
  // Diagonal ↘
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = 0; c <= COLS - WIN_LENGTH; c++) {
      myScore  += scoreWindow(board, tops, r, c, 1, 1, player, opp);
      oppScore += scoreWindow(board, tops, r, c, 1, 1, opp, player);
    }
  }
  // Diagonal ↙
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++) {
    for (let c = WIN_LENGTH - 1; c < COLS; c++) {
      myScore  += scoreWindow(board, tops, r, c, 1, -1, player, opp);
      oppScore += scoreWindow(board, tops, r, c, 1, -1, opp, player);
    }
  }

  // --- Broken patterns (WIN_LENGTH+1 windows) ---
  const BL = WIN_LENGTH + 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - BL; c++) {
      myScore  += scoreBrokenWindow(board, tops, r, c, 0, 1, player, opp);
      oppScore += scoreBrokenWindow(board, tops, r, c, 0, 1, opp, player);
    }
  }
  for (let r = 0; r <= ROWS - BL; r++) {
    for (let c = 0; c < COLS; c++) {
      myScore  += scoreBrokenWindow(board, tops, r, c, 1, 0, player, opp);
      oppScore += scoreBrokenWindow(board, tops, r, c, 1, 0, opp, player);
    }
  }
  for (let r = 0; r <= ROWS - BL; r++) {
    for (let c = 0; c <= COLS - BL; c++) {
      myScore  += scoreBrokenWindow(board, tops, r, c, 1, 1, player, opp);
      oppScore += scoreBrokenWindow(board, tops, r, c, 1, 1, opp, player);
    }
  }
  for (let r = 0; r <= ROWS - BL; r++) {
    for (let c = BL - 1; c < COLS; c++) {
      myScore  += scoreBrokenWindow(board, tops, r, c, 1, -1, player, opp);
      oppScore += scoreBrokenWindow(board, tops, r, c, 1, -1, opp, player);
    }
  }

  // --- Positional bonus ---
  myScore  += positionalScore(board, player);
  oppScore += positionalScore(board, opp);

  // --- Endgame tightening: value threats more when board is filling ---
  const tightness = 1 + moveCount / (ROWS * COLS);
  return Math.round((myScore - oppScore * 1.05) * tightness);
}

// ─── Move ordering ────────────────────────────────────────────────────────────

const killers: Int8Array[] = Array.from(
  { length: MAX_DEPTH + 2 }, () => new Int8Array(2).fill(-1)
);
const history = new Int32Array(COLS);

function clearKillersAndHistory(): void {
  for (const k of killers) k.fill(-1);
  history.fill(0);
}

/**
 * Build an ordered list of columns to try.
 * Priority:
 *   1. Immediate winning moves (for current player)
 *   2. Forced blocks (opponent would win next move)
 *   3. Moves that create a direct threat (fork / double threat)
 *   4. Killer moves
 *   5. Remaining moves by history heuristic + centre preference
 */
function orderedMoves(
  board: Int8Array, tops: Int8Array, player: number, depth: number,
): number[] {
  const opp = 3 - player;
  const legal: number[] = [];
  const wins: number[] = [];
  const blocks: number[] = [];
  const threats: number[] = [];
  const rest: number[] = [];
  const killSet = new Set([killers[depth][0], killers[depth][1]]);

  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;
    legal.push(col);

    // 1. Immediate win
    board[row * COLS + col] = player;
    if (isWinAt(board, row, col, player)) { wins.push(col); board[row * COLS + col] = EMPTY; continue; }
    board[row * COLS + col] = EMPTY;

    // 2. Forced block
    board[row * COLS + col] = opp;
    const mustBlock = isWinAt(board, row, col, opp);
    board[row * COLS + col] = EMPTY;
    if (mustBlock) { blocks.push(col); continue; }

    // 3. Creates a direct four or opens a double-three (fast inline check)
    board[row * COLS + col] = player;
    tops[col] = row - 1;
    const createsDirectFour = hasFour(board, tops, row, col, player);
    board[row * COLS + col] = EMPTY;
    tops[col] = row;
    if (createsDirectFour) { threats.push(col); continue; }

    // 4. Killer / rest
    if (killSet.has(col)) threats.push(col);
    else rest.push(col);
  }

  // Sort rest by history heuristic (descending)
  rest.sort((a, b) => history[b] - history[a]);

  return [...wins, ...blocks, ...threats, ...rest];
}

// ─── Forced-sequence search (Threat Space Search) ────────────────────────────

/**
 * Look for a forced win within `horizon` plies by only examining moves that
 * create or respond to direct threats.  Returns the winning first move, or -1.
 *
 * This extends the regular search to avoid horizon-effect misses.
 */
function forcedWinSearch(
  board: Int8Array, tops: Int8Array, player: number, horizon: number,
): number {
  if (horizon <= 0) return -1;
  const opp = 3 - player;

  // Try all legal columns
  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;

    board[row * COLS + col] = player;
    tops[col] = row - 1;

    // Immediate win?
    if (isWinAt(board, row, col, player)) {
      undrop(board, tops, col, row);
      return col;
    }

    // Creates multiple threats → likely forced win
    const t = analyseThreat(board, tops, player);
    if (t.fours >= 2) {
      // Opponent can't block both
      undrop(board, tops, col, row);
      return col;
    }

    undrop(board, tops, col, row);
  }

  // Recurse: for each of our threat-creating moves, check if opponent's
  // forced responses lead to our win
  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;

    board[row * COLS + col] = player;
    tops[col] = row - 1;

    if (isWinAt(board, row, col, player)) {
      undrop(board, tops, col, row);
      return col;
    }

    const myThreats = analyseThreat(board, tops, player);
    if (myThreats.fours >= 1) {
      // Opponent must play the blocking move(s)
      let opponentLoses = true;
      for (const blockCol of myThreats.urgentCols) {
        const bRow = tops[blockCol];
        if (bRow < 0) { opponentLoses = false; break; }

        board[bRow * COLS + blockCol] = opp;
        tops[blockCol] = bRow - 1;

        if (isWinAt(board, bRow, blockCol, opp)) {
          // Opponent wins by blocking here — we don't win this line
          undrop(board, tops, blockCol, bRow);
          opponentLoses = false;
          break;
        }

        // After opponent blocks, do we still win?
        const continuation = forcedWinSearch(board, tops, player, horizon - 2);
        undrop(board, tops, blockCol, bRow);
        if (continuation < 0) { opponentLoses = false; break; }
      }

      undrop(board, tops, col, row);
      if (opponentLoses) return col;
    } else {
      undrop(board, tops, col, row);
    }
  }

  return -1;
}

// ─── Alpha-beta search ────────────────────────────────────────────────────────

let nodesVisited   = 0;
let searchStart    = 0;
let timesUp        = false;
let activeTimeLimit = TIME_LIMIT_MS;

/**
 * Negamax with alpha-beta pruning, transposition table, and killer heuristic.
 * Scores are relative to the current player (positive = good for player).
 *
 * @param player        player to move at this node
 * @param alpha         lower bound
 * @param beta          upper bound
 * @param depth         remaining search depth
 * @param moveCount     total pieces on board (for endgame evaluation)
 * @param hash          current Zobrist hash
 * @param inNullWindow  true if this is a null-window (PVS) probe
 */
function negamax(
  board: Int8Array,
  tops: Int8Array,
  player: number,
  alpha: number,
  beta: number,
  depth: number,
  moveCount: number,
  hash: number,
): number {
  // Time check every 2 048 nodes
  if ((++nodesVisited & 0x7FF) === 0) {
    if (Date.now() - searchStart >= activeTimeLimit) timesUp = true;
  }
  if (timesUp) return 0;

  // Transposition table lookup
  const ttIdx = (hash >>> 0) & TT_MASK;
  let ttBestMove = -1;
  if (ttKey[ttIdx] === (hash | 0)) {
    const storedDepth = ttDepth[ttIdx];
    if (storedDepth >= depth) {
      const s = ttScore[ttIdx];
      const f = ttFlag[ttIdx];
      if (f === FLAG_EXACT) return s;
      if (f === FLAG_UPPER && s >= beta)  return s;
      if (f === FLAG_LOWER && s <= alpha) return s;
    }
    ttBestMove = ttMove[ttIdx];
  }

  // Terminal: draw
  if (moveCount === CELLS) return 0;

  // Leaf node: evaluate
  if (depth <= 0) {
    return evaluate(board, tops, player, moveCount);
  }

  const opp = 3 - player;
  let bestScore = LOSS_SCORE - 1;
  let bestMove  = -1;
  const origAlpha = alpha;

  // Build ordered move list, injecting TT move at front
  const moves = orderedMoves(board, tops, player, depth);
  if (ttBestMove >= 0 && ttBestMove < COLS && tops[ttBestMove] >= 0) {
    const idx = moves.indexOf(ttBestMove);
    if (idx > 0) { moves.splice(idx, 1); moves.unshift(ttBestMove); }
    else if (idx < 0) moves.unshift(ttBestMove);
  }

  for (const col of moves) {
    const row = tops[col];
    if (row < 0) continue;

    board[row * COLS + col] = player;
    tops[col] = row - 1;
    const h2 = hash ^ zobrist[(row * COLS + col) * 2 + (player - 1)] ^ Z_SIDE;

    let score: number;
    if (isWinAt(board, row, col, player)) {
      score = WIN_SCORE - (ROWS * COLS - moveCount);
      undrop(board, tops, col, row);
      // Update TT and killers
      ttKey[ttIdx]   = hash | 0;
      ttDepth[ttIdx] = depth as any;
      ttScore[ttIdx] = score;
      ttFlag[ttIdx]  = FLAG_EXACT;
      ttMove[ttIdx]  = col;
      return score; // immediate win always best
    }

    // Adaptive extension: if move creates a direct four, extend 1 ply (forces resolution)
    const ext = hasFour(board, tops, row, col, player) ? 1 : 0;

    score = -negamax(board, tops, opp, -beta, -alpha, depth - 1 + ext, moveCount + 1, h2);
    undrop(board, tops, col, row);

    if (timesUp) return 0;

    if (score > bestScore) {
      bestScore = score;
      bestMove  = col;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // Beta cutoff: update killers and history
      if (killers[depth][0] !== col) {
        killers[depth][1] = killers[depth][0];
        killers[depth][0] = col;
      }
      history[col] += depth * depth;
      break;
    }
  }

  // Store in TT
  if (!timesUp && bestMove >= 0) {
    ttKey[ttIdx]   = hash | 0;
    ttDepth[ttIdx] = depth as any;
    ttScore[ttIdx] = bestScore;
    ttMove[ttIdx]  = bestMove;
    if (bestScore <= origAlpha)      ttFlag[ttIdx] = FLAG_LOWER;
    else if (bestScore >= beta)      ttFlag[ttIdx] = FLAG_UPPER;
    else                             ttFlag[ttIdx] = FLAG_EXACT;
  }

  return bestScore;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Choose a column to play in the given state.
 * Returns a legal column index (0-based), or -1 if there are no legal moves.
 *
 * @param timeLimitMs  Maximum search time in milliseconds (default 1 400).
 *                     Pass a smaller value (e.g. 200) for fast tests.
 * @param depthCap     Override the maximum iterative-deepening depth.
 *                     Default MAX_DEPTH. Set to e.g. 4 for fixed-depth benchmarks.
 */
export function chooseMove(
  state: GameState,
  timeLimitMs = TIME_LIMIT_MS,
  depthCap = MAX_DEPTH,
): number {
  if (state.status.kind !== 'ongoing') return -1;

  const board = boardToInt8(state.board as Board);
  const tops  = computeTops(board);
  const player = state.currentPlayer as number;
  const opp    = 3 - player;
  const moveCount = state.history.length;
  const effectiveLimit = timeLimitMs;

  // --- Collect legal moves ---
  const legal: number[] = [];
  for (const col of COL_ORDER) {
    if (tops[col] >= 0) legal.push(col);
  }
  if (legal.length === 0) return -1;
  if (legal.length === 1) return legal[0];

  // --- 1. Immediate win (always play it) ---
  for (const col of legal) {
    const row = tops[col];
    board[row * COLS + col] = player;
    if (isWinAt(board, row, col, player)) {
      board[row * COLS + col] = EMPTY;
      return col;
    }
    board[row * COLS + col] = EMPTY;
  }

  // --- 2. Forced block (opponent wins immediately) ---
  const mustBlockCols: number[] = [];
  for (const col of legal) {
    const row = tops[col];
    board[row * COLS + col] = opp;
    if (isWinAt(board, row, col, opp)) mustBlockCols.push(col);
    board[row * COLS + col] = EMPTY;
  }
  if (mustBlockCols.length === 1) return mustBlockCols[0];
  if (mustBlockCols.length > 1) {
    // Multiple forced blocks → we lose; still block one (best effort)
    return mustBlockCols[0];
  }

  // --- 3. Tactical Search (TSS) – Phase 3A complete implementation ---
  // tacticalSearch covers all five tactical features:
  //   double-four fork, four-three fork, double-three fork,
  //   multi-ply forced sequences, and trap setups.
  // It is a strict superset of the legacy forcedWinSearch below.
  const tssBoard = new Int8Array(board);
  const tssTops  = new Int8Array(tops);
  const tssResult = tacticalSearch(tssBoard, tssTops, player, TSS_HORIZON);
  if (tssResult.col >= 0) return tssResult.col;
  // Legacy forced-win search kept as belt-and-suspenders (different horizon/path).
  const forcedCol = forcedWinSearch(tssBoard, tssTops, player, 10);
  if (forcedCol >= 0) return forcedCol;

  // --- 4. Iterative deepening alpha-beta ---
  ttClear();
  clearKillersAndHistory();

  const hash = computeHash(board, player);
  let bestCol = legal[0];

  searchStart      = Date.now();
  timesUp          = false;
  nodesVisited     = 0;
  activeTimeLimit  = effectiveLimit;

  for (let depth = 1; depth <= depthCap; depth++) {
    if (timesUp) break;

    let alpha = LOSS_SCORE;
    const beta  = WIN_SCORE + 1;
    let iterBest = -1;
    let iterScore = LOSS_SCORE;

    const moves = orderedMoves(board, tops, player, depth);

    for (const col of moves) {
      const row = tops[col];
      if (row < 0) continue;

      board[row * COLS + col] = player;
      tops[col] = row - 1;
      const h2 = hash ^ zobrist[(row * COLS + col) * 2 + (player - 1)] ^ Z_SIDE;

      let score: number;
      if (isWinAt(board, row, col, player)) {
        score = WIN_SCORE - (ROWS * COLS - moveCount);
      } else {
        score = -negamax(board, tops, opp, -beta, -alpha, depth - 1, moveCount + 1, h2);
      }
      undrop(board, tops, col, row);

      if (timesUp) break;

      if (score > iterScore) {
        iterScore = score;
        iterBest  = col;
      }
      if (score > alpha) alpha = score;
      // Note: no beta cutoff at root (we want the best move)
    }

    if (!timesUp && iterBest >= 0) {
      bestCol = iterBest;
      // If we found a forced win, stop searching deeper
      if (iterScore >= WIN_SCORE - ROWS * COLS) break;
    }
  }

  return bestCol;
}
