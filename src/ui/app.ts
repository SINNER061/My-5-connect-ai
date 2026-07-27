/**
 * Application Controller – Connect 5 Impossible
 *
 * Orchestrates the game loop:
 *   - Initialises game state
 *   - Responds to human clicks
 *   - Delegates AI moves to the Web Worker
 *   - Drives the renderer
 *
 * No game logic lives here – all rules are in src/game/engine.ts.
 */

import { createInitialState, makeMove, getLegalMoves, undoMove } from '../game/engine.js';
import { buildBoard, renderState, showStartScreen, showGameScreen, showThinking } from './renderer.js';
import type { GameState, Player, WorkerRequest, WorkerResponse } from '../game/types.js';
import { PLAYER_ONE, PLAYER_TWO } from '../game/constants.js';

// ─── App state ────────────────────────────────────────────────────────────────

interface AppConfig {
  humanPlayer: Player;
  aiPlayer:    Player;
}

let gameState: GameState        = createInitialState();
let prevState:  GameState | null = null;
let config: AppConfig = { humanPlayer: PLAYER_ONE, aiPlayer: PLAYER_TWO };
let aiWorker: Worker | null     = null;
let aiThinking  = false;
let gameActive  = false;

// ─── Worker ───────────────────────────────────────────────────────────────────

function createWorker(): Worker {
  // Vite resolves ?worker automatically in the browser.
  const worker = new Worker(
    new URL('../workers/ai.worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { type, col } = event.data;
    if (type !== 'MOVE_RESULT') return;

    aiThinking = false;
    showThinking(false);

    if (!gameActive || gameState.status.kind !== 'ongoing') return;

    applyMove(col);
  };

  worker.onerror = err => {
    console.error('[App] AI worker error:', err);
    aiThinking = false;
    showThinking(false);
    // Fallback: try a random legal move from the main thread.
    const moves = getLegalMoves(gameState);
    if (moves.length > 0) {
      const col = moves[Math.floor(Math.random() * moves.length)];
      applyMove(col);
    }
  };

  return worker;
}

// ─── Game control ─────────────────────────────────────────────────────────────

/** Start a fresh game with the given config. */
function startGame(cfg: AppConfig): void {
  config     = cfg;
  gameState  = createInitialState();
  prevState  = null;
  aiThinking = false;
  gameActive = true;
  showThinking(false);

  showGameScreen();
  buildBoard(onColumnClick);
  renderState(gameState, prevState).then(() => {
    scheduleAiIfNeeded();
  });
}

/** Apply a move (human or AI), update state, re-render, then schedule next AI move. */
function applyMove(col: number): void {
  if (!gameActive) return;
  if (gameState.status.kind !== 'ongoing') return;

  try {
    const next = makeMove(gameState, col);
    prevState  = gameState;
    gameState  = next;
    renderState(gameState, prevState, () => {
      scheduleAiIfNeeded();
    });
  } catch (e) {
    console.error('[App] makeMove error:', e);
  }
}

/** If it is the AI's turn and the game is ongoing, dispatch a worker request. */
function scheduleAiIfNeeded(): void {
  if (!gameActive)                            return;
  if (gameState.status.kind !== 'ongoing')    return;
  if (gameState.currentPlayer !== config.aiPlayer) return;
  if (aiThinking)                             return;

  aiThinking = true;
  showThinking(true);

  // Small visual delay so the "thinking" indicator is perceptible.
  setTimeout(() => {
    if (!aiWorker) aiWorker = createWorker();
    const req: WorkerRequest = { type: 'COMPUTE_MOVE', state: gameState };
    aiWorker.postMessage(req);
  }, 300);
}

/** Handle a human clicking on a column. */
function onColumnClick(col: number): void {
  if (!gameActive)                                    return;
  if (gameState.status.kind !== 'ongoing')            return;
  if (gameState.currentPlayer !== config.humanPlayer) return;
  if (aiThinking)                                     return;

  applyMove(col);
}

// ─── UI button handlers ───────────────────────────────────────────────────────

function bindButtons(): void {
  // Start screen choices.
  document.getElementById('btn-human-first')?.addEventListener('click', () => {
    startGame({ humanPlayer: PLAYER_ONE, aiPlayer: PLAYER_TWO });
  });

  document.getElementById('btn-ai-first')?.addEventListener('click', () => {
    startGame({ humanPlayer: PLAYER_TWO, aiPlayer: PLAYER_ONE });
  });

  // In-game controls.
  document.getElementById('btn-restart')?.addEventListener('click', () => {
    if (gameActive) startGame(config);
  });

  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    gameActive = false;
    aiThinking = false;
    showThinking(false);
    showStartScreen();
  });

  // Undo (only available when it is the human's turn and there are ≥2 moves).
  document.getElementById('btn-undo')?.addEventListener('click', () => {
    if (!gameActive)                                    return;
    if (aiThinking)                                     return;
    if (gameState.history.length < 2)                   return; // need to undo both AI and human move
    if (gameState.currentPlayer !== config.humanPlayer) return;

    // Undo AI move, then human move.
    try {
      let s = undoMove(gameState);
      if (s.currentPlayer !== config.humanPlayer) s = undoMove(s);
      prevState = gameState;
      gameState = s;
      renderState(gameState, prevState);
    } catch (e) {
      console.error('[App] Undo error:', e);
    }
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Initialise the application. Called from main.ts. */
export function initApp(): void {
  bindButtons();
  showStartScreen();
}
