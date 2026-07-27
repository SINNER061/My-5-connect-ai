/**
 * DOM Renderer for Connect 5 Impossible.
 *
 * Responsible for:
 *   - Building and updating the board grid
 *   - Highlighting the latest move
 *   - Rendering the winning line animation
 *   - Showing/hiding the start screen, status bar, and thinking indicator
 *   - Emitting column-click events to the app controller
 *
 * The renderer is completely stateless with respect to game logic.
 * It receives a GameState and produces DOM side-effects.
 */

import { COLS, ROWS, PLAYER_ONE, PLAYER_TWO } from '../game/constants.js';
import type { GameState, Player, Position } from '../game/types.js';
import {
  animateFall,
  animateLatestMove,
  animateWinLine,
  animateDraw,
  animateBoardReveal,
} from './animations.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColumnClickHandler = (col: number) => void;

// ─── State internal to the renderer ──────────────────────────────────────────

/** Flat map from cell index (row*COLS+col) to its <div> element. */
let cellElements: HTMLElement[] = [];

/** Reference to the board container element. */
let boardEl: HTMLElement | null = null;

/** Whether a fall animation is currently in progress. */
let animating = false;

// ─── DOM queries (cached lazily) ──────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Element #${id} not found`);
  return found as T;
}

// ─── Board construction ───────────────────────────────────────────────────────

/**
 * Build the board grid and attach click listeners.
 * Must be called once after the DOM is ready.
 */
export function buildBoard(onColumnClick: ColumnClickHandler): void {
  boardEl = el('board');
  boardEl.innerHTML = '';
  cellElements = [];

  // CSS grid: COLS columns, ROWS rows – filled row-by-row (top to bottom).
  boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  boardEl.style.gridTemplateRows    = `repeat(${ROWS}, 1fr)`;

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset['row'] = String(row);
      cell.dataset['col'] = String(col);
      cell.setAttribute('aria-label', `Column ${col + 1}`);

      // Column-level click: forward to the app controller.
      cell.addEventListener('click', () => {
        if (!animating) onColumnClick(col);
      });

      // Hover: highlight the entire column.
      cell.addEventListener('mouseenter', () => highlightColumn(col, true));
      cell.addEventListener('mouseleave', () => highlightColumn(col, false));

      boardEl!.appendChild(cell);
      cellElements.push(cell);
    }
  }

  animateBoardReveal(boardEl);
}

/** Highlight / un-highlight all cells in a column on hover. */
function highlightColumn(col: number, active: boolean): void {
  for (let row = 0; row < ROWS; row++) {
    const c = cellElements[row * COLS + col];
    if (c) c.classList.toggle('col-hover', active);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Fully sync the DOM to the current game state.
 * If a new piece was placed, animate its fall first.
 *
 * @param state         - Current game state.
 * @param prevState     - Previous game state (used to detect new piece).
 * @param onAnimDone    - Called once any fall animation completes.
 */
export async function renderState(
  state: GameState,
  prevState: GameState | null,
  onAnimDone?: () => void,
): Promise<void> {
  // Detect the newly placed piece (last history entry absent from prevState).
  const newMove =
    prevState !== null && state.history.length > prevState.history.length
      ? state.history[state.history.length - 1]
      : null;

  // Clear all piece classes first.
  cellElements.forEach(c => {
    c.classList.remove('p1', 'p2', 'latest', 'win-cell');
    c.style.transform = '';
    c.style.opacity   = newMove ? '1' : '1'; // reset
  });

  // Apply current board state.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const val  = state.board[row * COLS + col];
      const cell = cellElements[row * COLS + col];
      if (val === PLAYER_ONE) cell.classList.add('p1');
      else if (val === PLAYER_TWO) cell.classList.add('p2');
    }
  }

  // Animate the falling piece if there is a new move.
  if (newMove) {
    const cell = cellElements[newMove.row * COLS + newMove.col];
    animating = true;
    await animateFall(cell, newMove.row);
    animating = false;
    animateLatestMove(cell);
  }

  // Mark latest move cell.
  if (state.history.length > 0) {
    const last = state.history[state.history.length - 1];
    const cell = cellElements[last.row * COLS + last.col];
    cell.classList.add('latest');
  }

  // Winning line.
  if (state.status.kind === 'win') {
    const winCells = state.status.line.map(
      (pos: Position) => cellElements[pos.row * COLS + pos.col],
    );
    winCells.forEach(c => c.classList.add('win-cell'));
    animateWinLine(winCells);
  }

  // Draw shake.
  if (state.status.kind === 'draw' && boardEl) {
    animateDraw(boardEl);
  }

  updateStatus(state);
  updateColumnCursors(state);

  onAnimDone?.();
}

// ─── Status bar ───────────────────────────────────────────────────────────────

/** Update the status text and player indicator. */
export function updateStatus(state: GameState): void {
  const statusEl = document.getElementById('status-text');
  const indicator = document.getElementById('turn-indicator');
  if (!statusEl) return;

  let text: string;
  let playerCls: string;

  switch (state.status.kind) {
    case 'ongoing':
      text = state.currentPlayer === PLAYER_ONE
        ? "Player 1's turn"
        : "AI's turn";
      playerCls = state.currentPlayer === PLAYER_ONE ? 'p1' : 'p2';
      break;
    case 'win':
      text = state.status.player === PLAYER_ONE
        ? '🎉 Player 1 wins!'
        : '🤖 AI wins!';
      playerCls = state.status.player === PLAYER_ONE ? 'p1' : 'p2';
      break;
    case 'draw':
      text = "It's a draw!";
      playerCls = '';
      break;
  }

  statusEl.textContent = text;
  if (indicator) {
    indicator.className = `turn-indicator ${playerCls}`;
  }
}

/** Show the "thinking…" indicator. */
export function showThinking(visible: boolean): void {
  const el = document.getElementById('thinking-indicator');
  if (el) el.classList.toggle('visible', visible);
}

/** Enable/disable column hover cursors based on whether a move is legal. */
function updateColumnCursors(state: GameState): void {
  const legal = new Set<number>();
  if (state.status.kind === 'ongoing') {
    for (let col = 0; col < COLS; col++) {
      const top = state.board[col]; // row 0, same col
      if (top === 0) legal.add(col);
    }
  }
  cellElements.forEach(c => {
    const col = Number(c.dataset['col']);
    c.classList.toggle('legal', legal.has(col));
    c.classList.toggle('illegal', state.status.kind !== 'ongoing' || !legal.has(col));
  });
}

// ─── Screen management ────────────────────────────────────────────────────────

/** Show the start screen, hide the game screen. */
export function showStartScreen(): void {
  el('start-screen').classList.remove('hidden');
  el('game-screen').classList.add('hidden');
}

/** Show the game screen, hide the start screen. */
export function showGameScreen(): void {
  el('start-screen').classList.add('hidden');
  el('game-screen').classList.remove('hidden');
}

/** Return current player label for display purposes. */
export function playerLabel(player: Player): string {
  return player === PLAYER_ONE ? 'Player 1' : 'AI';
}
