/**
 * Connect 5 Impossible – Pure Game Engine
 *
 * All functions are pure: they take state and return new state/values.
 * No mutation, no side effects, no DOM references.
 *
 * Public API:
 *   createInitialState()       → GameState
 *   getLegalMoves(state)       → number[]          (legal column indices)
 *   isLegalMove(state, col)    → boolean
 *   makeMove(state, col)       → GameState          (throws on illegal)
 *   undoMove(state)            → GameState          (throws if no history)
 *   getStatus(state)           → GameStatus
 *   isBoardFull(state)         → boolean
 */

import { COLS, ROWS, WIN_LENGTH, DIRECTIONS, EMPTY, PLAYER_ONE, PLAYER_TWO } from './constants.js';
import type { Board, Cell, GameState, GameStatus, Move, Player, Position } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert (row, col) to a flat array index. */
function idx(row: number, col: number): number {
  return row * COLS + col;
}

/** Read a cell from a board (returns EMPTY for out-of-bounds). */
function cellAt(board: Board, row: number, col: number): Cell {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return EMPTY;
  return board[idx(row, col)];
}

/**
 * Return the lowest empty row in the given column, or -1 if the column is full.
 * Row 0 is the top of the board; gravity fills from the bottom (ROWS-1) upward.
 */
function lowestFreeRow(board: Board, col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[idx(row, col)] === EMPTY) return row;
  }
  return -1; // column is full
}

/** Return the opponent of the given player. */
function opponent(player: Player): Player {
  return player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
}

// ─── Win detection ────────────────────────────────────────────────────────────

/**
 * Scan from a starting cell in one direction, counting consecutive pieces
 * belonging to `player`.  Returns the positions of each cell in the run
 * (including the start) so the winning line can be highlighted.
 */
function scanDirection(
  board: Board,
  startRow: number,
  startCol: number,
  dRow: number,
  dCol: number,
  player: Player,
): Position[] {
  const positions: Position[] = [];
  let r = startRow;
  let c = startCol;
  while (
    r >= 0 && r < ROWS &&
    c >= 0 && c < COLS &&
    cellAt(board, r, c) === player
  ) {
    positions.push({ row: r, col: c });
    r += dRow;
    c += dCol;
  }
  return positions;
}

/**
 * Check whether the last move placed at (row, col) by `player` created a win.
 * Only scans through the newly placed piece for efficiency.
 *
 * Returns the winning line (exactly WIN_LENGTH positions) or null.
 */
function checkWinAt(board: Board, row: number, col: number, player: Player): readonly Position[] | null {
  for (const [dRow, dCol] of DIRECTIONS) {
    // Scan in both directions along the axis, merge the runs.
    const forward  = scanDirection(board, row, col, dRow, dCol, player);
    const backward = scanDirection(board, row - dRow, col - dCol, -dRow, -dCol, player);
    const line = [...backward.reverse(), ...forward];
    if (line.length >= WIN_LENGTH) {
      // Return exactly WIN_LENGTH consecutive cells centred on the last move.
      return line.slice(0, WIN_LENGTH);
    }
  }
  return null;
}

// ─── Board construction ───────────────────────────────────────────────────────

/** Create a fresh, empty board. */
function createEmptyBoard(): Board {
  return new Array<Cell>(ROWS * COLS).fill(EMPTY);
}

/** Place a piece on a board and return the new board (immutable). */
function placeCell(board: Board, row: number, col: number, player: Player): Board {
  const next = board.slice() as Cell[];
  next[idx(row, col)] = player;
  return next;
}

/** Remove a piece from a board and return the new board (immutable). */
function clearCell(board: Board, row: number, col: number): Board {
  const next = board.slice() as Cell[];
  next[idx(row, col)] = EMPTY;
  return next;
}

// ─── Status computation ───────────────────────────────────────────────────────

/**
 * Compute the full game status from scratch (useful after undo).
 * Scans the entire board for a winning line.
 */
function computeStatus(board: Board): GameStatus {
  // Check every occupied cell as a potential win anchor.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = board[idx(row, col)];
      if (cell === EMPTY) continue;
      const player = cell as Player;
      for (const [dRow, dCol] of DIRECTIONS) {
        // Only check each direction in positive sense to avoid double-counting.
        let count = 0;
        const positions: Position[] = [];
        for (let k = 0; k < WIN_LENGTH; k++) {
          const r = row + k * dRow;
          const c = col + k * dCol;
          if (cellAt(board, r, c) === player) {
            count++;
            positions.push({ row: r, col: c });
          } else {
            break;
          }
        }
        if (count >= WIN_LENGTH) {
          return { kind: 'win', player, line: positions };
        }
      }
    }
  }

  // Draw: board is full and no winner.
  const full = board.every(cell => cell !== EMPTY);
  if (full) return { kind: 'draw' };

  return { kind: 'ongoing' };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create the initial game state.
 * Player One always has the first turn.
 */
export function createInitialState(): GameState {
  return {
    board: createEmptyBoard(),
    currentPlayer: PLAYER_ONE,
    history: [],
    status: { kind: 'ongoing' },
  };
}

/**
 * Return every column index that can legally receive a piece.
 * A column is legal iff it has at least one empty row and the game is ongoing.
 */
export function getLegalMoves(state: GameState): number[] {
  if (state.status.kind !== 'ongoing') return [];
  const moves: number[] = [];
  for (let col = 0; col < COLS; col++) {
    if (lowestFreeRow(state.board, col) !== -1) {
      moves.push(col);
    }
  }
  return moves;
}

/**
 * Return whether dropping into `col` is a legal move in `state`.
 */
export function isLegalMove(state: GameState, col: number): boolean {
  if (state.status.kind !== 'ongoing') return false;
  if (col < 0 || col >= COLS) return false;
  return lowestFreeRow(state.board, col) !== -1;
}

/**
 * Apply a move: drop the current player's piece into `col`.
 *
 * @throws {Error} if the move is illegal (game over, column full, out of bounds).
 * @returns A new GameState reflecting the move.
 */
export function makeMove(state: GameState, col: number): GameState {
  if (!isLegalMove(state, col)) {
    throw new Error(
      `Illegal move: col=${col}, status=${state.status.kind}, player=${state.currentPlayer}`,
    );
  }

  const row = lowestFreeRow(state.board, col);
  // lowestFreeRow returns -1 only for full columns; isLegalMove guards against that.
  if (row === -1) throw new Error(`Internal error: column ${col} appears full`);

  const player = state.currentPlayer;
  const board = placeCell(state.board, row, col, player);
  const move: Move = { player, col, row };

  // Fast win check: only examine the newly placed piece.
  const winLine = checkWinAt(board, row, col, player);
  let status: GameStatus;
  if (winLine !== null) {
    status = { kind: 'win', player, line: winLine };
  } else if (board.every(cell => cell !== EMPTY)) {
    status = { kind: 'draw' };
  } else {
    status = { kind: 'ongoing' };
  }

  return {
    board,
    currentPlayer: opponent(player),
    history: [...state.history, move],
    status,
  };
}

/**
 * Undo the last move and return the previous game state.
 *
 * @throws {Error} if there are no moves to undo.
 * @returns A new GameState reflecting the board before the last move.
 */
export function undoMove(state: GameState): GameState {
  if (state.history.length === 0) {
    throw new Error('Cannot undo: no moves have been made');
  }

  const lastMove = state.history[state.history.length - 1];
  const board = clearCell(state.board, lastMove.row, lastMove.col);
  const history = state.history.slice(0, -1);

  // Recompute status from scratch (handles edge case of undoing after a win).
  const status = computeStatus(board);

  return {
    board,
    currentPlayer: lastMove.player,
    history,
    status,
  };
}

/**
 * Return the current game status.
 * (Convenience wrapper – status is also available as state.status.)
 */
export function getStatus(state: GameState): GameStatus {
  return state.status;
}

/**
 * Return whether every cell on the board is occupied.
 */
export function isBoardFull(state: GameState): boolean {
  return state.board.every(cell => cell !== EMPTY);
}

/**
 * Return the height (number of pieces) in each column.
 * Useful for AI evaluation and UI column indicators.
 */
export function columnHeights(state: GameState): number[] {
  return Array.from({ length: COLS }, (_, col) => {
    let count = 0;
    for (let row = 0; row < ROWS; row++) {
      if (state.board[idx(row, col)] !== EMPTY) count++;
    }
    return count;
  });
}
