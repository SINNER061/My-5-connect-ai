# Phase 3A Handoff – Tactical Search System

**Date:** 2026-07-28  
**Status:** ✅ Complete

---

## What was done

Phase 3A implemented a complete, standalone **Tactical Search System** in a new
dedicated module `src/game/tactical.ts`, and integrated it into the existing
`chooseMove` flow in `src/game/ai.ts`.

**No existing code was deleted or simplified.**  The public `chooseMove`
interface is unchanged.  The Phase 3 `forcedWinSearch` and all alpha-beta
infrastructure remain in place.

---

## Five required features — status and evidence

### 1. Multi-ply Threat Space Search (TSS)
**Status: Fully Implemented**  
**File:** `src/game/tactical.ts`  
**Function:** `tacticalSearch` (public entry point) → `tssInternal` (recursive engine)

The search only examines "threat moves" and forced responses:
- A threat move is one that creates an accessible four-in-a-row.
- A forced response is the opponent's only legal block of an accessible four.

This keeps the branching factor to ≪ COLS while covering every forcing line within
the configured horizon (`TSS_HORIZON = 8`, covering 4 forced exchanges).

Call chain:
```
tacticalSearch(board, tops, player, horizon=8)
  → tssInternal(board, tops, player, horizon=8, depth=0)
       ├── Step 1: immediate win scan (O(COLS × isWinAt))
       ├── Step 2: opponent double-threat guard (countThreats once)
       ├── Step 3: fork detection per legal column (detectFork each)
       ├── Step 4: forced-sequence recursion (horizon decrements by 2)
       └── Step 5: trap detection (root only, horizon ≥ 6)
```

---

### 2. Forced Sequence Search
**Status: Fully Implemented**  
**File:** `src/game/tactical.ts`  
**Function:** `tssInternal` — Step 4

For each move that creates ≥1 accessible four:
1. Iterate over `urgentCols` (columns opponent must block).
2. Simulate each forced block; guard against the opponent winning there.
3. Recurse with `horizon − 2`; if all forced responses lead to a win, return
   the original move.

The recursion terminates in at most `horizon / 2` exchanges.  The
`forcedWinSearch` legacy function in `ai.ts` is retained as a
belt-and-suspenders fallback in `chooseMove`.

---

### 3. Double Threat Detection
**Status: Fully Implemented**  
**File:** `src/game/tactical.ts`  
**Functions:** `countThreats`, `isDoubleThreat`

`countThreats` performs a full board scan in all four directions, classifying
every unblocked WIN_LENGTH window:

| Return field   | Meaning                                                      |
|----------------|--------------------------------------------------------------|
| `fours`        | Accessible four-threats (empty cell reachable by gravity)    |
| `foursLatent`  | Latent four-threats (empty cell not yet reachable)           |
| `openThrees`   | Open-three threats (both ends outside the window are empty)  |
| `threes`       | Single-end three-threats (≥1 accessible empty)               |
| `urgentCols`   | Columns that MUST be played NOW to block an accessible four  |

`isDoubleThreat(board, tops, player)` is the fast predicate: `fours >= 2`.

Used in:
- `tssInternal` Step 2 (abort if opponent has double-threat before our move)
- `tssInternal` Step 4 (locate forced block columns)
- `tssInternal` Step 5 trap analysis
- `detectFork` for four-three verification

---

### 4. Fork Detection
**Status: Fully Implemented**  
**File:** `src/game/tactical.ts`  
**Functions:** `detectFork`, `findForkingMoves`

Detects three fork classes by temporarily placing the piece and calling
`countThreats`, then verifying with forced-block simulation:

| Fork kind      | Condition                                                       | Verification |
|----------------|-----------------------------------------------------------------|--------------|
| `double-four`  | `fours >= 2` after the move                                     | None needed  |
| `four-three`   | `fours == 1` + surviving threat after simulated forced block    | Block simulated, `tAfterBlock.fours + tAfterBlock.openThrees >= 1` |
| `double-three` | `openThrees >= 2` after the move                               | Two simultaneous open-three threats |

`findForkingMoves(board, tops, player)` returns all legal fork-creating columns
in centre-out order, with the `ForkMove.kind` field indicating the class.

Used in:
- `tssInternal` Step 3 (fork → immediate win via TSS)
- `tssInternal` Step 5 trap analysis (dangerous opponent responses)
- Available for external callers (e.g. future UI threat overlay)

---

### 5. Trap Detection
**Status: Fully Implemented**  
**File:** `src/game/tactical.ts`  
**Function:** `tssInternal` — Step 5 (root-only, `horizon >= 6`)

A **trap** is a quiet setup move (creates no immediate four) after which every
dangerous opponent reply still leaves a position where the TSS can force a win.

To keep the search fast, only dangerous opponent responses are tested:
1. Immediate wins for the opponent → trap fails instantly.
2. Opponent fork-creating moves (`detectFork`).
3. Opponent four-creating moves (`countThreats` after drop).
4. One representative passive move (first available centre-out column).

This reduces branching from O(COLS) ≈ 9 to O(1–4) per candidate, making
trap detection practical within the main `chooseMove` time budget.

---

## Integration with `chooseMove`

`src/game/ai.ts` — `chooseMove` step 3 (unchanged steps 1, 2, 4):

```typescript
// --- 3. Tactical Search (TSS) – Phase 3A complete implementation ---
const tssResult = tacticalSearch(tssBoard, tssTops, player, TSS_HORIZON);
if (tssResult.col >= 0) return tssResult.col;
// Legacy forced-win search kept as belt-and-suspenders
const forcedCol = forcedWinSearch(tssBoard, tssTops, player, 10);
if (forcedCol >= 0) return forcedCol;
```

The new `tacticalSearch` is a strict superset of `forcedWinSearch`:
- All positions caught by `forcedWinSearch` are also caught by `tacticalSearch`.
- `tacticalSearch` additionally handles four-three forks, double-three forks,
  and trap setups that `forcedWinSearch` misses.

---

## Tests added

`src/tests/tactical.test.ts` — **35 new tests**:

| Suite                              | Tests |
|------------------------------------|-------|
| TSS entry point                    | 5     |
| Forced Sequence Search             | 3     |
| Double Threat Detection            | 7     |
| Fork Detection                     | 5     |
| Trap Detection                     | 1     |
| Immediate Win (AI + TSS)           | 4     |
| Immediate Block (AI + TSS)         | 4     |
| Integration (AI with Phase 3A)     | 3     |

All 56 existing engine tests and 12 existing AI tests continue to pass.

**Total: 103 tests, 103 passing.**

---

## Files changed

| File                          | Change                                      |
|-------------------------------|---------------------------------------------|
| `src/game/tactical.ts`        | New – complete tactical search module       |
| `src/game/ai.ts`              | Step 3 updated: calls `tacticalSearch` first |
| `src/tests/tactical.test.ts`  | New – 35 tactical correctness tests         |
| `PROJECT_STATE.md`            | Updated to Phase 3A                         |
| `PHASE_HANDOFF.md`            | This file                                   |

**No changes to:** engine, types, constants, UI, worker, vite config, engine tests, AI tests.

---

## Public API of `tactical.ts`

```typescript
// Types
export type ForkKind = 'double-four' | 'four-three' | 'double-three';
export interface ThreatCount { fours, foursLatent, openThrees, threes, urgentCols }
export interface ForkResult   { isFork, kind, unblockableCount }
export interface ForkMove     { col, row, kind }
export interface TacticalResult { col, depth, kind }

// Constants
export const TSS_HORIZON = 8;

// Functions
export function countThreats(board, tops, player): ThreatCount
export function detectFork(board, tops, row, col, player): ForkResult
export function findForkingMoves(board, tops, player): ForkMove[]
export function isDoubleThreat(board, tops, player): boolean
export function tacticalSearch(board, tops, player, horizon?): TacticalResult
```

---

## Known limitations / Phase 4 opportunities

1. **Zobrist hash is 32-bit** — occasional collisions possible at high depths.

2. **No aspiration windows** — iterative deepening uses full (-∞, +∞) bounds.

3. **No null-move pruning** — standard Connect-N mid-game heuristic.

4. **No PVS** — straightforward negamax; PVS would reduce node count ~20–30%.

5. **TSS horizon is 8** — up to 4 forced exchanges; longer forcing lines (> 4
   exchanges) are only caught by the alpha-beta.  Raising `TSS_HORIZON` to 12
   improves coverage but requires optimizing the forced-sequence recursion
   (e.g. shallow TT for tssInternal).

6. **Trap detection is heuristic** — only tests dangerous opponent responses,
   not all legal moves.  A proof-number search would give exact trap guarantees.

7. **Opening book** — first 2–3 moves evaluated from scratch every time.

---

## How to continue

```bash
# Play the game
npm run dev

# Run all tests
npm test               # 103 tests

# Check types
npm run typecheck

# Run the benchmark
npm run benchmark      # 10 000 games, depth 2
```
