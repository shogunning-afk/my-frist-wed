import { Game } from './game/game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

game.resize();
window.addEventListener('resize', () => game.resize());

// Losing focus mid-fight should not hand you a death you did not earn: the
// loop keeps running but the clock delta is clamped, so a backgrounded tab
// resumes exactly where it left off.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) game.lastFrame = performance.now();
});

function loop(now) {
  game.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Handy for tinkering from the console.
window.OMNI = game;
