/**
 * AI Web Worker – Connect 5 Impossible
 *
 * Runs the AI computation off the main thread so the UI stays responsive
 * during "thinking" time.  In Phase 1 the computation is trivial (random move),
 * but the worker infrastructure is ready for a heavy search in Phase 2.
 *
 * Message protocol (defined in src/game/types.ts):
 *   Main → Worker : WorkerRequest  { type: 'COMPUTE_MOVE', state }
 *   Worker → Main : WorkerResponse { type: 'MOVE_RESULT',  col   }
 */

import { chooseMove } from '../game/ai.js';
import type { WorkerRequest, WorkerResponse } from '../game/types.js';

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { type, state } = event.data;

  if (type !== 'COMPUTE_MOVE') {
    console.warn('[AI Worker] Unknown message type:', type);
    return;
  }

  // Phase 1: random legal move (fast – no artificial delay needed).
  const col = chooseMove(state);

  const response: WorkerResponse = { type: 'MOVE_RESULT', col };
  (self as unknown as Worker).postMessage(response);
};
