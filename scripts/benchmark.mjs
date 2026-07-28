#!/usr/bin/env node
/**
 * Phase 3 AI Benchmark
 *
 * Validates Phase 3 strength against the Phase 1/2 random baseline.
 * Runs N games of strong AI vs random and reports win/loss/draw rates.
 * The strong AI plays as both P1 and P2 (half the games each) to remove
 * first-move bias from the results.
 *
 * Usage (requires tsx):
 *   npx tsx scripts/benchmark.mjs [games=10000] [depth=5]
 *
 * Depth guide:
 *   depth=3  → ~0.1 ms/move, very fast
 *   depth=5  → ~1–5 ms/move, strong play  ← default
 *   depth=7  → ~20–100 ms/move, near full strength
 */

import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lightweight engine replica ────────────────────────────────────────────────
// Mirrors src/game/engine.ts so we don't need Vite to run the benchmark.

const COLS = 9, ROWS = 7, WIN_LENGTH = 5;
const EMPTY = 0, P1 = 1, P2 = 2;
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];

function idx(r,c){ return r*COLS+c; }
function cellAt(b,r,c){ if(r<0||r>=ROWS||c<0||c>=COLS) return EMPTY; return b[idx(r,c)]; }
function lowestFreeRow(b,col){ for(let r=ROWS-1;r>=0;r--) if(b[idx(r,col)]===EMPTY) return r; return -1; }

function createInitialState(){
  return { board: new Array(ROWS*COLS).fill(EMPTY), currentPlayer: P1, history: [], status:{kind:'ongoing'} };
}

function computeStatus(b){
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const cell=b[idx(r,c)];
    if(cell===EMPTY) continue;
    for(const [dr,dc] of DIRS){
      let count=0;
      for(let k=0;k<WIN_LENGTH;k++){
        if(cellAt(b,r+k*dr,c+k*dc)===cell) count++;
        else break;
      }
      if(count>=WIN_LENGTH) return{kind:'win',player:cell};
    }
  }
  if(b.every(c=>c!==EMPTY)) return{kind:'draw'};
  return{kind:'ongoing'};
}

function makeMove(state,col){
  const row=lowestFreeRow(state.board,col);
  if(row<0) throw new Error('illegal col '+col);
  const board=state.board.slice();
  board[idx(row,col)]=state.currentPlayer;
  const next=state.currentPlayer===P1?P2:P1;
  const status=computeStatus(board);
  return{board,currentPlayer:next,history:[...state.history,{player:state.currentPlayer,col,row}],status};
}

function getLegalMoves(state){
  if(state.status.kind!=='ongoing') return [];
  const m=[];
  for(let c=0;c<COLS;c++) if(lowestFreeRow(state.board,c)>=0) m.push(c);
  return m;
}

function randomMove(state){
  const m=getLegalMoves(state);
  return m[Math.floor(Math.random()*m.length)];
}

// ── Load Phase 3 AI ───────────────────────────────────────────────────────────

const GAMES  = parseInt(process.argv[2] ?? '10000', 10);
const DEPTH  = parseInt(process.argv[3] ?? '5',     10);
const TIME   = 3_600_000; // very long time limit — depth cap controls search

console.log(`\n${'═'.repeat(52)}`);
console.log(`  Connect 5 Impossible – Phase 3 Benchmark`);
console.log(`${'═'.repeat(52)}`);
console.log(`  Games: ${GAMES.toLocaleString().padStart(7)}  |  Search depth: ${DEPTH}`);
console.log(`  Mode:  Strong AI (P1 half) vs Random (and vice versa)`);
console.log(`${'═'.repeat(52)}\n`);

console.log('Loading AI...');
let chooseMove;
try {
  const url = pathToFileURL(join(__dirname,'..','src','game','ai.ts')).href;
  const mod  = await import(url);
  chooseMove = mod.chooseMove;
  console.log('✓ AI loaded\n');
} catch (e) {
  console.error('Failed to load AI:', e.message);
  console.error('Make sure tsx is installed: npm install -D tsx');
  process.exit(1);
}

// ── Run games ─────────────────────────────────────────────────────────────────

let aiWins=0, aiLosses=0, draws=0, totalMoves=0;
const halfGames = Math.floor(GAMES / 2);
const t0 = Date.now();

for (let g = 0; g < GAMES; g++) {
  // Strong AI alternates sides to remove first-move advantage bias
  const aiPlayer = g < halfGames ? P1 : P2;
  let state = createInitialState();

  while (state.status.kind === 'ongoing') {
    let col;
    if (state.currentPlayer === aiPlayer) {
      col = chooseMove(state, TIME, DEPTH);
    } else {
      col = randomMove(state);
    }
    if (col < 0 || col >= COLS) break;
    state = makeMove(state, col);
    totalMoves++;
  }

  if (state.status.kind === 'win') {
    if (state.status.player === aiPlayer) aiWins++;
    else aiLosses++;
  } else {
    draws++;
  }

  // Progress every 500 games
  if ((g + 1) % 500 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const done    = g + 1;
    const pct     = (done / GAMES * 100).toFixed(0);
    const wPct    = (aiWins  / done * 100).toFixed(1);
    const lPct    = (aiLosses / done * 100).toFixed(1);
    process.stdout.write(
      `  ${pct.padStart(3)}%  [${done.toString().padStart(5)}/${GAMES}]` +
      `  W: ${wPct}%  L: ${lPct}%  (${elapsed}s)\r`
    );
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
const total   = aiWins + aiLosses + draws;
const wPct    = (aiWins   / total * 100).toFixed(2);
const lPct    = (aiLosses / total * 100).toFixed(2);
const dPct    = (draws    / total * 100).toFixed(2);
const mps     = Math.round(totalMoves / parseFloat(elapsed));

process.stdout.write('\n');
console.log(`\n${'─'.repeat(52)}`);
console.log(`  Results: Strong AI vs Random  (${total.toLocaleString()} games)`);
console.log(`${'─'.repeat(52)}`);
console.log(`  AI wins:   ${aiWins.toLocaleString().padStart(7)}  (${wPct}%)`);
console.log(`  AI losses: ${aiLosses.toLocaleString().padStart(7)}  (${lPct}%)`);
console.log(`  Draws:     ${draws.toLocaleString().padStart(7)}  (${dPct}%)`);
console.log(`${'─'.repeat(52)}`);
console.log(`  Time:      ${elapsed}s`);
console.log(`  Moves/s:   ${mps.toLocaleString()}`);
console.log(`${'─'.repeat(52)}\n`);

if (parseFloat(wPct) < 90) {
  console.error(`✗ Phase 3 FAILED benchmark: ${wPct}% win rate < 90% threshold.`);
  process.exit(1);
} else {
  console.log(`✓ Phase 3 PASSED benchmark: ${wPct}% win rate vs random (depth ${DEPTH}).`);
}
