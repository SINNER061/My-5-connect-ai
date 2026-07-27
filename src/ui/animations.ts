/**
 * Animation helpers for Connect 5 Impossible.
 *
 * All animation logic lives here so the renderer stays declarative.
 * Uses the Web Animations API where possible for 60 fps performance.
 */

import { ROWS } from '../game/constants.js';

// Duration constants (milliseconds)
export const FALL_DURATION_PER_ROW = 60; // ms per row of fall
export const WIN_PULSE_DURATION    = 600;
export const WIN_PULSE_ITERATIONS  = 3;
export const LATEST_FLASH_DURATION = 400;

/**
 * Animate a piece falling from the top of the column to its target row.
 * Uses CSS custom properties injected on the element.
 *
 * @param cell        - The cell DOM element to animate.
 * @param targetRow   - The row the piece lands on (0 = top, ROWS-1 = bottom).
 * @returns           A Promise that resolves when the animation is complete.
 */
export function animateFall(cell: HTMLElement, targetRow: number): Promise<void> {
  return new Promise(resolve => {
    // The piece falls from row 0 to targetRow.
    const distance = targetRow + 1; // rows to traverse
    const duration = Math.max(distance * FALL_DURATION_PER_ROW, 80);

    // We animate a translateY from -(targetRow * cellHeight) to 0.
    // The cell is already positioned at targetRow in the grid; we shift it
    // upward by the full travel distance then release it.
    const rowHeight = cell.getBoundingClientRect().height || 64;
    const travelPx  = targetRow * rowHeight;

    cell.style.transform = `translateY(-${travelPx}px)`;
    cell.style.opacity   = '1';

    // Force a reflow so the initial transform is applied before animating.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    cell.offsetHeight;

    const animation = cell.animate(
      [
        { transform: `translateY(-${travelPx}px)`, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
        { transform: 'translateY(0px)',             easing: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)' },
      ],
      {
        duration,
        fill: 'forwards',
      },
    );

    animation.onfinish = () => {
      cell.style.transform = '';
      resolve();
    };

    // Safety net: resolve even if animation events don't fire.
    setTimeout(resolve, duration + 100);
  });
}

/**
 * Flash the "latest move" indicator on a cell.
 */
export function animateLatestMove(cell: HTMLElement): void {
  cell.animate(
    [
      { boxShadow: '0 0 0 3px var(--color-latest)', opacity: '1' },
      { boxShadow: '0 0 0 6px var(--color-latest)', opacity: '0.8' },
      { boxShadow: '0 0 0 3px var(--color-latest)', opacity: '1' },
    ],
    {
      duration: LATEST_FLASH_DURATION,
      iterations: 2,
      fill: 'forwards',
    },
  );
}

/**
 * Animate the winning line: pulse each cell with a golden glow in sequence.
 */
export function animateWinLine(cells: HTMLElement[]): void {
  cells.forEach((cell, i) => {
    setTimeout(() => {
      cell.animate(
        [
          { transform: 'scale(1)',    filter: 'brightness(1)'   },
          { transform: 'scale(1.15)', filter: 'brightness(1.6)' },
          { transform: 'scale(1)',    filter: 'brightness(1)'   },
        ],
        {
          duration: WIN_PULSE_DURATION,
          iterations: WIN_PULSE_ITERATIONS,
          fill: 'forwards',
        },
      );
    }, i * 80);
  });
}

/**
 * Animate the board shaking on a draw.
 */
export function animateDraw(board: HTMLElement): void {
  board.animate(
    [
      { transform: 'translateX(0)'   },
      { transform: 'translateX(-8px)'},
      { transform: 'translateX(8px)' },
      { transform: 'translateX(-6px)'},
      { transform: 'translateX(6px)' },
      { transform: 'translateX(0)'   },
    ],
    { duration: 500, easing: 'ease-in-out' },
  );
}

/**
 * Reveal the board on initial mount with a fade+scale-in.
 */
export function animateBoardReveal(board: HTMLElement): void {
  board.animate(
    [
      { opacity: '0', transform: 'scale(0.92) translateY(20px)' },
      { opacity: '1', transform: 'scale(1) translateY(0)'       },
    ],
    { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' },
  );
}

/**
 * Tiny helper: add a CSS class for one animation cycle then remove it.
 */
export function flashClass(el: HTMLElement, cls: string, durationMs: number): void {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), durationMs);
}

// Re-export ROWS for use in the renderer without extra imports.
export { ROWS };
