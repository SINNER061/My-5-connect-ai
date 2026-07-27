/**
 * Core types for the Connect 5 Impossible game engine.
 * The UI and the engine both import from here – never the other way around.
 */

import { EMPTY, PLAYER_ONE, PLAYER_TWO } from './constants.js';

// ─── Cell values ─────────────────────────────────────────────────────────────

export type Empty   = typeof EMPTY;
export type Player  = typeof PLAYER_ONE | typeof PLAYER_TWO;
export type Cell    = Empty | Player;

// ─── Board ───────────────────────────────────────────────────────────────────

/**
 * A flat array of ROWS × COLS cells.
 * Index formula: row * COLS + col  (row 0 = top, col 0 = left).
 * Gravity means the lowest free row in a column receives a dropped piece.
 */
export type Board = ReadonlyArray<Cell>;

// ─── Positions ───────────────────────────────────────────────────────────────

/** A board coordinate pair. */
export interface Position {
  readonly row: number;
  readonly col: number;
}

// ─── Moves ───────────────────────────────────────────────────────────────────

/**
 * A fully-resolved move: which player drops into which column,
 * landing at a specific row (determined by gravity).
 */
export interface Move {
  readonly player: Player;
  readonly col: number;
  readonly row: number; // resolved row after gravity
}

// ─── Game status ─────────────────────────────────────────────────────────────

export type GameStatus =
  | { kind: 'ongoing' }
  | { kind: 'win'; player: Player; line: readonly Position[] }
  | { kind: 'draw' };

// ─── Game state ──────────────────────────────────────────────────────────────

/**
 * The complete, immutable snapshot of a game at any point in time.
 * The engine never mutates this; it always returns a new GameState.
 */
export interface GameState {
  /** Current board contents. */
  readonly board: Board;
  /** The player whose turn it is to move. */
  readonly currentPlayer: Player;
  /** Ordered history of every move made so far. */
  readonly history: readonly Move[];
  /** Current game status (ongoing / win / draw). */
  readonly status: GameStatus;
}

// ─── AI message protocol (Web Worker) ────────────────────────────────────────

export interface WorkerRequest {
  readonly type: 'COMPUTE_MOVE';
  readonly state: GameState;
}

export interface WorkerResponse {
  readonly type: 'MOVE_RESULT';
  readonly col: number;
}
