# Connect 5 Impossible – Project State

## Current Phase

**Phase 3A: ✅ Complete – Tactical Search System**

---

## Board

| Property       | Value        |
|----------------|--------------|
| Columns        | 9            |
| Rows           | 7            |
| Gravity        | Yes (Connect-Four style) |
| Win condition  | 5 consecutive pieces (H / V / Diagonal) |

---

## Phase History

### Phase 1 – Game Engine Foundation ✅
- Pure TypeScript engine (immutable `GameState`)
- Gravity, win detection, undo, draw detection
- Full UI: start screen, animations, thinking indicator, undo/restart
- Web Worker infrastructure for AI
- AI: random move placeholder
- 56 engine tests, all passing

### Phase 2 – Not separately implemented
Phase 2 (minimax AI) was merged into Phase 3.

### Phase 3 – Strong AI ✅

**File:** `src/game/ai.ts` (complete rewrite, same `chooseMove` interface)

#### Search algorithm
| Feature                       | Status |
|-------------------------------|--------|
| Negamax with alpha-beta       | ✅     |
| Iterative deepening (ID)      | ✅     |
| Time budget (1 400 ms)        | ✅     |
| Configurable depth cap        | ✅     |
| Transposition table (1M, Zobrist) | ✅ |
| Killer moves (2 per ply)      | ✅     |
| History heuristic             | ✅     |

#### Move ordering (fastest-first)
1. Immediate winning moves
2. Forced blocks (opponent 4-in-a-row)
3. Moves creating a direct four-threat (fast inline `hasFour`)
4. Killer moves
5. History heuristic + centre preference

#### Evaluation function
| Signal                        | Status |
|-------------------------------|--------|
| Open-2, Open-3, Open-4        | ✅     |
| Closed-2, Closed-3            | ✅     |
| Broken-3, Broken-4            | ✅     |
| Centre control                | ✅     |
| Vertical / horizontal / diagonal pressure | ✅ |
| Endgame tightening            | ✅     |
| Gravity-accessibility weighting | ✅   |

---

### Phase 3A – Tactical Search System ✅

**File:** `src/game/tactical.ts` (new dedicated module)  
**Integration:** `src/game/ai.ts` — `chooseMove` now calls `tacticalSearch` before the main alpha-beta  
**Tests:** `src/tests/tactical.test.ts` — 35 new tests

#### Tactical Search Features
| Feature                       | Status | Source                          |
|-------------------------------|--------|---------------------------------|
| Multi-ply Threat Space Search | ✅ Fully | `tacticalSearch` / `tssInternal` |
| Forced Sequence Search        | ✅ Fully | `tssInternal` Step 4            |
| Double Threat Detection       | ✅ Fully | `countThreats` / `isDoubleThreat` |
| Fork Detection                | ✅ Fully | `detectFork` / `findForkingMoves` |
| Trap Detection                | ✅ Fully | `tssInternal` Step 5 (root-only) |

#### `countThreats` — Double Threat Detection
Scans every WIN_LENGTH window in all 4 directions; classifies by:
- `fours` — accessible four-threats (empty cell at `tops[col]`)
- `foursLatent` — latent four-threats (empty not yet accessible)
- `openThrees` — open-three threats (both ends beyond window empty)
- `threes` — single-end three-threats
- `urgentCols` — columns that MUST be played NOW to block a four

#### `detectFork` — Fork Detection
Detects three classes of forks by placing piece and checking resulting threats:
- **double-four**: ≥2 accessible fours → opponent blocks one, other wins
- **four-three**: 1 four + surviving threat verified after simulated forced block
- **double-three**: ≥2 simultaneous open-three threats

#### `tssInternal` — TSS / Forced Sequence / Trap
Five-step recursive search:
1. **Immediate win** — any move that wins right now
2. **Opponent double-threat guard** — abort if opponent has ≥2 fours (can't win tactically)
3. **Fork detection** — double-four/four-three/double-three (returns immediately)
4. **Forced sequence** — create a four → opponent's forced block → recurse (horizon-2)
5. **Trap detection** (root only, horizon ≥ 6) — quiet setup moves where every dangerous opponent response still leads to a forced win

#### TSS call chain in `chooseMove`
```
chooseMove()
  └── Step 3: tacticalSearch(board, tops, player, TSS_HORIZON=8)
        └── tssInternal(horizon=8, depth=0)
              ├── [1] immediate win scan
              ├── [2] opponent double-threat guard (countThreats)
              ├── [3] detectFork for each legal col
              ├── [4] forced-sequence: drop → countThreats → for each urgentCol:
              │         opponent drops → isWinAt guard → tssInternal(horizon-2)
              └── [5] trap: quiet move → dangerous-opp-responses → tssInternal(horizon-2)
  └── Step 3 fallback: forcedWinSearch (legacy, kept for safety)
  └── Step 4: iterative-deepening alpha-beta (unchanged)
```

---

## Benchmark Results (Phase 3 vs Random)

| Metric         | Value     |
|----------------|-----------|
| Games played   | 10,000    |
| Search depth   | 2 (fixed) |
| Win rate       | 99.99%    |
| Loss rate      | 0.00%     |
| Draw rate      | 0.01%     |
| Speed          | ~2 427 moves/s |
| Time           | 80.3 s    |

*Strong AI played as both P1 (5 000 games) and P2 (5 000 games) to remove first-move bias.*

---

## Test Suite

| Suite              | Tests | Status |
|--------------------|-------|--------|
| Engine (Phase 1)   | 56    | ✅ All passing |
| AI correctness     | 12    | ✅ All passing |
| Tactical (Phase 3A)| 35    | ✅ All passing |
| **Total**          | **103** | **✅** |

Key tactical test coverage:
- `countThreats` — empty board, horizontal four, vertical four, urgentCols, three-threats
- `detectFork` — non-forking move, mutation safety, double-four, four-three, double-three
- `findForkingMoves` — empty board, mutation safety, legality of results
- `isDoubleThreat` — false on single threat, false on empty board
- `tacticalSearch` — immediate win (H/V), no mutation, TSS_HORIZON export, trap legality
- Forced sequence — legal results, kind classification, horizon=0 guard
- Immediate win (AI + TSS) — horizontal, vertical, diagonal
- Immediate block (AI + TSS) — horizontal, vertical, urgentCols
- Integration — 50 random positions always legal, 5 AI-vs-AI complete games, 30 random positions column range

---

## File Structure

```
connect-5-impossible/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.test.json
├── jest.config.cjs
├── PROJECT_STATE.md               ← this file
├── PHASE_HANDOFF.md               ← Phase 3A handoff doc
├── scripts/
│   └── benchmark.mjs              ← 10 000-game benchmark runner
└── src/
    ├── main.ts
    ├── style.css
    ├── game/
    │   ├── constants.ts
    │   ├── types.ts
    │   ├── engine.ts              ← immutable engine (unchanged)
    │   ├── ai.ts                  ← Phase 3 AI + Phase 3A integration
    │   └── tactical.ts            ← Phase 3A: new tactical search module
    ├── ui/
    │   ├── app.ts
    │   ├── renderer.ts
    │   └── animations.ts
    ├── workers/
    │   └── ai.worker.ts           ← unchanged; calls chooseMove(state)
    └── tests/
        ├── engine.test.ts         ← 56 engine tests (unchanged)
        ├── ai.test.ts             ← 12 AI correctness tests (Phase 3)
        └── tactical.test.ts       ← 35 tactical tests (Phase 3A)
```

---

## Running the Project

```bash
npm install
npm run dev          # dev server at :5000
npm run build        # production build
npm test             # all 103 tests
npm run typecheck    # TypeScript check
npm run benchmark    # 10 000-game AI benchmark (requires tsx)
```

---

## Phase 4 Candidates

- Principal variation search (PVS / NegaScout) for faster alpha-beta
- Aspiration windows in iterative deepening
- Null-move pruning
- Better Zobrist hash (64-bit via BigInt or two 32-bit values)
- Opening book for the first few moves
- Endgame tablebase (for near-full boards)
- UCT / Monte Carlo Tree Search variant
- SSS* / proof-number search for exact tactical verification
