# Connect 5 Impossible

> A modern Connect-4 variant on a **9 × 7** board where you need **5 in a row** to win.

**Phase 1 Status: ✅ Complete – Stable Game Engine Foundation**

---

## Overview

Connect 5 Impossible is a browser-based strategy game built with:

- **TypeScript** – fully typed throughout
- **Vite** – fast dev server and optimised production builds
- **Vanilla DOM APIs** – zero runtime dependencies
- **Pure CSS** – dark glassmorphism design, 60 fps animations
- **Web Workers** – AI runs off the main thread

The game works **completely offline** after a build. No backend, no frameworks.

---

## Board

| Property       | Value        |
|----------------|--------------|
| Columns        | 9            |
| Rows           | 7            |
| Gravity        | Yes (Connect-Four style) |
| Win condition  | 5 consecutive pieces (H / V / Diagonal) |

---

## Project Architecture

```
connect-5-impossible/
├── index.html                   # Entry HTML
├── vite.config.ts               # Vite configuration
├── tsconfig.json                # TypeScript (browser)
├── tsconfig.test.json           # TypeScript (Jest / Node)
├── jest.config.cjs              # Jest configuration
└── src/
    ├── main.ts                  # Application bootstrap
    ├── style.css                # Global styles (glassmorphism)
    ├── game/
    │   ├── constants.ts         # COLS, ROWS, WIN_LENGTH, directions
    │   ├── types.ts             # TypeScript types & interfaces
    │   ├── engine.ts            # Pure game engine (all rules)
    │   └── ai.ts                # Phase 1 AI placeholder (random)
    ├── ui/
    │   ├── app.ts               # Application controller
    │   ├── renderer.ts          # DOM renderer (stateless)
    │   └── animations.ts        # Web Animations API helpers
    ├── workers/
    │   └── ai.worker.ts         # AI Web Worker
    └── tests/
        └── engine.test.ts       # Full engine test suite
```

### Design Principles

- **Pure engine**: `src/game/engine.ts` has zero DOM dependencies. All functions are pure (input → output, no mutation).
- **Immutable state**: `GameState` is never mutated; every operation returns a new state object.
- **Separation of concerns**: game logic ↔ UI ↔ animations are in separate modules.
- **No global mutable state**: app state is managed in a single controller (`app.ts`), not scattered globals.
- **Worker isolation**: AI computation runs in a `Worker` so the UI thread stays responsive.

---

## Getting Started

### Development

```bash
npm install
npm run dev
```

Open `http://localhost:5000` in your browser.

### Production Build

```bash
npm run build
npm run preview
```

### Type Check

```bash
npm run typecheck
```

---

## Running Tests

```bash
npm test
```

The test suite covers:

| Category                        | Tests |
|---------------------------------|-------|
| Initial state invariants        | 6     |
| Gravity (correct row placement) | 5     |
| Move legality                   | 4     |
| Illegal move rejection          | 4     |
| Immutability guarantees         | 3     |
| Undo correctness                | 7     |
| Horizontal win detection        | 4     |
| Vertical win detection          | 9+1   |
| Diagonal ↘ win detection        | 2     |
| Diagonal ↙ win detection        | 1     |
| Draw detection                  | 4     |
| Random stress tests (2 000 games)| 3    |

**Stress test**: 2 000 random complete games are played end-to-end. For each game:
- Final status must be `win` or `draw`
- No legal moves may remain
- History length must equal piece count on board
- Winning line cells must all belong to the winning player
- Full undo of the entire game must return to initial state

---

## Game Features (Phase 1)

- ✅ Start screen with "Human First" / "AI First" choice
- ✅ Smooth piece-fall animations (gravity)
- ✅ Latest-move highlight ring
- ✅ Winning line pulse animation
- ✅ Draw shake animation
- ✅ Thinking indicator (animated dots)
- ✅ Undo (reverts both the AI move and the human move)
- ✅ Restart (same configuration)
- ✅ New Game (returns to start screen)
- ✅ Column hover highlights
- ✅ Fully responsive (desktop + mobile)
- ✅ Reduced-motion media query support
- ✅ AI runs in a Web Worker (non-blocking)

---

## Phase 2 Roadmap

Phase 2 will replace `src/game/ai.ts` with a proper search algorithm (minimax with alpha-beta pruning and a heuristic evaluation function). The engine and worker infrastructure are already in place — no architectural changes needed.

---

## License

MIT
