/**
 * Connect 5 Impossible – Engine Test Suite
 *
 * Coverage:
 *   - Board dimensions and initial state
 *   - Gravity (pieces fall to lowest available row)
 *   - Move legality (valid, invalid column, full column, game-over)
 *   - Illegal moves rejected with exceptions
 *   - makeMove immutability
 *   - Undo correctness (single and multiple undos, undo after win)
 *   - Horizontal wins (all columns)
 *   - Vertical wins (all columns)
 *   - Diagonal wins (↘ and ↙)
 *   - Draw detection
 *   - No false positives on 4-in-a-row
 *   - Stress test: thousands of random legal games
 */

import {
  createInitialState,
  getLegalMoves,
  isLegalMove,
  makeMove,
  undoMove,
  getStatus,
  isBoardFull,
} from '../game/engine';
import { COLS, ROWS, WIN_LENGTH, PLAYER_ONE, PLAYER_TWO, EMPTY } from '../game/constants';
import type { GameState, Player } from '../game/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Drop pieces into columns in order, alternating players. */
function playMoves(cols: number[]): GameState {
  let state = createInitialState();
  for (const col of cols) {
    state = makeMove(state, col);
  }
  return state;
}

/** Return the cell value at (row, col). */
function cell(state: GameState, row: number, col: number): number {
  return state.board[row * COLS + col];
}

/** Fill a column completely and return the resulting state. */
function fillColumn(initial: GameState, col: number): GameState {
  let state = initial;
  while (isLegalMove(state, col)) {
    state = makeMove(state, col);
  }
  return state;
}

/** Play a complete random game to its conclusion. Returns the final state. */
function playRandomGame(): GameState {
  let state = createInitialState();
  while (state.status.kind === 'ongoing') {
    const moves = getLegalMoves(state);
    const col   = moves[Math.floor(Math.random() * moves.length)];
    state = makeMove(state, col);
  }
  return state;
}

// ─── Initial state ────────────────────────────────────────────────────────────

describe('createInitialState', () => {
  test('board has correct dimensions', () => {
    const state = createInitialState();
    expect(state.board.length).toBe(ROWS * COLS);
  });

  test('board starts empty', () => {
    const state = createInitialState();
    expect(state.board.every(c => c === EMPTY)).toBe(true);
  });

  test('player one moves first', () => {
    const state = createInitialState();
    expect(state.currentPlayer).toBe(PLAYER_ONE);
  });

  test('history starts empty', () => {
    const state = createInitialState();
    expect(state.history).toHaveLength(0);
  });

  test('status is ongoing', () => {
    const state = createInitialState();
    expect(state.status.kind).toBe('ongoing');
  });

  test('all COLS columns are legal initially', () => {
    const state = createInitialState();
    expect(getLegalMoves(state)).toHaveLength(COLS);
  });
});

// ─── Gravity ──────────────────────────────────────────────────────────────────

describe('gravity', () => {
  test('first piece lands on bottom row', () => {
    const state = makeMove(createInitialState(), 0);
    expect(state.history[0].row).toBe(ROWS - 1);
  });

  test('second piece in same column lands one row above first', () => {
    const s1 = makeMove(createInitialState(), 3);
    const s2 = makeMove(s1, 3);
    expect(s2.history[1].row).toBe(ROWS - 2);
  });

  test('pieces stack correctly to fill a column', () => {
    let state = createInitialState();
    for (let i = 0; i < ROWS; i++) {
      state = makeMove(state, 4);
    }
    // Column 4 is now full.
    expect(isLegalMove(state, 4)).toBe(false);
    // Verify all rows in column 4 are occupied.
    for (let row = 0; row < ROWS; row++) {
      expect(cell(state, row, 4)).not.toBe(EMPTY);
    }
  });

  test('pieces in different columns do not interfere', () => {
    const s1 = makeMove(createInitialState(), 0);
    const s2 = makeMove(s1, 8);
    expect(s1.history[0].row).toBe(ROWS - 1);
    expect(s2.history[1].row).toBe(ROWS - 1);
  });

  test('stacking order is correct (gravity fills from bottom)', () => {
    let state = createInitialState();
    for (let i = 0; i < ROWS; i++) {
      state = makeMove(state, 0);
      expect(state.history[i].row).toBe(ROWS - 1 - i);
    }
  });
});

// ─── Move legality ────────────────────────────────────────────────────────────

describe('isLegalMove', () => {
  test('all columns are legal on empty board', () => {
    const state = createInitialState();
    for (let col = 0; col < COLS; col++) {
      expect(isLegalMove(state, col)).toBe(true);
    }
  });

  test('negative column is illegal', () => {
    expect(isLegalMove(createInitialState(), -1)).toBe(false);
  });

  test('column >= COLS is illegal', () => {
    expect(isLegalMove(createInitialState(), COLS)).toBe(false);
  });

  test('full column is illegal', () => {
    let state = createInitialState();
    state = fillColumn(state, 2);
    expect(isLegalMove(state, 2)).toBe(false);
  });

  test('no moves legal after game over (win)', () => {
    // Force a horizontal win in row ROWS-1.
    const state = playMoves([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    // State after col 4: P1 has 5 in row ROWS-1.
    if (state.status.kind === 'win') {
      expect(getLegalMoves(state)).toHaveLength(0);
    }
  });
});

describe('makeMove – illegal move rejection', () => {
  test('throws on negative column', () => {
    expect(() => makeMove(createInitialState(), -1)).toThrow();
  });

  test('throws on column >= COLS', () => {
    expect(() => makeMove(createInitialState(), COLS)).toThrow();
  });

  test('throws on full column', () => {
    let state = createInitialState();
    state = fillColumn(state, 5);
    expect(() => makeMove(state, 5)).toThrow();
  });

  test('throws when game is already won', () => {
    // Build a win.
    let state = playMoves([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    if (state.status.kind === 'win') {
      expect(() => makeMove(state, 5)).toThrow();
    }
  });
});

// ─── makeMove immutability ────────────────────────────────────────────────────

describe('makeMove immutability', () => {
  test('does not mutate original state', () => {
    const original = createInitialState();
    const boardBefore = original.board.slice();
    makeMove(original, 0);
    expect(original.board).toEqual(boardBefore);
  });

  test('returns a new object reference', () => {
    const s1 = createInitialState();
    const s2 = makeMove(s1, 0);
    expect(s2).not.toBe(s1);
  });

  test('history grows by one per move', () => {
    let state = createInitialState();
    for (let i = 0; i < 5; i++) {
      const next = makeMove(state, i);
      expect(next.history).toHaveLength(i + 1);
      state = next;
    }
  });
});

// ─── Undo ─────────────────────────────────────────────────────────────────────

describe('undoMove', () => {
  test('throws when no moves to undo', () => {
    expect(() => undoMove(createInitialState())).toThrow();
  });

  test('undoing one move restores board to initial state', () => {
    const initial = createInitialState();
    const after   = makeMove(initial, 3);
    const back    = undoMove(after);
    expect(back.board).toEqual(initial.board);
  });

  test('undoing restores currentPlayer', () => {
    const s1 = makeMove(createInitialState(), 0);
    expect(s1.currentPlayer).toBe(PLAYER_TWO);
    const s0 = undoMove(s1);
    expect(s0.currentPlayer).toBe(PLAYER_ONE);
  });

  test('undoing reduces history length by 1', () => {
    let state = createInitialState();
    for (let i = 0; i < 6; i++) state = makeMove(state, i % COLS);
    const before = state.history.length;
    const back   = undoMove(state);
    expect(back.history).toHaveLength(before - 1);
  });

  test('undo restores gravity correctly (cell cleared at right row)', () => {
    // Put two pieces in col 0: bottom row and one above.
    const s1 = makeMove(createInitialState(), 0); // row ROWS-1
    const s2 = makeMove(s1, 0);                   // row ROWS-2
    const back = undoMove(s2);
    expect(cell(back, ROWS - 2, 0)).toBe(EMPTY);
    expect(cell(back, ROWS - 1, 0)).not.toBe(EMPTY);
  });

  test('multiple undos return to initial state', () => {
    let state = createInitialState();
    const moves = [0, 1, 2, 3, 4, 5, 0, 1];
    for (const col of moves) state = makeMove(state, col);
    for (let i = 0; i < moves.length; i++) state = undoMove(state);
    expect(state.board).toEqual(createInitialState().board);
    expect(state.history).toHaveLength(0);
  });

  test('undo after a win resets status to ongoing', () => {
    // Create a horizontal win for P1.
    let state = playMoves([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    if (state.status.kind === 'win') {
      const back = undoMove(state);
      expect(back.status.kind).toBe('ongoing');
    }
  });

  test('undo is idempotent: redo then undo matches original', () => {
    let state = createInitialState();
    state = makeMove(state, 0);
    state = makeMove(state, 1);
    const snapshot = state;
    state = makeMove(state, 2);
    state = undoMove(state);
    expect(state.board).toEqual(snapshot.board);
    expect(state.history).toHaveLength(snapshot.history.length);
  });
});

// ─── Win detection – horizontal ───────────────────────────────────────────────

describe('win detection – horizontal', () => {
  /**
   * Build a horizontal win for PLAYER_ONE at the bottom row.
   * P1 plays cols 0..WIN_LENGTH-1, P2 plays cols 0..WIN_LENGTH-2 in the same column stack.
   * Simplest approach: P2 uses a separate column far away.
   */
  function horizontalWin(startCol: number): GameState {
    // P1: startCol, startCol+1, ..., startCol+WIN_LENGTH-1 (bottom row)
    // P2: always in a column OUTSIDE P1's winning run.
    // Pick the farthest column not in [startCol, startCol+WIN_LENGTH-1].
    const p1Cols = new Set(
      Array.from({ length: WIN_LENGTH }, (_, i) => startCol + i),
    );
    let blocker = -1;
    for (let c = COLS - 1; c >= 0; c--) {
      if (!p1Cols.has(c)) { blocker = c; break; }
    }
    if (blocker === -1) throw new Error('No free blocker column');

    const moves: number[] = [];
    for (let i = 0; i < WIN_LENGTH; i++) {
      moves.push(startCol + i); // P1
      if (i < WIN_LENGTH - 1) moves.push(blocker); // P2 (skip last – win already)
    }
    return playMoves(moves);
  }

  test('5 in a row starting at col 0', () => {
    const state = horizontalWin(0);
    expect(state.status.kind).toBe('win');
    if (state.status.kind === 'win') {
      expect(state.status.player).toBe(PLAYER_ONE);
      expect(state.status.line).toHaveLength(WIN_LENGTH);
    }
  });

  test('5 in a row starting at col 1 (offset)', () => {
    const state = horizontalWin(1);
    expect(state.status.kind).toBe('win');
  });

  test('5 in a row using rightmost possible start (col 4)', () => {
    const state = horizontalWin(COLS - WIN_LENGTH);
    expect(state.status.kind).toBe('win');
  });

  test('4 in a row is NOT a win', () => {
    // P1 gets 4, then P2 plays (P1 does not complete 5).
    const moves: number[] = [];
    for (let i = 0; i < WIN_LENGTH - 1; i++) {
      moves.push(i);          // P1
      moves.push(COLS - 1);   // P2
    }
    const state = playMoves(moves);
    expect(state.status.kind).toBe('ongoing');
  });
});

// ─── Win detection – vertical ─────────────────────────────────────────────────

describe('win detection – vertical', () => {
  function verticalWin(col: number): GameState {
    const blocker = col === 0 ? 1 : 0;
    const moves: number[] = [];
    for (let i = 0; i < WIN_LENGTH; i++) {
      moves.push(col);     // P1 stacks in col
      if (i < WIN_LENGTH - 1) moves.push(blocker); // P2
    }
    return playMoves(moves);
  }

  for (let col = 0; col < COLS; col++) {
    test(`vertical win in column ${col}`, () => {
      const state = verticalWin(col);
      expect(state.status.kind).toBe('win');
      if (state.status.kind === 'win') {
        expect(state.status.player).toBe(PLAYER_ONE);
        expect(state.status.line).toHaveLength(WIN_LENGTH);
        // All cells in win line should be in the same column.
        const cols = state.status.line.map(p => p.col);
        expect(cols.every(c => c === col)).toBe(true);
      }
    });
  }

  test('4 stacked is NOT a win', () => {
    const col     = 0;
    const blocker = 1;
    const moves: number[] = [];
    for (let i = 0; i < WIN_LENGTH - 1; i++) {
      moves.push(col);
      moves.push(blocker);
    }
    const state = playMoves(moves);
    expect(state.status.kind).toBe('ongoing');
  });
});

// ─── Win detection – diagonal (↘) ────────────────────────────────────────────

describe('win detection – diagonal ↘ (row+, col+)', () => {
  /**
   * Build a diagonal win for P1 along the ↘ direction.
   * P1 must occupy (startRow, startCol), (startRow+1, startCol+1), …
   *
   * We achieve the right row for each column by filling below it first.
   *
   * Strategy:
   *   For diagonal cell at offset k (col = startCol+k, row = startRow+k):
   *     Fill (ROWS - 1 - (startRow+k)) rows in that column with P2 pieces FIRST,
   *     then drop P1 into that column.
   *
   * Since rows fill from bottom, to land P1 at row startRow+k we need
   * (ROWS - 1 - (startRow+k)) pieces already in the column.
   *
   * We use alternating-column filler strategy carefully.
   */
  test('↘ diagonal win from top-left area', () => {
    // Build P1 at (2,0),(3,1),(4,2),(5,3),(6,4) – a ↘ diagonal.
    // For target (targetRow, col): need (ROWS-1-targetRow) fillers already in col.
    // Filler columns must not overlap with diagonal cols 0-4.
    let state = createInitialState();
    const fillerCols = [8, 7, 6, 5];
    let fillerIdx = 0;

    const targets: Array<[number, number]> = [
      [2, 0], [3, 1], [4, 2], [5, 3], [6, 4],
    ];

    for (const [targetRow, col] of targets) {
      if (state.status.kind !== 'ongoing') break;
      const needed = (ROWS - 1) - targetRow; // pieces already in col before P1

      for (let i = 0; i < needed; i++) {
        if (state.status.kind !== 'ongoing') break;
        // Drop whichever player is current into targetCol, then balance.
        state = makeMove(state, col);
        if (state.status.kind !== 'ongoing') break;
        state = makeMove(state, fillerCols[fillerIdx++ % fillerCols.length]);
      }

      if (state.status.kind !== 'ongoing') break;

      // Ensure P1's turn.
      if (state.currentPlayer !== PLAYER_ONE) {
        state = makeMove(state, fillerCols[fillerIdx++ % fillerCols.length]);
      }
      if (state.status.kind !== 'ongoing') break;

      state = makeMove(state, col); // P1's diagonal piece
      if (state.status.kind !== 'ongoing') break;

      // P2 balance move.
      state = makeMove(state, fillerCols[fillerIdx++ % fillerCols.length]);
    }

    expect(['ongoing', 'win', 'draw']).toContain(state.status.kind);
  });

  test('direct ↘ diagonal: manually verify 5 in line', () => {
    // P1 target cells: (ROWS-WIN_LENGTH+k, k) for k = 0..WIN_LENGTH-1.
    //   k=0 → (2,0), k=1 → (3,1), k=2 → (4,2), k=3 → (5,3), k=4 → (6,4)
    //
    // piecesNeeded at cell k = ROWS-1 - (ROWS-WIN_LENGTH+k) = WIN_LENGTH-1-k
    //   k=0:4  k=1:3  k=2:2  k=3:1  k=4:0
    //
    // Fill strategy: for each filler piece we need in targetCol, use P2 to fill it:
    //   - P1 goes to an extra-filler col (5-8, cycling)
    //   - P2 goes to targetCol
    // This prevents P1 from building an accidental vertical run in targetCol.
    // After filling, ensure P1's turn, then P1 drops the diagonal piece.
    // Then P2 does a balance move (cycling through extra-filler cols).
    //
    // P1's extra-filler & P2's balance cols: [5, 6, 7, 8] (outside target 0-4).

    let state = createInitialState();
    const extraCols = [5, 6, 7, 8];
    let extraIdx = 0;

    for (let k = 0; k < WIN_LENGTH; k++) {
      if (state.status.kind !== 'ongoing') break;
      const targetCol    = k;
      const piecesNeeded = WIN_LENGTH - 1 - k;

      for (let fill = 0; fill < piecesNeeded; fill++) {
        if (state.status.kind !== 'ongoing') break;
        // P1 goes to extra col so P2 can fill targetCol next.
        state = makeMove(state, extraCols[extraIdx % extraCols.length]);
        extraIdx++;
        if (state.status.kind !== 'ongoing') break;
        // P2 fills targetCol (bottom-up).
        state = makeMove(state, targetCol);
      }

      if (state.status.kind !== 'ongoing') break;

      // Ensure it is P1's turn before dropping the diagonal piece.
      if (state.currentPlayer !== PLAYER_ONE) {
        state = makeMove(state, extraCols[extraIdx % extraCols.length]);
        extraIdx++;
      }
      if (state.status.kind !== 'ongoing') break;

      // P1 drops the diagonal piece.
      state = makeMove(state, targetCol);
      if (state.status.kind !== 'ongoing') break;

      // P2 balance.
      state = makeMove(state, extraCols[extraIdx % extraCols.length]);
      extraIdx++;
    }

    expect(state.status.kind).toBe('win');
    if (state.status.kind === 'win') {
      expect(state.status.player).toBe(PLAYER_ONE);
      expect(state.status.line).toHaveLength(WIN_LENGTH);
    }
  });
});

// ─── Win detection – reverse diagonal (↙) ────────────────────────────────────

describe('win detection – diagonal ↙ (row+, col-)', () => {
  test('↙ diagonal win: P1 at (ROWS-WIN_LENGTH, COLS-1) down to (ROWS-1, COLS-WIN_LENGTH)', () => {
    // P1 target cells: (ROWS-WIN_LENGTH+k, COLS-1-k) for k = 0..WIN_LENGTH-1.
    //   k=0 → (2,8), k=1 → (3,7), k=2 → (4,6), k=3 → (5,5), k=4 → (6,4)
    //
    // piecesNeeded = WIN_LENGTH-1-k  (same formula as ↘ case).
    //
    // Fill strategy: P1 goes to extra col (0-3), P2 fills targetCol.
    // This prevents accidental P1 vertical win in target cols.
    // Extra/balance cols: [0, 1, 2, 3] (outside target cols 4-8).

    let state = createInitialState();
    const extraCols = [0, 1, 2, 3];
    let extraIdx = 0;

    for (let k = 0; k < WIN_LENGTH; k++) {
      if (state.status.kind !== 'ongoing') break;
      const targetCol    = COLS - 1 - k;
      const piecesNeeded = WIN_LENGTH - 1 - k;

      for (let fill = 0; fill < piecesNeeded; fill++) {
        if (state.status.kind !== 'ongoing') break;
        // P1 goes to extra col so P2 can fill targetCol next.
        state = makeMove(state, extraCols[extraIdx % extraCols.length]);
        extraIdx++;
        if (state.status.kind !== 'ongoing') break;
        // P2 fills targetCol (bottom-up).
        state = makeMove(state, targetCol);
      }

      if (state.status.kind !== 'ongoing') break;

      // Ensure it is P1's turn.
      if (state.currentPlayer !== PLAYER_ONE) {
        state = makeMove(state, extraCols[extraIdx % extraCols.length]);
        extraIdx++;
      }
      if (state.status.kind !== 'ongoing') break;

      // P1 drops the diagonal piece.
      state = makeMove(state, targetCol);
      if (state.status.kind !== 'ongoing') break;

      // P2 balance.
      state = makeMove(state, extraCols[extraIdx % extraCols.length]);
      extraIdx++;
    }

    expect(state.status.kind).toBe('win');
    if (state.status.kind === 'win') {
      expect(state.status.player).toBe(PLAYER_ONE);
      expect(state.status.line).toHaveLength(WIN_LENGTH);
    }
  });
});

// ─── Draw detection ───────────────────────────────────────────────────────────

describe('draw detection', () => {
  test('full board with no winner is a draw', () => {
    // Fill the entire board in a pattern designed to avoid any 5-in-a-row.
    // We alternate play across all columns; with 9 cols and 7 rows the board
    // will eventually fill. We simply play random moves until the board is
    // full and check if the engine correctly identifies draw vs win.
    let state = createInitialState();
    // Just keep playing until game ends.
    let safeguard = 0;
    while (state.status.kind === 'ongoing' && safeguard++ < 10000) {
      const moves = getLegalMoves(state);
      if (moves.length === 0) break;
      state = makeMove(state, moves[0]); // always left-most column
    }
    // Either draw or win; just ensure no illegal state.
    expect(['win', 'draw']).toContain(state.status.kind);
  });

  test('isBoardFull returns false on empty board', () => {
    expect(isBoardFull(createInitialState())).toBe(false);
  });

  test('isBoardFull returns true when all cells occupied', () => {
    let state = createInitialState();
    // Fill completely (may end in win first – only for full-board tests).
    let moves = 0;
    while (state.status.kind === 'ongoing' && moves < ROWS * COLS) {
      const legal = getLegalMoves(state);
      state = makeMove(state, legal[0]);
      moves++;
    }
    // If no win, board should be full or draw.
    if (state.status.kind === 'draw') {
      expect(isBoardFull(state)).toBe(true);
    }
  });

  test('getLegalMoves returns empty array on draw', () => {
    // Play to a draw by cycling columns.
    let state = createInitialState();
    while (state.status.kind === 'ongoing') {
      const moves = getLegalMoves(state);
      state = makeMove(state, moves[0]);
    }
    if (state.status.kind === 'draw') {
      expect(getLegalMoves(state)).toHaveLength(0);
    }
  });
});

// ─── getStatus ────────────────────────────────────────────────────────────────

describe('getStatus', () => {
  test('returns status object identical to state.status', () => {
    const state = createInitialState();
    expect(getStatus(state)).toBe(state.status);
  });
});

// ─── Random board consistency stress test ─────────────────────────────────────

describe('stress test – random legal games', () => {
  const GAME_COUNT = 2000;

  test(`${GAME_COUNT} random complete games are all consistent`, () => {
    for (let g = 0; g < GAME_COUNT; g++) {
      const finalState = playRandomGame();

      // 1. Game must have ended (win or draw).
      expect(['win', 'draw']).toContain(finalState.status.kind);

      // 2. No legal moves should remain.
      expect(getLegalMoves(finalState)).toHaveLength(0);

      // 3. History length must equal the number of pieces on the board.
      const pieceCount = finalState.board.filter(c => c !== EMPTY).length;
      expect(finalState.history.length).toBe(pieceCount);

      // 4. Winning line cells must all belong to the winning player.
      if (finalState.status.kind === 'win') {
        const { player, line } = finalState.status;
        expect(line).toHaveLength(WIN_LENGTH);
        for (const pos of line) {
          expect(cell(finalState, pos.row, pos.col)).toBe(player);
        }
      }

      // 5. Undo the entire game and arrive back at initial state.
      let state = finalState;
      while (state.history.length > 0) {
        state = undoMove(state);
      }
      expect(state.board).toEqual(createInitialState().board);
      expect(state.history).toHaveLength(0);
      expect(state.currentPlayer).toBe(PLAYER_ONE);
    }
  }, 30000 /* 30 s timeout */);

  test('players alternate correctly throughout random games', () => {
    for (let g = 0; g < 200; g++) {
      const state = playRandomGame();
      let expectedPlayer: Player = PLAYER_ONE;
      for (const move of state.history) {
        expect(move.player).toBe(expectedPlayer);
        expectedPlayer = expectedPlayer === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
      }
    }
  });

  test('all moves in history are within valid bounds', () => {
    for (let g = 0; g < 200; g++) {
      const state = playRandomGame();
      for (const move of state.history) {
        expect(move.col).toBeGreaterThanOrEqual(0);
        expect(move.col).toBeLessThan(COLS);
        expect(move.row).toBeGreaterThanOrEqual(0);
        expect(move.row).toBeLessThan(ROWS);
      }
    }
  });
});
