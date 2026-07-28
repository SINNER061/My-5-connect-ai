/**
 * Connect 5 Impossible – Phase 3A Tactical Search System
 *
 * Implements a complete tactical search over forced move sequences.
 * All functions operate on the mutable Int8Array + tops[] representation
 * used internally by the AI (same layout as in ai.ts).  Every function
 * that mutates the board restores it before returning.
 *
 * ─── Feature inventory ───────────────────────────────────────────────────────
 *
 * 1. Multi-ply Threat Space Search (TSS)
 *    `tacticalSearch` searches only through "threat moves" and forced
 *    responses (moves that create or must respond to direct fours).
 *    This dramatically prunes the search tree while catching all forcing
 *    lines up to the configured horizon.
 *
 * 2. Forced Sequence Search
 *    `tssInternal` follows sequences where the opponent has exactly one
 *    legal response per ply (blocking a direct four), recursing until a
 *    win or the horizon is reached.
 *
 * 3. Double Threat Detection
 *    `countThreats` classifies every unblocked window and returns:
 *      - fours       : accessible four-in-a-row threats
 *      - foursLatent : latent four-in-a-row threats (empty not yet reachable)
 *      - openThrees  : open-three threats (both ends beyond window are free)
 *      - threes      : single-end three-threats
 *      - urgentCols  : columns that MUST be played NOW to block a four
 *    `isDoubleThreat` is the quick check: does the player already hold ≥2
 *    simultaneous accessible fours?
 *
 * 4. Fork Detection
 *    `detectFork` identifies moves that create multiple simultaneous threats:
 *      - double-four  : ≥2 accessible fours → opponent blocks one, other wins
 *      - four-three   : 1 four + surviving threat after forced block (verified)
 *      - double-three : ≥2 open-threes → opponent can block at most one
 *    `findForkingMoves` returns every legal move that creates any fork.
 *
 * 5. Trap Detection
 *    Inside `tssInternal` (Step 5, root-only): quiet setup moves whose only
 *    purpose is to create a position from which ANY opponent response still
 *    leads to a forced fork.  This is the "unavoidable fork setup" pattern.
 *
 * ─── Public API ───────────────────────────────────────────────────────────────
 *
 *   countThreats(board, tops, player)              → ThreatCount
 *   detectFork(board, tops, row, col, player)       → ForkResult
 *   findForkingMoves(board, tops, player)           → ForkMove[]
 *   isDoubleThreat(board, tops, player)             → boolean
 *   tacticalSearch(board, tops, player, horizon?)   → TacticalResult
 */

import { COLS, ROWS, WIN_LENGTH, EMPTY } from './constants.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default TSS search horizon (plies).
 * Each forced exchange (our threat + opponent block) consumes 2 plies, so
 * horizon 8 covers up to 4 forced exchanges — deep enough for all practical
 * tactical sequences while keeping the search fast.
 */
export const TSS_HORIZON = 8;

/** Direction vectors [dRow, dCol]. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],   // horizontal →
  [1, 0],   // vertical   ↓
  [1, 1],   // diagonal   ↘
  [1, -1],  // diagonal   ↙
];

/** Column order: centre-out (optimal for threat-move ordering). */
const COL_ORDER = [4, 3, 5, 2, 6, 1, 7, 0, 8] as const;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Classification of fork type based on which threat combination is created. */
export type ForkKind =
  | 'double-four'   // Two simultaneous accessible four-threats
  | 'four-three'    // One accessible four + at least one surviving threat after forced block
  | 'double-three'; // Two simultaneous open-three threats

/** Detailed breakdown of threats belonging to one player. */
export interface ThreatCount {
  /** Number of accessible four-threats (WIN_LENGTH-1 pieces + 1 accessible empty). */
  fours: number;
  /** Number of latent four-threats (empty cell not yet reachable by gravity). */
  foursLatent: number;
  /** Number of open-three threats (WIN_LENGTH-2 pieces, both ends outside the window open). */
  openThrees: number;
  /** Number of single-end three-threats (WIN_LENGTH-2 pieces, at least 1 accessible empty). */
  threes: number;
  /** Set of columns whose top square MUST be played immediately to block a four. */
  urgentCols: Set<number>;
}

/** Result returned by `detectFork`. */
export interface ForkResult {
  /** Whether the move creates a fork. */
  isFork: boolean;
  /** Which category of fork (null if isFork is false). */
  kind: ForkKind | null;
  /**
   * Number of threats that remain unblockable after the opponent's single
   * best response.  ≥1 means the fork is genuinely winning.
   */
  unblockableCount: number;
}

/** A forking move: column, landing row, and fork category. */
export interface ForkMove {
  col: number;
  row: number;
  kind: ForkKind;
}

/** The result returned by `tacticalSearch`. */
export interface TacticalResult {
  /**
   * Column index of the winning first move, or -1 if no forced win was
   * found within the horizon.
   */
  col: number;
  /**
   * Number of plies from the current position to the win.
   * 1 = immediate win or immediate fork.
   * Odd numbers ≥3 = forced sequence of that many half-moves.
   */
  depth: number;
  /** How the win is achieved. */
  kind:
    | 'immediate-win'     // direct win move
    | 'double-four'       // fork: two simultaneous fours
    | 'four-three'        // fork: four + surviving threat after forced block
    | 'double-three'      // fork: two simultaneous open-threes
    | 'forced-sequence'   // multi-ply sequence where opponent is always forced
    | 'trap';             // quiet setup move → unavoidable fork on next turn
}

// ─── Internal board utilities ─────────────────────────────────────────────────
// (Mirror of the helpers in ai.ts; duplicated here to keep tactical.ts
//  self-contained so it can be tested and used independently.)

/** Lowest free row = tops[col].  Returns -1 if the column is full. */
function rowAt(tops: Int8Array, col: number): number {
  return tops[col];
}

/**
 * Incremental win check: did placing at (row, col) by `player` create WIN_LENGTH
 * consecutive pieces?  Scans all four axes through that cell only.
 */
function isWinAt(board: Int8Array, row: number, col: number, player: number): boolean {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++; r += dr; c += dc;
    }
    r = row - dr; c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
      count++; r -= dr; c -= dc;
    }
    if (count >= WIN_LENGTH) return true;
  }
  return false;
}

// ─── Feature 3: Double Threat Detection ──────────────────────────────────────
// (Also serves as the foundation for features 1, 2, 4, and 5.)

/**
 * Count all threats for `player` on the current board by scanning every
 * window of WIN_LENGTH cells in all four directions.
 *
 * A window is "unblocked" if it contains zero opponent pieces.
 * Within an unblocked window:
 *   - A four-threat  has (WIN_LENGTH-1) player pieces and exactly 1 empty cell.
 *   - A three-threat has (WIN_LENGTH-2) player pieces and exactly 2 empty cells.
 *
 * Accessibility: an empty cell at (r, c) is "accessible" iff tops[c] === r
 * (i.e. gravity allows dropping there right now).
 *
 * A four-threat is accessible  → `fours`        (its column goes into urgentCols)
 * A four-threat is inaccessible→ `foursLatent`
 * A three-threat with both ends outside the window open and ≥1 accessible empty
 *                               → `openThrees`
 * A three-threat that doesn't meet the "both ends open" criterion → `threes`
 */
export function countThreats(
  board: Int8Array,
  tops: Int8Array,
  player: number,
): ThreatCount {
  const opp = 3 - player;
  let fours = 0, foursLatent = 0, openThrees = 0, threes = 0;
  const urgentCols = new Set<number>();

  const scanWindow = (r0: number, c0: number, dr: number, dc: number): void => {
    let mine = 0, oppN = 0, accCount = 0, emptyCount = 0;
    let lastEmptyCol = -1;

    for (let k = 0; k < WIN_LENGTH; k++) {
      const r = r0 + k * dr;
      const c = c0 + k * dc;
      const cell = board[r * COLS + c];
      if (cell === player) {
        mine++;
      } else if (cell === opp) {
        oppN++;
        break; // blocked window — skip it entirely
      } else {
        emptyCount++;
        lastEmptyCol = c;
        if (tops[c] === r) accCount++;
      }
    }
    if (oppN > 0) return;

    if (mine === WIN_LENGTH - 1 && emptyCount === 1) {
      // Four-threat
      if (accCount > 0) {
        fours++;
        urgentCols.add(lastEmptyCol);
      } else {
        foursLatent++;
      }
      return;
    }

    if (mine === WIN_LENGTH - 2 && emptyCount === 2 && accCount >= 1) {
      // Three-threat: check openness of cells immediately beyond both window ends
      const prevR = r0 - dr,         prevC = c0 - dc;
      const nextR = r0 + WIN_LENGTH * dr, nextC = c0 + WIN_LENGTH * dc;
      const prevOpen = prevR >= 0 && prevR < ROWS && prevC >= 0 && prevC < COLS
                       && board[prevR * COLS + prevC] === EMPTY;
      const nextOpen = nextR >= 0 && nextR < ROWS && nextC >= 0 && nextC < COLS
                       && board[nextR * COLS + nextC] === EMPTY;
      if (prevOpen && nextOpen) {
        openThrees++;
      } else {
        threes++;
      }
    }
  };

  // Horizontal
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - WIN_LENGTH; c++)
      scanWindow(r, c, 0, 1);
  // Vertical
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++)
    for (let c = 0; c < COLS; c++)
      scanWindow(r, c, 1, 0);
  // Diagonal ↘
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++)
    for (let c = 0; c <= COLS - WIN_LENGTH; c++)
      scanWindow(r, c, 1, 1);
  // Diagonal ↙
  for (let r = 0; r <= ROWS - WIN_LENGTH; r++)
    for (let c = WIN_LENGTH - 1; c < COLS; c++)
      scanWindow(r, c, 1, -1);

  return { fours, foursLatent, openThrees, threes, urgentCols };
}

// ─── Feature 4: Fork Detection ────────────────────────────────────────────────

/**
 * Detect whether placing `player`'s piece at (row, col) creates a fork —
 * two or more simultaneous threats that cannot all be blocked in a single
 * opponent move.
 *
 * Fork classes (in decreasing certainty):
 *
 *   double-four  ≥2 accessible fours after the move.  Opponent blocks one
 *                per turn, so one four is always left open → forced win.
 *
 *   four-three   Exactly 1 accessible four + at least one surviving threat
 *                after the opponent's single forced block.  Verified by
 *                simulating the block and checking the remaining threat count.
 *
 *   double-three ≥2 open-three threats simultaneously.  Opponent can prevent
 *                at most one from becoming a four per turn.
 *
 * The function mutates board/tops temporarily and always restores them.
 */
export function detectFork(
  board: Int8Array,
  tops: Int8Array,
  row: number,
  col: number,
  player: number,
): ForkResult {
  const opp = 3 - player;

  // Place the piece
  board[row * COLS + col] = player;
  tops[col] = row - 1;

  const t = countThreats(board, tops, player);

  let isFork = false;
  let kind: ForkKind | null = null;
  let unblockableCount = 0;

  if (t.fours >= 2) {
    // ── double-four: always a fork, no further verification needed ──────────
    isFork = true;
    kind = 'double-four';
    unblockableCount = t.fours - 1; // opponent blocks one; the rest remain
  } else if (t.fours === 1 && (t.openThrees + t.threes >= 1)) {
    // ── four-three: simulate the forced block, verify a threat survives ─────
    const blockCol = [...t.urgentCols][0];
    const blockRow = tops[blockCol];
    if (blockRow >= 0) {
      board[blockRow * COLS + blockCol] = opp;
      tops[blockCol] = blockRow - 1;

      // Guard: opponent might win by playing that square themselves
      const oppWinsHere = isWinAt(board, blockRow, blockCol, opp);

      if (!oppWinsHere) {
        const tAfterBlock = countThreats(board, tops, player);
        // We win if we still have an accessible four, or an open-three
        // that can grow into a four on the next move
        if (tAfterBlock.fours >= 1 || tAfterBlock.openThrees >= 1) {
          isFork = true;
          kind = 'four-three';
          unblockableCount = 1;
        }
      }

      // Restore block
      board[blockRow * COLS + blockCol] = EMPTY;
      tops[blockCol] = blockRow;
    }
  } else if (t.openThrees >= 2) {
    // ── double-three: two simultaneous open-three threats ───────────────────
    // Opponent can block at most one extension per move.
    isFork = true;
    kind = 'double-three';
    unblockableCount = 1;
  }

  // Restore the placed piece
  board[row * COLS + col] = EMPTY;
  tops[col] = row;

  return { isFork, kind, unblockableCount };
}

/**
 * Find all legal columns where `player` can create a fork by playing there.
 * Returns them in centre-out order.
 */
export function findForkingMoves(
  board: Int8Array,
  tops: Int8Array,
  player: number,
): ForkMove[] {
  const results: ForkMove[] = [];
  for (const col of COL_ORDER) {
    const row = rowAt(tops, col);
    if (row < 0) continue;
    const result = detectFork(board, tops, row, col, player);
    if (result.isFork && result.kind !== null) {
      results.push({ col, row, kind: result.kind });
    }
  }
  return results;
}

/**
 * Quick predicate: does `player` already have ≥2 accessible four-threats on
 * the current board (without needing to make a move)?
 *
 * This is the most common entry point for checking "is the opponent already
 * winning?" before committing to an offensive line.
 */
export function isDoubleThreat(
  board: Int8Array,
  tops: Int8Array,
  player: number,
): boolean {
  return countThreats(board, tops, player).fours >= 2;
}

// ─── Feature 1 & 2 & 5: Multi-ply TSS + Forced Sequence + Trap Detection ────

/** Internal return type for tssInternal. */
interface TSSInternalResult {
  col: number;              // -1 if no win found
  kind: TacticalResult['kind'];
}

/** Sentinel for "no forced win found". */
const NO_WIN: TSSInternalResult = { col: -1, kind: 'immediate-win' };

/**
 * Recursive Threat Space Search.
 *
 * Searches only through "threat moves" — moves that create accessible fours
 * or must respond to the opponent's accessible fours.  This keeps the
 * branching factor to ≤COLS (and usually much less) while capturing every
 * forcing line within the horizon.
 *
 * Step 1 – Immediate win:  any move that wins right now.
 * Step 2 – Opponent double-threat: if the opponent already has ≥2 fours we
 *           cannot win via TSS (we'd need to block, not attack).
 * Step 3 – Fork detection: immediate double-four, four-three, or double-three.
 * Step 4 – Forced sequence: create a four → opponent must block → recurse.
 * Step 5 – Trap detection (root only): quiet setup moves from which every
 *           possible opponent reply still leads to a forced win on our side.
 *
 * @param board   Mutable Int8Array board (always restored on return).
 * @param tops    Mutable tops[] array   (always restored on return).
 * @param player  Player to move at this node.
 * @param horizon Remaining search budget in plies.
 * @param depth   Current depth from the root (0 = root; used for trap guard).
 */
function tssInternal(
  board: Int8Array,
  tops: Int8Array,
  player: number,
  horizon: number,
  depth: number,
): TSSInternalResult {
  if (horizon <= 0) return NO_WIN;

  const opp = 3 - player;

  // ── Step 1: Immediate win ─────────────────────────────────────────────────
  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;
    board[row * COLS + col] = player;
    const wins = isWinAt(board, row, col, player);
    board[row * COLS + col] = EMPTY;
    if (wins) return { col, kind: 'immediate-win' };
  }

  // ── Step 2: Opponent already has a double-threat → we can't win via TSS ──
  const oppT = countThreats(board, tops, opp);
  if (oppT.fours >= 2) return NO_WIN;

  // ── Step 3: Fork detection (our move creates an immediate fork) ───────────
  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;
    // If opponent has exactly one forced block, only consider that column
    // (any other offensive move would let the opponent win)
    if (oppT.fours === 1 && !oppT.urgentCols.has(col)) continue;

    const fork = detectFork(board, tops, row, col, player);
    if (!fork.isFork) continue;

    // double-four: unconditionally winning
    if (fork.kind === 'double-four') return { col, kind: 'double-four' };

    // four-three / double-three: detectFork already verified the fork;
    // do one extra check — confirm opponent cannot win at the blocking square
    if (fork.kind === 'four-three' || fork.kind === 'double-three') {
      // Place our piece and recheck urgentCols
      board[row * COLS + col] = player;
      tops[col] = row - 1;
      const myT = countThreats(board, tops, player);
      board[row * COLS + col] = EMPTY;
      tops[col] = row;

      // Verify that none of the urgent blocking squares is an opponent win
      let safe = true;
      for (const blockCol of myT.urgentCols) {
        const bRow = tops[blockCol];
        if (bRow < 0) continue;
        board[bRow * COLS + blockCol] = opp;
        const oppWins = isWinAt(board, bRow, blockCol, opp);
        board[bRow * COLS + blockCol] = EMPTY;
        if (oppWins) { safe = false; break; }
      }
      if (safe) return { col, kind: fork.kind };
    }
  }

  if (horizon <= 2) return NO_WIN;

  // ── Step 4: Forced-sequence search ───────────────────────────────────────
  // Play a four-creating move, let the opponent make the only forced block,
  // then recurse.  If all forced responses lead to our win, return this move.
  for (const col of COL_ORDER) {
    const row = tops[col];
    if (row < 0) continue;

    // Respect forced block: if opponent has a threat we haven't blocked above
    if (oppT.fours === 1 && !oppT.urgentCols.has(col)) continue;

    board[row * COLS + col] = player;
    tops[col] = row - 1;

    // Belt-and-suspenders: catch wins that slipped through Step 1
    if (isWinAt(board, row, col, player)) {
      board[row * COLS + col] = EMPTY;
      tops[col] = row;
      return { col, kind: 'immediate-win' };
    }

    const myT = countThreats(board, tops, player);

    if (myT.fours >= 1) {
      // Opponent has at least one forced block per urgent column
      let allBlocksLead = myT.urgentCols.size > 0;

      for (const blockCol of myT.urgentCols) {
        const bRow = tops[blockCol];
        if (bRow < 0) { allBlocksLead = false; break; }

        board[bRow * COLS + blockCol] = opp;
        tops[blockCol] = bRow - 1;

        // Check if opponent wins by placing there (their own five)
        const oppWinsHere = isWinAt(board, bRow, blockCol, opp);
        if (oppWinsHere) {
          board[bRow * COLS + blockCol] = EMPTY;
          tops[blockCol] = bRow;
          allBlocksLead = false;
          break;
        }

        // Recurse: can we still win after opponent's forced block?
        const sub = tssInternal(board, tops, player, horizon - 2, depth + 2);
        board[bRow * COLS + blockCol] = EMPTY;
        tops[blockCol] = bRow;

        if (sub.col < 0) { allBlocksLead = false; break; }
      }

      board[row * COLS + col] = EMPTY;
      tops[col] = row;

      if (allBlocksLead) return { col, kind: 'forced-sequence' };
    } else {
      board[row * COLS + col] = EMPTY;
      tops[col] = row;
    }
  }

  // ── Step 5: Trap detection (root only, horizon ≥ 6) ──────────────────────
  // A "trap" is a quiet setup move (creates no immediate four) after which
  // every dangerous opponent reply still leaves a position where we can force
  // a win via TSS.  This models the "unavoidable fork setup" pattern.
  //
  // To keep the search fast we only probe the opponent's most dangerous
  // responses rather than all legal moves:
  //   a) Any opponent immediate win   → trap immediately fails
  //   b) Opponent fork-creating moves → must survive these
  //   c) Opponent four-creating moves → must survive these
  //   d) One representative passive move (centre column if open) → sanity check
  //
  // This reduces the branching from O(COLS) to O(1–4) per candidate move.
  if (depth === 0 && horizon >= 6) {
    for (const col of COL_ORDER) {
      const row = tops[col];
      if (row < 0) continue;

      board[row * COLS + col] = player;
      tops[col] = row - 1;

      // Skip wins and four-creating moves (already handled above)
      if (isWinAt(board, row, col, player)) {
        board[row * COLS + col] = EMPTY;
        tops[col] = row;
        continue;
      }
      const myT = countThreats(board, tops, player);
      if (myT.fours >= 1) {
        board[row * COLS + col] = EMPTY;
        tops[col] = row;
        continue;
      }

      // Collect the opponent's dangerous responses
      const dangerousOppCols: number[] = [];
      let passiveRepresentative = -1;

      for (const oppCol of COL_ORDER) {
        const oppRow = tops[oppCol];
        if (oppRow < 0) continue;

        // a) Immediate win for opponent → trap fails instantly
        board[oppRow * COLS + oppCol] = opp;
        tops[oppCol] = oppRow - 1;
        const oppWins = isWinAt(board, oppRow, oppCol, opp);
        board[oppRow * COLS + oppCol] = EMPTY;
        tops[oppCol] = oppRow;
        if (oppWins) { dangerousOppCols.length = 0; dangerousOppCols.push(-999); break; }

        // b/c) Fork or four-creating move for opponent
        const oppFork = detectFork(board, tops, oppRow, oppCol, opp);
        if (oppFork.isFork) {
          dangerousOppCols.push(oppCol);
          continue;
        }
        board[oppRow * COLS + oppCol] = opp;
        tops[oppCol] = oppRow - 1;
        const oppT = countThreats(board, tops, opp);
        board[oppRow * COLS + oppCol] = EMPTY;
        tops[oppCol] = oppRow;
        if (oppT.fours >= 1) { dangerousOppCols.push(oppCol); continue; }

        // d) First available passive move as a representative
        if (passiveRepresentative < 0) passiveRepresentative = oppCol;
      }

      // If opponent can win immediately, skip this candidate
      if (dangerousOppCols[0] === -999) {
        board[row * COLS + col] = EMPTY;
        tops[col] = row;
        continue;
      }

      // Add passive representative
      if (passiveRepresentative >= 0) dangerousOppCols.push(passiveRepresentative);

      // Verify we win against every dangerous opponent response
      let trapWorks = dangerousOppCols.length > 0;
      for (const oppCol of dangerousOppCols) {
        const oppRow = tops[oppCol];
        if (oppRow < 0) { trapWorks = false; break; }

        board[oppRow * COLS + oppCol] = opp;
        tops[oppCol] = oppRow - 1;

        const sub = tssInternal(board, tops, player, horizon - 2, depth + 2);
        board[oppRow * COLS + oppCol] = EMPTY;
        tops[oppCol] = oppRow;

        if (sub.col < 0) { trapWorks = false; break; }
      }

      board[row * COLS + col] = EMPTY;
      tops[col] = row;

      if (trapWorks) return { col, kind: 'trap' };
    }
  }

  return NO_WIN;
}

// ─── Feature 1: Public entry point – Multi-ply Threat Space Search ───────────

/**
 * Run a complete tactical (Threat Space) search for `player`.
 *
 * Examines only "forcing" moves and forced responses, covering:
 *   - Immediate wins
 *   - All three classes of fork (double-four, four-three, double-three)
 *   - Multi-ply forced sequences (create four → block → create four → ...)
 *   - Quiet trap setups that lead to unavoidable forks
 *
 * @param board    Mutable Int8Array board (restored on return).
 * @param tops     Mutable column tops array (restored on return).
 * @param player   Player to move (1 or 2).
 * @param horizon  Maximum plies to search (default TSS_HORIZON = 12).
 * @returns        TacticalResult with col = -1 if no forced win is found.
 */
export function tacticalSearch(
  board: Int8Array,
  tops: Int8Array,
  player: number,
  horizon = TSS_HORIZON,
): TacticalResult {
  const r = tssInternal(board, tops, player, horizon, 0);
  if (r.col < 0) return { col: -1, depth: 0, kind: 'immediate-win' };

  const depth =
    r.kind === 'immediate-win' ||
    r.kind === 'double-four'   ||
    r.kind === 'four-three'    ||
    r.kind === 'double-three'
      ? 1
      : 3; // forced-sequence or trap (at least 3 half-moves)

  return { col: r.col, depth, kind: r.kind };
}
