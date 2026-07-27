/**
 * Phase 1 AI placeholder – plays a random legal move.
 *
 * This module is intentionally simple.  Phase 2 will replace the body of
 * `chooseMove` with a proper search algorithm without changing the interface.
 *
 * The function is synchronous so it can be called directly or wrapped in a
 * Web Worker without duplicating logic.
 */

import { getLegalMoves } from './engine.js';
import type { GameState } from './types.js';

/**
 * Choose a column to play in the given state.
 * Returns a legal column index, or -1 if there are no legal moves.
 *
 * Phase 1: selects a uniformly random legal column.
 */
export function chooseMove(state: GameState): number {
  const legalMoves = getLegalMoves(state);
  if (legalMoves.length === 0) return -1;

  // Uniform random selection.
  const index = Math.floor(Math.random() * legalMoves.length);
  return legalMoves[index];
}
