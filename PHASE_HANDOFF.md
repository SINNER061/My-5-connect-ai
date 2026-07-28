# Phase 3 Handoff – Strong AI

**Date:** 2026-07-27  
**Status:** ✅ Complete

---

## What was done

Phase 3 replaced the Phase 1 random-move placeholder in `src/game/ai.ts` with a
full-strength game-playing AI. The public interface is **unchanged**:

```typescript
export function chooseMove(
  state: GameState,
  timeLimitMs?: number,   // default 1400 ms
  depthCap?: number,      // default 14 (override for benchmarks/tests)
): number
```

The Web Worker (`src/workers/ai.worker.ts`) and all UI code are untouched.

---

## Algorithm overview

### Entry point flow
1. **Immediate win** – scan all legal columns; play the first winning move.
2. **Forced block** – scan all legal columns for opponent wins; block.
3. **Forced-Sequence Search (TSS)** – 10-ply forced-win probe before main search.
4. **Iterative-deepening alpha-beta** – search to depth 1 .. 14, respecting 1 400 ms budget.

### Negamax with alpha-beta (fail-soft)
- Transposition table: 1 048 576 entries, Zobrist 32-bit hashing.
- TT entry types: exact / lower bound / upper bound.
- Immediate win inside loop → early return (always best score).
- Adaptive extension: +1 ply when the current move creates a direct four-threat.

### Move ordering (fastest-first, critical for alpha-beta efficiency)
1. Immediate wins
2. Forced blocks (opponent immediate threats)
3. Moves creating a direct four-threat (`hasFour` fast inline check – O(4 × WIN_LENGTH²))
4. Killer moves (2 per ply)
5. History heuristic (updated on beta cutoffs)
6. Centre-column preference: `[4, 3, 5, 2, 6, 1, 7, 0, 8]`

### Evaluation function
Sliding-window scan over all windows of length 5 (WIN_LENGTH) and 6 (WIN_LENGTH+1).

**Standard window (length 5) patterns:**
| mine | accessible empty | Score    | Pattern    |
|------|-----------------|----------|-----------|
| 4    | ≥1              | 200 000  | Open-4    |
| 4    | 0               | 80 000   | Latent-4  |
| 3    | ≥1, both ends open | 10 000 | Double-open-3 |
| 3    | ≥1, one end open | 2 000   | Open-3    |
| 2    | ≥1              | 400      | Open-2    |
| 1    | any             | 8        | Single    |

**Broken patterns (length-6 window):**
| mine | empty | Score  | Pattern     |
|------|-------|--------|-------------|
| 4    | 2     | 120 000 | Broken-4   |
| 3    | 3     | 3 500   | Broken-3   |

**Positional bonus:** pieces near centre column (4) and centre row (3) get up to 44 pts each.

**Endgame tightening:** all scores multiplied by `1 + moveCount / (ROWS × COLS)` so threats matter more as the board fills.

**Opponent asymmetry:** opponent score weighted ×1.05 (slightly more defensive).

### Threat Space Search (TSS)
`forcedWinSearch(board, tops, player, horizon=10)` runs before the main alpha-beta.
It finds forced wins by:
1. Checking for immediate wins.
2. Checking for double-threat moves (two simultaneous accessible fours → opponent can't block both).
3. For each single-four-creating move, verifying that all opponent blocking responses still allow a recursive forced win.

### Fast inline threat checker (`hasFour`)
Used inside move ordering and search extensions instead of the expensive
full-board `analyseThreat`:
- Checks only windows of WIN_LENGTH that pass through the newly placed piece.
- O(4 × WIN_LENGTH²) = O(100) operations vs O(all_windows) for `analyseThreat`.

---

## Benchmark results

```
Games:     10 000  (5 000 as P1, 5 000 as P2 vs random)
Depth:     2 (fixed cap)
Win rate:  99.99%
Losses:    0
Draws:     1
Time:      80.3 s  (~2 427 moves/s)
```

At full strength (depth uncapped, 1 400 ms/move), the AI typically searches to
depth 7–10 in mid-game positions.

---

## Tests added

`src/tests/ai.test.ts` — 12 new tests:
- Immediate win (horizontal, vertical, priority over other moves)
- Forced block (horizontal, vertical)
- Legality: empty board, after 10 moves, game-over (returns -1), 200 random positions
- AI vs AI: terminates, never returns illegal move (10 games, 200 ms fast mode)

All 56 existing engine tests continue to pass (no engine changes).

**Total: 68 tests, 68 passing.**

---

## Files changed

| File                        | Change                                |
|-----------------------------|---------------------------------------|
| `src/game/ai.ts`            | Complete rewrite (same interface)     |
| `src/tests/ai.test.ts`      | New – 12 AI correctness tests         |
| `scripts/benchmark.mjs`     | New – 10 000-game benchmark runner    |
| `package.json`              | Added `benchmark` and `tsx` dev dep   |
| `PROJECT_STATE.md`          | New – project state document          |
| `PHASE_HANDOFF.md`          | This file                             |

**No changes to:** engine, types, constants, UI, worker, vite config, existing tests.

---

## Known limitations / Phase 4 opportunities

1. **Zobrist hash is 32-bit** — occasional collisions possible at high depths; upgrade
   to 53-bit safe integers or two 32-bit values for fewer false TT hits.

2. **No aspiration windows** — iterative deepening uses full (-∞, +∞) bounds at
   each iteration; aspiration windows would reduce re-search cost.

3. **No null-move pruning** — standard Connect-N heuristic; would speed up mid-game.

4. **No PVS (Principal Variation Search)** — straightforward negamax; PVS would
   reduce node count by ~20–30%.

5. **TSS is heuristic** — `forcedWinSearch` may miss very long forced sequences
   (> horizon/2 depth). A full SSS*/α-β proof-number search would handle these.

6. **Opening book** — the first 2–3 moves are evaluated from scratch every time;
   a small opening book for the first move (play centre) is trivially worthwhile.

---

## How to continue

```bash
# Play the game
npm run dev

# Run all tests
npm test

# Run the benchmark
npm run benchmark           # 10 000 games, depth 2
npm run benchmark 1000 7    # 1 000 games, depth 7 (slower, stronger)

# Check types
npm run typecheck
```
