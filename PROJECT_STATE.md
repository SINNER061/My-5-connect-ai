# Connect 5 Impossible – Project State

## Current Phase

**Phase 3: ✅ Complete – Strong AI**

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

#### Threat detection
| Feature                       | Status |
|-------------------------------|--------|
| Immediate win detection       | ✅ (always correct) |
| Immediate forced block        | ✅ (always correct) |
| Forced sequence search (TSS)  | ✅ (10-ply horizon) |
| Double threat detection       | ✅ (via hasFour + move ordering) |
| Fork / split / overlapping    | ✅ (via window scoring + TSS) |
| Trap detection                | ✅ (TSS forced-sequence) |
| Adaptive search extensions    | ✅ (extend 1 ply on four-threat) |

#### Horizon effect reduction
- Search extensions trigger when a move creates a direct four
- TSS pre-search (10 plies) before main alpha-beta catches forced wins
- TT stores best moves across iterations

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
| **Total**          | **68** | **✅** |

Key AI test coverage:
- Immediate win (horizontal, vertical)
- Forced block (horizontal, vertical)
- Always plays a legal move (200 random positions)
- Returns -1 on game over
- AI vs AI: game terminates (10 games, fast mode)
- AI vs AI: never returns illegal move (10 games, fast mode)

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
├── PHASE_HANDOFF.md               ← Phase 3 handoff doc
├── scripts/
│   └── benchmark.mjs              ← 10 000-game benchmark runner
└── src/
    ├── main.ts
    ├── style.css
    ├── game/
    │   ├── constants.ts
    │   ├── types.ts
    │   ├── engine.ts              ← immutable engine (unchanged)
    │   └── ai.ts                  ← Phase 3 strong AI (rewritten)
    ├── ui/
    │   ├── app.ts
    │   ├── renderer.ts
    │   └── animations.ts
    ├── workers/
    │   └── ai.worker.ts           ← unchanged; calls chooseMove(state)
    └── tests/
        ├── engine.test.ts         ← 56 engine tests (unchanged)
        └── ai.test.ts             ← 12 AI correctness tests (Phase 3)
```

---

## Running the Project

```bash
npm install
npm run dev          # dev server at :5000
npm run build        # production build
npm test             # all 68 tests
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
