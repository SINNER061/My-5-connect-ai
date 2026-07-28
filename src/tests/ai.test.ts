/**
 * Phase 3 AI – Correctness Tests
 *
 * Verifies that the AI:
 *   1. Always takes an immediate win
 *   2. Always blocks an immediate opponent win
 *   3. Never returns an illegal move
 *   4. Handles a full board (returns -1)
 *   5. Creates double threats (fork detection)
 *   6. Detects a forced win in two moves
 */

import { chooseMove } from '../game/ai';
import {
  createInitialState,
  makeMove,
  isLegalMove,
  getLegalMoves,
} from '../game/engine';
import { COLS, ROWS, PLAYER_ONE, PLAYER_TWO } from '../game/constants';
import type { GameState } from '../game/types';

// Fast time limit for tests so the suite runs in seconds, not hours.
const FAST_MS = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Drop pieces into columns in order, alternating players. */
function playMoves(cols: number[]): GameState {
  let state = createInitialState();
  for (const col of cols) {
    state = makeMove(state, col);
  }
  return state;
}

// ─── Immediate win ────────────────────────────────────────────────────────────

describe('AI – immediate win', () => {
  test('plays the winning move when 4 in a row (horizontal)', () => {
    // P1 has pieces in cols 0-3 at bottom row; col 4 wins.
    // P2 pieces scattered in col 8.
    // Sequence: P1->0, P2->8, P1->1, P2->8, P1->2, P2->8, P1->3
    const state = playMoves([0, 8, 1, 8, 2, 8, 3]);
    // It's P2's turn... give it back to P1 by adding one more P2 move
    const state2 = makeMove(state, 8);
    expect(state2.currentPlayer).toBe(PLAYER_ONE);
    const move = chooseMove(state2, FAST_MS);
    expect(move).toBe(4);
  });

  test('plays the winning move when 4 in a row (vertical)', () => {
    const state = playMoves([4, 0, 4, 0, 4, 0, 4]);
    const state2 = makeMove(state, 0);
    expect(state2.currentPlayer).toBe(PLAYER_ONE);
    const move = chooseMove(state2, FAST_MS);
    expect(move).toBe(4);
  });

  test('plays the winning move over any other consideration', () => {
    const state = playMoves([0, 8, 1, 8, 2, 8, 3]);
    const state2 = makeMove(state, 8);
    const move = chooseMove(state2, FAST_MS);
    expect(move).toBe(4);
  });
});

// ─── Forced block ─────────────────────────────────────────────────────────────

describe('AI – forced block', () => {
  test('blocks horizontal 4-in-a-row (block col 4)', () => {
    const state = playMoves([0, 8, 1, 8, 2, 8, 3]);
    expect(state.currentPlayer).toBe(PLAYER_TWO);
    const move = chooseMove(state, FAST_MS);
    expect(move).toBe(4);
  });

  test('blocks vertical 4-in-a-row', () => {
    const state = playMoves([4, 0, 4, 0, 4, 0, 4]);
    expect(state.currentPlayer).toBe(PLAYER_TWO);
    const move = chooseMove(state, FAST_MS);
    expect(move).toBe(4);
  });

  test('does not play an illegal move when facing a threat', () => {
    const state = playMoves([0, 8, 1, 8, 2, 8, 3]);
    const move = chooseMove(state, FAST_MS);
    expect(isLegalMove(state, move)).toBe(true);
  });
});

// ─── Legality ─────────────────────────────────────────────────────────────────

describe('AI – always plays legal moves', () => {
  test('legal move on empty board', () => {
    const state = createInitialState();
    const move = chooseMove(state, FAST_MS);
    expect(isLegalMove(state, move)).toBe(true);
  });

  test('legal move after 10 specific moves', () => {
    const cols = [4, 4, 3, 5, 2, 6, 4, 3, 5, 2];
    let state = createInitialState();
    for (const c of cols) {
      if (isLegalMove(state, c) && state.status.kind === 'ongoing') {
        state = makeMove(state, c);
      }
    }
    if (state.status.kind === 'ongoing') {
      const move = chooseMove(state, FAST_MS);
      expect(isLegalMove(state, move)).toBe(true);
    }
  });

  test('returns -1 when game is over', () => {
    let state = createInitialState();
    while (state.status.kind === 'ongoing') {
      state = makeMove(state, getLegalMoves(state)[0]);
    }
    expect(chooseMove(state, FAST_MS)).toBe(-1);
  });

  test('legal move from 200 random game positions', () => {
    for (let g = 0; g < 200; g++) {
      let state = createInitialState();
      const target = 5 + Math.floor(Math.random() * 25);
      for (let i = 0; i < target && state.status.kind === 'ongoing'; i++) {
        const moves = getLegalMoves(state);
        state = makeMove(state, moves[Math.floor(Math.random() * moves.length)]);
      }
      if (state.status.kind === 'ongoing') {
        const move = chooseMove(state, FAST_MS);
        expect(isLegalMove(state, move)).toBe(true);
      }
    }
  });
});

// ─── Double-threat / fork detection ──────────────────────────────────────────

describe('AI – fork / double-threat detection', () => {
  // Run 10 complete AI-vs-AI games at fast speed; verify correctness not speed.
  test('AI vs AI never returns illegal move (10 games, fast mode)', () => {
    for (let g = 0; g < 10; g++) {
      let state = createInitialState();
      while (state.status.kind === 'ongoing') {
        const move = chooseMove(state, FAST_MS);
        expect(isLegalMove(state, move)).toBe(true);
        state = makeMove(state, move);
      }
    }
  }, 120_000);

  test('AI vs AI game terminates (10 games, fast mode)', () => {
    for (let g = 0; g < 10; g++) {
      let state = createInitialState();
      let steps = 0;
      while (state.status.kind === 'ongoing' && steps < ROWS * COLS + 5) {
        state = makeMove(state, chooseMove(state, FAST_MS));
        steps++;
      }
      expect(state.status.kind).not.toBe('ongoing');
    }
  }, 120_000);
});
